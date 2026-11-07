import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CloudTransaction } from "../../src/cloud/apple";
import { createControl, type AccountStatus, type ServerDirectory } from "../../src/cloud/control";
import { migrate } from "../../src/storage/migrate";
import { openSqliteStorage } from "../../src/storage/sqlite";

const MIG = [{ name: "0001_accounts.sql", sql: readFileSync(join(__dirname, "../../migrations-cloud/0001_accounts.sql"), "utf8") }];
const DAY = 86400_000;

/** Fake Apple: identity tokens are "id:<sub>:<nonce>", transactions and notifications are JSON. */
async function makeControl() {
  const storage = openSqliteStorage(":memory:");
  await migrate(storage, MIG);
  const clock = { t: Date.parse("2026-11-08T10:00:00Z") };
  const servers = new Map<string, { status: AccountStatus; devices: number }>();
  const calls: string[] = [];
  const dir: ServerDirectory = {
    init: async (id, url, status) => void (servers.set(id, { status, devices: 0 }), calls.push(`init ${id} ${url}`)),
    setStatus: async (id, status) => void (servers.get(id)!.status = status, calls.push(`status ${id} ${status}`)),
    pairDevice: async (id) => ({ device_id: `dev-${++servers.get(id)!.devices}`, token: "tkd_test" }),
    purge: async (id) => void (servers.delete(id), calls.push(`purge ${id}`)),
  };
  const tx = (o: Partial<CloudTransaction> & { productId?: string }) => JSON.stringify(o);
  const parseTx = (s: string): CloudTransaction => {
    const o = JSON.parse(s);
    return { productId: o.productId, appAccountToken: o.appAccountToken ?? null, originalTransactionId: o.originalTransactionId ?? "otx-1",
      expiresAt: o.expiresAt ? new Date(o.expiresAt) : null, revoked: !!o.revoked, environment: "Sandbox" };
  };
  const { app, daily } = createControl({
    storage,
    servers: dir,
    secret: "cloud-test-secret-0123456789",
    serverUrlTemplate: "https://{id}.tickler.cloud",
    apple: { bundleId: "com.gettickler.tickler", acceptSandbox: true, teamId: null, siwaKeyId: null, siwaPrivateKey: null },
    now: () => new Date(clock.t),
    verify: {
      identity: async (token, nonce) => {
        const [k, sub, n] = token.split(":");
        if (k !== "id" || n !== nonce) throw new Error("bad");
        return { sub: sub!, email: `${sub}@privaterelay.appleid.com` };
      },
      transaction: async (jws) => parseTx(jws),
      notification: async (p) => JSON.parse(p),
    },
  });
  const req = (path: string, init: { method?: string; json?: unknown; token?: string } = {}) =>
    app.request(`https://tickler.cloud${path}`, {
      method: init.method ?? (init.json ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
      body: init.json ? JSON.stringify(init.json) : undefined,
    }) as Promise<Omit<Response, "json"> & { json(): Promise<any> }>;
  const signIn = async (sub = "apple-user-1") => {
    const r = await req("/v1/accounts/apple", { json: { identity_token: `id:${sub}:n0nce-123`, nonce: "n0nce-123", authorization_code: "c" } });
    return (await r.json()) as { account: any; account_token: string };
  };
  return { req, signIn, servers, calls, clock, tx, daily, storage };
}

describe("Tickler Cloud control plane", () => {
  it("signs in with Apple, once per Apple user", async () => {
    const c = await makeControl();
    const a = await c.signIn();
    expect(a.account_token).toMatch(/^tka_[A-Za-z0-9_-]{43}$/);
    expect(a.account).toMatchObject({ status: "new", plan: null, server: null, email: "apple-user-1@privaterelay.appleid.com" });
    const b = await c.signIn();
    expect(b.account.id).toBe(a.account.id);
    expect(b.account_token).not.toBe(a.account_token);
    const bad = await c.req("/v1/accounts/apple", { json: { identity_token: "id:someone-else:other-nonce", nonce: "n0nce-123" } });
    expect(bad.status).toBe(401);
    expect((await c.req("/v1/accounts/me")).status).toBe(401);
    expect((await (await c.req("/v1/accounts/me", { token: a.account_token })).json()).id).toBe(a.account.id);
  });

  it("needs a subscription before pairing, then provisions a server and pairs", async () => {
    const c = await makeControl();
    const { account, account_token: t } = await c.signIn();
    const early = await c.req("/v1/accounts/me/devices", { json: { device_name: "iPhone", platform: "ios" }, token: t });
    expect(early.status).toBe(402);
    expect((await early.json()).error.code).toBe("subscription_required");

    const exp = new Date(c.clock.t + 7 * DAY).toISOString();
    const wrong = await c.req("/v1/accounts/me/transactions", { json: { signed_transaction: c.tx({ productId: "tickler.cloud.yearly", appAccountToken: "someone-else", expiresAt: exp } as any) }, token: t });
    expect(wrong.status).toBe(409);
    const pro = await c.req("/v1/accounts/me/transactions", { json: { signed_transaction: c.tx({ productId: "tickler.pro.yearly", appAccountToken: account.id, expiresAt: exp } as any) }, token: t });
    expect(pro.status).toBe(400);

    const ok = await c.req("/v1/accounts/me/transactions", { json: { signed_transaction: c.tx({ productId: "tickler.cloud.yearly", appAccountToken: account.id, expiresAt: exp } as any) }, token: t });
    expect(ok.status).toBe(200);
    const acc = await ok.json();
    expect(acc).toMatchObject({ status: "active", plan: "yearly", expires_at: exp });
    expect(acc.server.id).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/);
    expect(acc.server.url).toBe(`https://${acc.server.id}.tickler.cloud`);
    expect(c.servers.get(acc.server.id)!.status).toBe("active");

    // Idempotent: same transaction again keeps the same server.
    const again = await (await c.req("/v1/accounts/me/transactions", { json: { signed_transaction: c.tx({ productId: "tickler.cloud.yearly", appAccountToken: account.id, expiresAt: exp } as any) }, token: t })).json();
    expect(again.server.id).toBe(acc.server.id);
    expect(c.calls.filter((x) => x.startsWith("init"))).toHaveLength(1);

    const pair = await (await c.req("/v1/accounts/me/devices", { json: { device_name: "iPhone", platform: "ios" }, token: t })).json();
    expect(pair).toMatchObject({ url: acc.server.url, device_id: "dev-1", token: "tkd_test", server: { name: "Tickler Cloud", api: 1 } });

    // Another account can't claim the same subscription.
    const other = await c.signIn("apple-user-2");
    const steal = await c.req("/v1/accounts/me/transactions", { json: { signed_transaction: c.tx({ productId: "tickler.cloud.yearly", appAccountToken: other.account.id, expiresAt: exp } as any) }, token: other.account_token });
    expect(steal.status).toBe(409);
  });

  it("follows App Store notifications: grace, expiry, read-only window, then deletion", async () => {
    const c = await makeControl();
    const { account, account_token: t } = await c.signIn();
    const exp = new Date(c.clock.t + 30 * DAY).toISOString();
    const signed = c.tx({ productId: "tickler.cloud.monthly", appAccountToken: account.id, expiresAt: exp } as any);
    const acc = await (await c.req("/v1/accounts/me/transactions", { json: { signed_transaction: signed }, token: t })).json();
    const sid = acc.server.id;
    const note = (type: string, uuid: string, txOver: object = {}) =>
      c.req("/v1/webhooks/app-store", { json: { signedPayload: JSON.stringify({ notificationType: type, notificationUUID: uuid, data: { signedTransactionInfo: c.tx({ productId: "tickler.cloud.monthly", appAccountToken: account.id, expiresAt: exp, ...txOver } as any) } }) } });

    expect((await note("DID_FAIL_TO_RENEW", "n1")).status).toBe(200);
    expect((await (await c.req("/v1/accounts/me", { token: t })).json()).status).toBe("grace");
    expect(c.servers.get(sid)!.status).toBe("grace");
    // The app's launch check doesn't undo grace.
    await c.req("/v1/accounts/me/transactions", { json: { signed_transaction: signed }, token: t });
    expect((await (await c.req("/v1/accounts/me", { token: t })).json()).status).toBe("grace");

    const past = new Date(c.clock.t - DAY).toISOString();
    await note("EXPIRED", "n2", { expiresAt: past });
    expect(c.servers.get(sid)!.status).toBe("expired");
    // A retried notification is ignored.
    await note("DID_RENEW", "n2", { expiresAt: exp });
    expect(c.servers.get(sid)!.status).toBe("expired");
    // Still readable and pairable during the read-only window.
    expect((await c.req("/v1/accounts/me/devices", { json: {}, token: t })).status).toBe(200);

    c.clock.t += 31 * DAY;
    await c.daily();
    expect(c.servers.has(sid)).toBe(false);
    const after = await (await c.req("/v1/accounts/me", { token: t })).json();
    expect(after).toMatchObject({ status: "expired", server: null });

    // Resubscribing gives a fresh server.
    const fresh = await (await c.req("/v1/accounts/me/transactions", { json: { signed_transaction: c.tx({ productId: "tickler.cloud.monthly", appAccountToken: account.id, expiresAt: new Date(c.clock.t + 30 * DAY).toISOString() } as any) }, token: t })).json();
    expect(fresh.status).toBe("active");
    expect(fresh.server.id).not.toBe(sid);
  });

  it("deletes the account, its server and its tokens", async () => {
    const c = await makeControl();
    const { account, account_token: t } = await c.signIn();
    const acc = await (await c.req("/v1/accounts/me/transactions", { json: { signed_transaction: c.tx({ productId: "tickler.cloud.monthly", appAccountToken: account.id, expiresAt: new Date(c.clock.t + DAY).toISOString() } as any) }, token: t })).json();
    const del = await c.req("/v1/accounts/me", { method: "DELETE", token: t });
    expect(del.status).toBe(202);
    expect((await del.json()).status).toBe("deleting");
    expect(c.servers.has(acc.server.id)).toBe(false);
    expect((await c.req("/v1/accounts/me", { token: t })).status).toBe(401);
    expect(await c.storage.first("SELECT 1 FROM accounts")).toBeNull();
    // Signing in again starts over.
    expect((await c.signIn()).account.status).toBe("new");
  });

  it("expires a subscription whose renewal never arrived", async () => {
    const c = await makeControl();
    const { account, account_token: t } = await c.signIn();
    const acc = await (await c.req("/v1/accounts/me/transactions", { json: { signed_transaction: c.tx({ productId: "tickler.cloud.monthly", appAccountToken: account.id, expiresAt: new Date(c.clock.t + DAY).toISOString() } as any) }, token: t })).json();
    c.clock.t += 5 * DAY;
    await c.daily();
    expect(c.servers.get(acc.server.id)!.status).toBe("expired");
  });
});
