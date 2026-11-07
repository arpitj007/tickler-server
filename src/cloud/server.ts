// One Tickler Cloud customer server: the unchanged Tickler app on its own Durable Object SQLite
// database. The 15-minute and daily jobs run on this object's alarm instead of global crons.
// https://developers.cloudflare.com/durable-objects/api/alarms/ (checked 2026-11-08)
import { DurableObject } from "cloudflare:workers";
import { createApp } from "../app";
import { issueDeviceToken } from "../core/devices";
import { ApiError, b64url } from "../core/util";
import { durableStorage } from "../storage/durable";
import { MIGRATIONS } from "../worker";
import type { AccountStatus } from "./control";

export const TICK_MS = 15 * 60_000;
export const INTERNAL_HEADER = "x-tickler-internal";

export interface CloudEnv {
  SERVERS: DurableObjectNamespace;
  CLOUD_DB: D1Database;
  CLOUD_SECRET: string;
  CLOUD_SERVER_URL: string;
  CLOUD_DOMAIN?: string;
  APPLE_BUNDLE_ID?: string;
  CLOUD_ACCEPT_SANDBOX?: string;
  APPLE_TEAM_ID?: string;
  APPLE_SIWA_KEY_ID?: string;
  APPLE_SIWA_PRIVATE_KEY?: string;
}

interface Meta {
  server_id: string;
  url: string;
  status: AccountStatus;
  last_daily?: string;
}

/** The value the control plane sends in INTERNAL_HEADER; never sent by or to clients. */
export async function internalKey(secret: string): Promise<string> {
  return hmac(secret, "internal");
}

/** Each server gets its own TICKLER_SECRET (provider key encryption), derived from CLOUD_SECRET. */
export async function serverSecret(secret: string, serverId: string): Promise<string> {
  return hmac(secret, `server:${serverId}`);
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg))));
}

export class TicklerServer extends DurableObject<CloudEnv> {
  private meta: Meta | null = null;
  private built: ReturnType<typeof createApp> | null = null;

  private async loadMeta(): Promise<Meta | null> {
    this.meta ??= (await this.ctx.storage.get<Meta>("meta")) ?? null;
    return this.meta;
  }

  private async saveMeta(m: Meta) {
    this.meta = m;
    await this.ctx.storage.put("meta", m);
  }

  private async app() {
    const m = (await this.loadMeta())!;
    this.built ??= createApp({
      storage: durableStorage(this.ctx.storage),
      env: {
        TICKLER_SECRET: await serverSecret(this.env.CLOUD_SECRET, m.server_id),
        TICKLER_SERVER_NAME: "Tickler Cloud",
        TICKLER_PUBLIC_URL: m.url,
        TICKLER_CURRENCY: "USD",
        TICKLER_HOSTING: "cloud",
      },
      migrations: MIGRATIONS,
      getIp: (req) => req.headers.get("cf-connecting-ip") ?? undefined,
      writeGuard: async () => {
        if (this.meta?.status === "expired") {
          throw new ApiError(402, "subscription_required", "Your Tickler Cloud subscription has ended, so this server is read-only. Renew it in the Tickler app.");
        }
      },
    });
    return this.built;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/__cloud/")) return this.internal(req, url.pathname.slice("/__cloud/".length));
    if (!(await this.loadMeta())) return Response.json({ error: { code: "not_found", message: "No such Tickler Cloud server" } }, { status: 404 });
    const { app } = await this.app();
    return app.fetch(req, {}, { waitUntil: (p: Promise<unknown>) => this.ctx.waitUntil(p), passThroughOnException() {}, props: {} } as ExecutionContext);
  }

  private async internal(req: Request, action: string): Promise<Response> {
    if (req.headers.get(INTERNAL_HEADER) !== (await internalKey(this.env.CLOUD_SECRET))) return new Response("forbidden", { status: 403 });
    const b = (req.method === "POST" ? await req.json().catch(() => ({})) : {}) as Record<string, string>;
    switch (action) {
      case "init": {
        if (!(await this.loadMeta())) await this.saveMeta({ server_id: b.server_id!, url: b.url!, status: b.status as AccountStatus });
        await (await this.app()).app.fetch(new Request(`${b.url}/api/health`)); // runs the migrations
        if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
        return Response.json({ ok: true });
      }
      case "status": {
        const m = await this.loadMeta();
        if (!m) return new Response("not found", { status: 404 });
        await this.saveMeta({ ...m, status: b.status as AccountStatus });
        return Response.json({ ok: true });
      }
      case "devices": {
        if (!(await this.loadMeta())) return new Response("not found", { status: 404 });
        const { ctx, app } = await this.app();
        await app.fetch(new Request(`${this.meta!.url}/api/health`)); // runs migrations if needed
        return Response.json(await issueDeviceToken(ctx, b.device_name ?? "Phone", b.platform ?? "other"));
      }
      case "purge": {
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        this.meta = null;
        this.built = null;
        return Response.json({ ok: true });
      }
    }
    return new Response("unknown action", { status: 404 });
  }

  async alarm(): Promise<void> {
    const m = await this.loadMeta();
    if (!m) return;
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    if (m.status === "expired" || m.status === "deleting") return; // read-only: no syncs
    const built = await this.app();
    try {
      await built.scheduled("tick");
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      if (now.getUTCHours() >= 6 && m.last_daily !== today) {
        await built.scheduled("daily");
        await this.saveMeta({ ...m, last_daily: today });
      }
    } catch (e) {
      console.error("scheduled run failed", m.server_id, e);
    }
  }
}
