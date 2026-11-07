// Tickler Cloud control plane: accounts (Sign in with Apple), subscriptions (StoreKit 2) and
// provisioning. Contract: docs/reference/cloud-contract.md. Runtime-independent: the Worker passes
// D1 storage and a Durable Object server directory; tests pass SQLite and fakes.
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Ctx } from "../core/context";
import { decryptJson, encryptJson } from "../core/crypto";
import { rateLimit } from "../core/rateLimit";
import { ApiError, randomToken, sha256hex, uuid, VERSION, API_VERSION } from "../core/util";
import { errorResponse, zodFields } from "../routes/http";
import type { Storage } from "../storage/types";
import {
  exchangeAuthorizationCode, revokeAppleToken, verifyIdentityToken, verifyNotification, verifyTransaction,
  type AppleConfig, type CloudTransaction,
} from "./apple";

export const CLOUD_PRODUCTS: Record<string, "monthly" | "yearly"> = {
  "tickler.cloud.monthly": "monthly",
  "tickler.cloud.yearly": "yearly",
};
/** Days an expired server stays readable before it is deleted. */
export const READ_ONLY_DAYS = 30;
const SERVER_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export type AccountStatus = "new" | "active" | "grace" | "expired" | "deleting";

/** How the control plane reaches customer servers (Durable Objects in production). */
export interface ServerDirectory {
  init(serverId: string, url: string, status: AccountStatus): Promise<void>;
  setStatus(serverId: string, status: AccountStatus): Promise<void>;
  pairDevice(serverId: string, deviceName: string, platform: string): Promise<{ device_id: string; token: string }>;
  purge(serverId: string): Promise<void>;
}

export interface ControlDeps {
  storage: Storage;
  servers: ServerDirectory;
  apple: AppleConfig;
  /** CLOUD_SECRET: encrypts Apple refresh tokens and derives each server's TICKLER_SECRET. */
  secret: string;
  /** "https://{id}.tickler.cloud" or, on staging, "https://…workers.dev/s/{id}". */
  serverUrlTemplate: string;
  now?: () => Date;
  fetch?: typeof fetch;
  /** Overridable in tests. */
  verify?: {
    identity?: (token: string, nonce: string) => Promise<{ sub: string; email: string | null }>;
    transaction?: (jws: string) => Promise<CloudTransaction>;
    notification?: (signedPayload: string) => Promise<Awaited<ReturnType<typeof verifyNotification>>>;
  };
}

interface AccountRow {
  id: string;
  apple_sub: string;
  email: string | null;
  status: AccountStatus;
  plan: string | null;
  product_id: string | null;
  expires_at: string | null;
  original_transaction_id: string | null;
  environment: string | null;
  server_id: string | null;
  apple_refresh_enc: string | null;
  created_at: string;
  updated_at: string;
}

type CEnv = { Variables: { account: AccountRow; ip: string } };

export function newServerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => SERVER_ID_ALPHABET[b % SERVER_ID_ALPHABET.length]).join("");
}

export function statusFromTransaction(tx: CloudTransaction, now: Date): AccountStatus {
  if (tx.revoked) return "expired";
  return tx.expiresAt && tx.expiresAt.getTime() > now.getTime() ? "active" : "expired";
}

export function createControl(deps: ControlDeps) {
  const now = deps.now ?? (() => new Date());
  const f = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const db = deps.storage;
  const limiter = { storage: db, now } as unknown as Ctx;
  const serverUrl = (id: string) => deps.serverUrlTemplate.replace("{id}", id);
  const verifyIdentity = deps.verify?.identity ?? ((t: string, n: string) => verifyIdentityToken(t, n, deps.apple));
  const verifyTx = deps.verify?.transaction ?? ((jws: string) => verifyTransaction(jws, deps.apple, now()));
  const verifyNote = deps.verify?.notification ?? ((p: string) => verifyNotification(p, deps.apple, now()));

  const accountJson = (a: AccountRow) => ({
    id: a.id,
    email: a.email,
    status: a.status,
    plan: a.plan,
    expires_at: a.expires_at,
    server: a.server_id ? { id: a.server_id, url: serverUrl(a.server_id) } : null,
    created_at: a.created_at,
  });
  const getAccount = (id: string) => db.first<AccountRow>("SELECT * FROM accounts WHERE id = ?", [id]);

  /** Record a verified transaction on an account and make the server match the subscription. */
  async function applyTransaction(a: AccountRow, tx: CloudTransaction, status: AccountStatus): Promise<AccountRow> {
    const other = await db.first<{ id: string }>("SELECT id FROM accounts WHERE original_transaction_id = ? AND id != ?", [tx.originalTransactionId, a.id]);
    if (other) throw new ApiError(409, "conflict", "This subscription belongs to another Tickler Cloud account.");
    const t = now().toISOString();
    let serverId = a.server_id;
    if (!serverId && (status === "active" || status === "grace")) {
      serverId = newServerId();
      await deps.servers.init(serverId, serverUrl(serverId), status);
    } else if (serverId && serverId !== null && status !== a.status) {
      await deps.servers.setStatus(serverId, status);
    }
    await db.run(
      `UPDATE accounts SET status = ?, plan = ?, product_id = ?, expires_at = ?, original_transaction_id = ?, environment = ?,
         server_id = ?, updated_at = ? WHERE id = ?`,
      [status, CLOUD_PRODUCTS[tx.productId] ?? a.plan, tx.productId, tx.expiresAt?.toISOString() ?? a.expires_at, tx.originalTransactionId,
        tx.environment, serverId, t, a.id],
    );
    return (await getAccount(a.id))!;
  }

  async function issueAccountToken(accountId: string) {
    const token = randomToken("tka_");
    await db.run("INSERT INTO account_tokens (token_hash, account_id, created_at) VALUES (?, ?, ?)", [await sha256hex(token), accountId, now().toISOString()]);
    return token;
  }

  async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new ApiError(400, "bad_request", "Body must be JSON");
    }
    const r = schema.safeParse(raw);
    if (!r.success) throw new ApiError(422, "validation_failed", "Invalid input", { fields: zodFields(r.error) });
    return r.data;
  }

  const app = new Hono<CEnv>({ strict: false });
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(errorResponse(err), err.status as 400);
    console.error("control plane error", err);
    return c.json(errorResponse(new ApiError(500, "internal", "Something went wrong")), 500);
  });
  app.notFound((c) => c.json(errorResponse(new ApiError(404, "not_found", "No such endpoint")), 404));
  app.use("*", async (c, next) => {
    c.set("ip", c.req.header("cf-connecting-ip") ?? c.req.header("x-test-ip") ?? "unknown");
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("cache-control", "no-store");
  });

  app.get("/", (c) => c.text("Tickler Cloud\n"));
  app.get("/v1/health", (c) => c.json({ ok: true, name: "tickler-cloud", version: VERSION, api: API_VERSION }));

  // ---------- sign in

  app.post("/v1/accounts/apple", async (c) => {
    await rateLimit(limiter, `signin:${c.get("ip")}`, 20, 600);
    const b = await body(c, z.object({ identity_token: z.string().min(20), authorization_code: z.string().optional(), nonce: z.string().min(8).max(200) }));
    let who: { sub: string; email: string | null };
    try {
      who = await verifyIdentity(b.identity_token, b.nonce);
    } catch {
      throw new ApiError(401, "unauthorized", "Sign in with Apple could not be verified");
    }
    const t = now().toISOString();
    let a = await db.first<AccountRow>("SELECT * FROM accounts WHERE apple_sub = ?", [who.sub]);
    if (!a) {
      const id = uuid();
      await db.run("INSERT INTO accounts (id, apple_sub, email, status, created_at, updated_at) VALUES (?, ?, ?, 'new', ?, ?)", [id, who.sub, who.email, t, t]);
      a = (await getAccount(id))!;
    } else if (who.email && who.email !== a.email) {
      await db.run("UPDATE accounts SET email = ?, updated_at = ? WHERE id = ?", [who.email, t, a.id]);
      a = (await getAccount(a.id))!;
    }
    if (b.authorization_code) {
      try {
        const refresh = await exchangeAuthorizationCode(b.authorization_code, deps.apple, now(), f);
        if (refresh) await db.run("UPDATE accounts SET apple_refresh_enc = ? WHERE id = ?", [await encryptJson(deps.secret, refresh), a.id]);
      } catch (e) {
        console.error("apple code exchange failed", e); // sign-in still works; only revocation on deletion needs it
      }
    }
    return c.json({ account: accountJson(a), account_token: await issueAccountToken(a.id) });
  });

  // ---------- account (tka_ token)

  const requireAccount = async (c: Context<CEnv>, next: () => Promise<void>) => {
    const h = c.req.header("authorization") ?? "";
    const token = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
    const row = token.startsWith("tka_")
      ? await db.first<{ account_id: string }>("SELECT account_id FROM account_tokens WHERE token_hash = ?", [await sha256hex(token)])
      : null;
    const a = row ? await getAccount(row.account_id) : null;
    if (!a) throw new ApiError(401, "unauthorized", "Missing or invalid account token");
    await rateLimit(limiter, `account:${a.id}`, 120, 60);
    c.set("account", a);
    await next();
  };
  app.use("/v1/accounts/me", requireAccount);
  app.use("/v1/accounts/me/*", requireAccount);

  app.get("/v1/accounts/me", (c) => c.json(accountJson(c.get("account"))));

  app.delete("/v1/accounts/me", async (c) => {
    const a = c.get("account");
    await db.run("UPDATE accounts SET status = 'deleting', updated_at = ? WHERE id = ?", [now().toISOString(), a.id]);
    const out = accountJson({ ...a, status: "deleting" });
    if (a.apple_refresh_enc) {
      try {
        await revokeAppleToken(await decryptJson<string>(deps.secret, a.apple_refresh_enc), deps.apple, now(), f);
      } catch (e) {
        console.error("apple revoke failed", e);
      }
    }
    if (a.server_id) await deps.servers.purge(a.server_id);
    await db.batch([
      { sql: "DELETE FROM account_tokens WHERE account_id = ?", params: [a.id] },
      { sql: "DELETE FROM accounts WHERE id = ?", params: [a.id] },
    ]);
    return c.json(out, 202);
  });

  app.post("/v1/accounts/me/transactions", async (c) => {
    const a = c.get("account");
    const b = await body(c, z.object({ signed_transaction: z.string().min(20) }));
    let tx: CloudTransaction;
    try {
      tx = await verifyTx(b.signed_transaction);
    } catch (e) {
      throw new ApiError(400, "bad_request", `The transaction could not be verified: ${(e as Error).message}`);
    }
    if (!CLOUD_PRODUCTS[tx.productId]) throw new ApiError(400, "bad_request", `${tx.productId} is not a Tickler Cloud subscription`);
    if (tx.appAccountToken !== a.id) throw new ApiError(409, "conflict", "This purchase was made for another Tickler Cloud account.");
    // A webhook may already have put the account in grace; a still-valid transaction doesn't undo that.
    const status = statusFromTransaction(tx, now());
    const next = status === "active" && a.status === "grace" ? "grace" : status;
    return c.json(accountJson(await applyTransaction(a, tx, next)));
  });

  app.post("/v1/accounts/me/devices", async (c) => {
    const a = c.get("account");
    const b = await body(c, z.object({ device_name: z.string().max(80).default("Phone"), platform: z.string().max(20).default("other") }));
    if (!a.server_id || a.status === "new" || a.status === "deleting") {
      throw new ApiError(402, "subscription_required", "Subscribe to Tickler Cloud to get your server.");
    }
    const r = await deps.servers.pairDevice(a.server_id, b.device_name, b.platform);
    return c.json({ url: serverUrl(a.server_id), ...r, server: { name: "Tickler Cloud", version: VERSION, api: API_VERSION } });
  });

  // ---------- App Store Server Notifications v2

  app.post("/v1/webhooks/app-store", async (c) => {
    const b = await body(c, z.object({ signedPayload: z.string().min(20) }));
    let n: Awaited<ReturnType<typeof verifyNotification>>;
    try {
      n = await verifyNote(b.signedPayload);
    } catch {
      throw new ApiError(401, "unauthorized", "Notification signature could not be verified");
    }
    if (n.notificationUUID && (await db.first("SELECT 1 FROM notifications WHERE uuid = ?", [n.notificationUUID]))) return c.body(null, 200);
    const signedTx = n.data?.signedTransactionInfo;
    if (signedTx) {
      const tx = await verifyTx(signedTx);
      if (CLOUD_PRODUCTS[tx.productId]) {
        const a =
          (tx.appAccountToken ? await getAccount(tx.appAccountToken) : null) ??
          (await db.first<AccountRow>("SELECT * FROM accounts WHERE original_transaction_id = ?", [tx.originalTransactionId]));
        if (a && a.status !== "deleting") {
          let status: AccountStatus;
          switch (n.notificationType) {
            case "DID_FAIL_TO_RENEW":
              status = "grace";
              break;
            case "EXPIRED":
            case "GRACE_PERIOD_EXPIRED":
            case "REFUND":
            case "REVOKE":
              status = "expired";
              break;
            default:
              status = statusFromTransaction(tx, now());
          }
          await applyTransaction(a, tx, status);
        }
      }
    }
    if (n.notificationUUID) await db.run("INSERT OR IGNORE INTO notifications (uuid, received_at) VALUES (?, ?)", [n.notificationUUID, now().toISOString()]);
    return c.body(null, 200);
  });

  /** Daily: delete servers whose read-only window ended; expire subscriptions whose renewal never arrived. */
  async function daily() {
    const t = now();
    const cutoff = new Date(t.getTime() - READ_ONLY_DAYS * 86400_000).toISOString();
    for (const a of await db.all<AccountRow>("SELECT * FROM accounts WHERE status = 'expired' AND server_id IS NOT NULL AND expires_at < ?", [cutoff])) {
      await deps.servers.purge(a.server_id!);
      await db.run("UPDATE accounts SET server_id = NULL, updated_at = ? WHERE id = ?", [t.toISOString(), a.id]);
    }
    // A missed EXPIRED notification: 3 days past the end date with no renewal seen.
    const late = new Date(t.getTime() - 3 * 86400_000).toISOString();
    for (const a of await db.all<AccountRow>("SELECT * FROM accounts WHERE status IN ('active', 'grace') AND expires_at < ?", [late])) {
      await db.run("UPDATE accounts SET status = 'expired', updated_at = ? WHERE id = ?", [t.toISOString(), a.id]);
      if (a.server_id) await deps.servers.setStatus(a.server_id, "expired");
    }
    await db.run("DELETE FROM notifications WHERE received_at < ?", [new Date(t.getTime() - 30 * 86400_000).toISOString()]);
    await db.run("DELETE FROM rate_limits WHERE window_start < ?", [Math.floor(t.getTime() / 1000) - 86400]);
  }

  return { app, daily };
}
