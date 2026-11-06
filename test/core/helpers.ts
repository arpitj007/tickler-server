import { join } from "node:path";
import { createApp, type AppDeps } from "../../src/app";
import { readMigrationsFromDir } from "../../src/storage/migrationsFs";
import { openSqliteStorage } from "../../src/storage/sqlite";
import { sha256b64url } from "../../src/core/util";

export const SECRET = "test-secret-0123456789abcdef";
export const PASS = "correct horse battery";
export const BASE = "http://tickler.test";

/** Responses in tests: json() typed loosely. */
export type JsonResponse = Omit<Response, "json"> & { json(): Promise<any> };

export function makeApp(over: Partial<AppDeps> & { start?: string; env?: Record<string, unknown> } = {}) {
  const clock = { t: new Date(over.start ?? "2026-11-06T10:00:00.000Z").getTime() };
  const storage = openSqliteStorage(":memory:");
  const built = createApp({
    storage,
    env: { TICKLER_SECRET: SECRET, TICKLER_SERVER_NAME: "Test", TICKLER_PUBLIC_URL: BASE, ...(over.env ?? {}) },
    migrations: readMigrationsFromDir(join(__dirname, "../../migrations")),
    providers: over.providers ?? [],
    webhookHandlers: over.webhookHandlers ?? [],
    fetch: over.fetch,
    now: () => new Date(clock.t),
    getIp: (req) => req.headers.get("x-test-ip") ?? "10.0.0.1",
  });
  const req = (path: string, init: RequestInit & { json?: unknown; token?: string; cookie?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.json !== undefined) headers.set("content-type", "application/json");
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    if (init.cookie) headers.set("cookie", init.cookie);
    const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
    return built.app.request(`${BASE}${path}`, { ...init, headers, body }) as Promise<JsonResponse>;
  };
  const form = (path: string, data: Record<string, string>, cookie?: string) =>
    req(path, {
      method: "POST",
      body: new URLSearchParams(data).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
      cookie,
    });
  const advance = (ms: number) => (clock.t += ms);
  return { ...built, storage, clock, advance, req, form };
}
export type TestApp = ReturnType<typeof makeApp>;

/** Claim the server; returns the session cookie. */
export async function claim(t: TestApp): Promise<string> {
  const r = await t.form("/setup/claim", { secret: SECRET, passphrase: PASS, passphrase2: PASS });
  if (r.status !== 302) throw new Error(`claim failed ${r.status}`);
  return cookieFrom(r);
}

export function cookieFrom(r: { headers: Headers }): string {
  const c = r.headers.get("set-cookie") ?? "";
  return c.split(";")[0]!;
}

/** Claim, pair a device, create an MCP token. */
export async function setupAll(t: TestApp) {
  const cookie = await claim(t);
  const page = await (await t.req("/setup/pair", { cookie })).text();
  const code = /class="code">([A-Z0-9]{8})/.exec(page)![1]!;
  const pair = (await (await t.req("/api/pair", { method: "POST", json: { code, device_name: "Phone", platform: "ios" } })).json()) as {
    token: string;
    device_id: string;
  };
  const tok = (await (await t.req("/api/tokens", { method: "POST", json: { name: "Claude Code" }, token: pair.token })).json()) as { secret: string };
  return { cookie, device: pair.token, deviceId: pair.device_id, mcp: tok.secret };
}

let rpcId = 0;
export async function mcp(t: TestApp, token: string, method: string, params: unknown = {}, headers: Record<string, string> = {}) {
  const r = await t.req("/mcp", {
    method: "POST",
    token,
    headers: { accept: "application/json, text/event-stream", ...headers },
    json: { jsonrpc: "2.0", id: ++rpcId, method, params },
  });
  return { status: r.status, body: (await r.json()) as any, res: r };
}

export async function tool(t: TestApp, token: string, name: string, args: Record<string, unknown>) {
  const r = await mcp(t, token, "tools/call", { name, arguments: args });
  const result = r.body.result;
  if (!result) throw new Error(`no result: ${JSON.stringify(r.body)}`);
  return { isError: !!result.isError, data: result.structuredContent as any, text: result.content?.[0]?.text as string };
}

export async function pkce() {
  const verifier = "v".repeat(20) + Math.random().toString(36).slice(2) + "x".repeat(30);
  return { verifier, challenge: await sha256b64url(verifier) };
}
