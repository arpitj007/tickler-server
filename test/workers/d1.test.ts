import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker, { MIGRATIONS } from "../../src/worker";
import { d1Storage } from "../../src/storage/d1";
import { migrate } from "../../src/storage/migrate";

const B = "https://tickler.test";
const e = env as unknown as Parameters<typeof worker.fetch>[1];

async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${B}${path}`, init), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("D1 storage in workerd", () => {
  it("migrates and keeps a global rev sequence", async () => {
    const s = d1Storage(e.DB);
    await migrate(s, MIGRATIONS);
    expect(await migrate(s, MIGRATIONS)).toEqual([]);
    await s.batch([
      { sql: "UPDATE seq SET value = value + 1 WHERE id = 1" },
      { sql: "INSERT INTO projects (id, name, slug, color, icon, created_at, updated_at, rev) VALUES ('p1','P','p','#000000','folder','x','x',(SELECT value FROM seq WHERE id = 1))" },
    ]);
    const row = await s.first<{ rev: number }>("SELECT rev FROM projects WHERE id = 'p1'");
    expect(row!.rev).toBeGreaterThan(0);
    const r = await s.first<{ count: number }>("INSERT INTO rate_limits (key, window_start, count) VALUES ('k', 1, 1) ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count");
    expect(r!.count).toBe(1);
  });

  it("serves the API, setup claim, pairing and MCP from the Worker", async () => {
    expect((await (await call("/api/health")).json<{ ok: boolean }>()).ok).toBe(true);
    const form = (path: string, data: Record<string, string>, cookie?: string) =>
      call(path, { method: "POST", body: new URLSearchParams(data), headers: { origin: B, ...(cookie ? { cookie } : {}) }, redirect: "manual" });
    const claim = await form("/setup/claim", { secret: "workers-test-secret-0123456789", passphrase: "a long passphrase", passphrase2: "a long passphrase" });
    expect(claim.status).toBe(302);
    const cookie = claim.headers.get("set-cookie")!.split(";")[0]!;
    const page = await (await call("/setup/pair", { headers: { cookie } })).text();
    const code = /class="code">([A-Z0-9]{8})/.exec(page)![1]!;
    const pair = await (await call("/api/pair", { method: "POST", body: JSON.stringify({ code, device_name: "W" }), headers: { "content-type": "application/json" } })).json<{ token: string }>();
    const tok = await (
      await call("/api/tokens", { method: "POST", body: JSON.stringify({ name: "w" }), headers: { authorization: `Bearer ${pair.token}`, "content-type": "application/json" } })
    ).json<{ secret: string }>();
    const rpc = async (body: unknown) =>
      (await call("/mcp", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { authorization: `Bearer ${tok.secret}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      })).json<any>();
    const args = { project: "W", title: "From workerd", start_at: "2026-12-01T09:00:00Z", external_key: "w1", origin: { client: "claude_code", session_id: "w" } };
    const a = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_entry", arguments: args } });
    const b = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_entry", arguments: args } });
    expect(a.result.structuredContent.created).toBe(true);
    expect(b.result.structuredContent.created).toBe(false);
    expect(b.result.structuredContent.entry.id).toBe(a.result.structuredContent.entry.id);
  });
});
