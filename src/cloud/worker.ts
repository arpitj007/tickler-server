// Tickler Cloud Worker: the control plane at https://tickler.cloud and every customer server at
// https://<id>.tickler.cloud (or, without the domain, https://<worker host>/s/<id> on staging).
import { createControl, type AccountStatus, type ServerDirectory } from "./control";
import { INTERNAL_HEADER, TicklerServer, internalKey, type CloudEnv } from "./server";
import { d1Storage } from "../storage/d1";
import { migrate } from "../storage/migrate";
import c0001 from "../../migrations-cloud/0001_accounts.sql";

export { TicklerServer };

export const CLOUD_MIGRATIONS = [{ name: "0001_accounts.sql", sql: c0001 }];
const ID = "[abcdefghjkmnpqrstuvwxyz23456789]{10}";
const PATH_SERVER = new RegExp(`^/s/(${ID})(/.*)?$`);
const WELL_KNOWN = new RegExp(`^/\\.well-known/(oauth-protected-resource|oauth-authorization-server)/s/(${ID})(/.*)?$`);

function directory(env: CloudEnv): ServerDirectory {
  const call = async (serverId: string, action: string, body: unknown) => {
    const stub = env.SERVERS.get(env.SERVERS.idFromName(serverId));
    const res = await stub.fetch(`https://internal/__cloud/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", [INTERNAL_HEADER]: await internalKey(env.CLOUD_SECRET) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`server ${serverId} ${action}: HTTP ${res.status}`);
    return res.json();
  };
  return {
    init: async (id, url, status) => void (await call(id, "init", { server_id: id, url, status })),
    setStatus: async (id, status: AccountStatus) => void (await call(id, "status", { status })),
    pairDevice: (id, device_name, platform) => call(id, "devices", { device_name, platform }) as Promise<{ device_id: string; token: string }>,
    purge: async (id) => void (await call(id, "purge", {})),
  };
}

let control: ReturnType<typeof createControl> | null = null;
let migrated: Promise<unknown> | null = null;
function getControl(env: CloudEnv) {
  const storage = d1Storage(env.CLOUD_DB);
  migrated ??= migrate(storage, CLOUD_MIGRATIONS).catch((e) => {
    migrated = null;
    throw e;
  });
  control ??= createControl({
    storage,
    servers: directory(env),
    secret: env.CLOUD_SECRET,
    serverUrlTemplate: env.CLOUD_SERVER_URL,
    apple: {
      bundleId: env.APPLE_BUNDLE_ID ?? "com.gettickler.tickler",
      acceptSandbox: env.CLOUD_ACCEPT_SANDBOX === "true",
      teamId: env.APPLE_TEAM_ID ?? null,
      siwaKeyId: env.APPLE_SIWA_KEY_ID ?? null,
      siwaPrivateKey: env.APPLE_SIWA_PRIVATE_KEY ?? null,
    },
  });
  return control;
}

/** Forward a public request to a customer server, with `path` as the path it sees. */
function toServer(env: CloudEnv, serverId: string, req: Request, path: string): Promise<Response> | Response {
  if (path.startsWith("/__cloud")) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  url.pathname = path || "/";
  const headers = new Headers(req.headers);
  headers.delete(INTERNAL_HEADER);
  const stub = env.SERVERS.get(env.SERVERS.idFromName(serverId));
  return stub.fetch(new Request(url, { method: req.method, headers, body: req.body, redirect: "manual" }));
}

export default {
  async fetch(req: Request, env: CloudEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const domain = env.CLOUD_DOMAIN?.toLowerCase();
    if (domain && url.hostname.endsWith(`.${domain}`)) {
      const sub = url.hostname.slice(0, -domain.length - 1);
      if (new RegExp(`^${ID}$`).test(sub)) return toServer(env, sub, req, url.pathname);
      return new Response("Not found", { status: 404 });
    }
    const p = PATH_SERVER.exec(url.pathname);
    if (p) return toServer(env, p[1]!, req, p[2] ?? "/");
    const w = WELL_KNOWN.exec(url.pathname);
    if (w) return toServer(env, w[2]!, req, `/.well-known/${w[1]}${w[3] ?? ""}`);
    const c = getControl(env);
    await migrated;
    return c.app.fetch(req, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: CloudEnv, ctx: ExecutionContext) {
    const c = getControl(env);
    ctx.waitUntil(migrated!.then(() => c.daily()));
  },
} satisfies ExportedHandler<CloudEnv>;
