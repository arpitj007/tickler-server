import { describe, expect, it } from "vitest";
import { makeApp, mcp, setupAll, tool } from "./helpers";

const origin = { client: "claude_code", session_id: "sess-1", cwd: "/repo", resume_command: "cd /repo && claude --resume sess-1" };

describe("MCP transport and auth", () => {
  it("401 with WWW-Authenticate pointing at protected resource metadata", async () => {
    const t = makeApp();
    const r = await t.req("/mcp", { method: "POST", json: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain('resource_metadata="http://tickler.test/.well-known/oauth-protected-resource/mcp"');
  });

  it("device tokens are not accepted at /mcp; GET is 405", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    expect((await mcp(t, s.device, "tools/list")).status).toBe(401);
    expect((await t.req("/mcp", { token: s.mcp })).status).toBe(405);
  });

  it("refuses a foreign Origin (DNS rebinding)", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const r = await mcp(t, s.mcp, "tools/list", {}, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });

  it("initialize and tools/list expose every tool with descriptions", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const init = await mcp(t, s.mcp, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.body.result.serverInfo.name).toBe("tickler");
    const list = await mcp(t, s.mcp, "tools/list");
    const names = list.body.result.tools.map((x: { name: string }) => x.name).sort();
    expect(names).toEqual(
      ["complete_entry", "create_entry", "create_project", "delete_entry", "get_money_summary", "list_entries", "list_origins", "list_projects", "mark_important", "update_entry"].sort(),
    );
    for (const x of list.body.result.tools) expect(x.description.length).toBeGreaterThan(40);
  });
});

describe("MCP tools", () => {
  it("create_entry creates the project, returns a tickler:// url and is idempotent by external_key", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const args = { project: "Launch", title: "Submit build", start_at: "2026-11-20T09:00:00Z", external_key: "submit", origin };
    const a = await tool(t, s.mcp, "create_entry", args);
    expect(a.isError).toBe(false);
    expect(a.data.created).toBe(true);
    expect(a.data.url).toBe(`tickler://entry/${a.data.entry.id}`);
    expect(a.data.entry.source).toBe("agent");
    const b = await tool(t, s.mcp, "create_entry", { ...args, title: "Submit build 2" });
    expect(b.data.created).toBe(false);
    expect(b.data.entry.id).toBe(a.data.entry.id);
    expect(b.data.entry.title).toBe("Submit build 2");
    const n = await t.storage.first<{ n: number }>("SELECT COUNT(*) AS n FROM entries");
    expect(n!.n).toBe(1);
    expect((await t.storage.first<{ n: number }>("SELECT COUNT(*) AS n FROM projects"))!.n).toBe(1);
  });

  it("same key in another project is a different entry", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    await tool(t, s.mcp, "create_entry", { project: "A", title: "x", start_at: "2026-11-20T09:00:00Z", external_key: "k", origin });
    const b = await tool(t, s.mcp, "create_entry", { project: "B", title: "x", start_at: "2026-11-20T09:00:00Z", external_key: "k", origin });
    expect(b.data.created).toBe(true);
  });

  it("validates times: over 2 years out, undated non-task, bad zone", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const far = await tool(t, s.mcp, "create_entry", { project: "A", title: "x", start_at: "2029-01-01T00:00:00Z", origin });
    expect(far.isError).toBe(true);
    expect(far.text).toContain("2 years");
    const undated = await tool(t, s.mcp, "create_entry", { project: "A", title: "x", kind: "deadline", origin });
    expect(undated.isError).toBe(true);
    const task = await tool(t, s.mcp, "create_entry", { project: "A", title: "x", origin });
    expect(task.isError).toBe(false);
    expect(task.data.entry.start_at).toBeNull();
    const tz = await tool(t, s.mcp, "create_entry", { project: "A", title: "x", start_at: "2026-11-20T09:00", timezone: "Mars/Olympus", origin });
    expect(tz.isError).toBe(true);
  });

  it("reads local wall times in the entry's time zone", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const r = await tool(t, s.mcp, "create_entry", { project: "A", title: "x", start_at: "2026-11-20T09:00", timezone: "Europe/Berlin", origin });
    expect(r.data.entry.start_at).toBe("2026-11-20T08:00:00.000Z");
  });

  it("update_entry, mark_important, complete_entry, delete_entry by id and by key", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const a = await tool(t, s.mcp, "create_entry", { project: "Launch", title: "Review", start_at: "2026-11-20T09:00:00Z", external_key: "rev", origin });
    const id = a.data.entry.id;
    const u = await tool(t, s.mcp, "update_entry", { project: "Launch", external_key: "rev", start_at: "2026-11-21T09:00:00Z", notes: "moved", origin });
    expect(u.data.entry.start_at).toBe("2026-11-21T09:00:00.000Z");
    expect(u.data.entry.notes).toBe("moved");
    const m = await tool(t, s.mcp, "mark_important", { id, importance: "critical", reason: "launch window", origin });
    expect(m.data.entry.importance).toBe("critical");
    expect(m.data.entry.notes).toContain("launch window");
    const c = await tool(t, s.mcp, "complete_entry", { id, note: "shipped", origin });
    expect(c.data.entry.status).toBe("done");
    expect(c.data.entry.completed_at).toBeTruthy();
    // a re-run of create_entry never reopens it
    const again = await tool(t, s.mcp, "create_entry", { project: "Launch", title: "Review", start_at: "2026-11-20T09:00:00Z", external_key: "rev", origin });
    expect(again.data.entry.status).toBe("done");
    const d = await tool(t, s.mcp, "delete_entry", { project: "Launch", external_key: "rev", origin });
    expect(d.data.entry.deleted_at).toBeTruthy();
    const missing = await tool(t, s.mcp, "update_entry", { id: "00000000-0000-4000-8000-000000000000", title: "x", origin });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("not_found");
  });

  it("list_entries filters by range, project, status, query; list_projects and create_project", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    await tool(t, s.mcp, "create_entry", { project: "A", title: "Alpha check", start_at: "2026-11-10T09:00:00Z", origin });
    await tool(t, s.mcp, "create_entry", { project: "B", title: "Beta check", start_at: "2026-12-10T09:00:00Z", importance: "important", origin });
    const all = await tool(t, s.mcp, "list_entries", {});
    expect(all.data.entries).toHaveLength(2);
    const nov = await tool(t, s.mcp, "list_entries", { from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z" });
    expect(nov.data.entries.map((e: { title: string }) => e.title)).toEqual(["Alpha check"]);
    expect((await tool(t, s.mcp, "list_entries", { project: "B" })).data.entries).toHaveLength(1);
    expect((await tool(t, s.mcp, "list_entries", { query: "Beta" })).data.entries).toHaveLength(1);
    expect((await tool(t, s.mcp, "list_entries", { importance: "important" })).data.entries).toHaveLength(1);
    expect((await tool(t, s.mcp, "list_entries", { project: "Nope" })).data.entries).toHaveLength(0);
    const cp = await tool(t, s.mcp, "create_project", { name: "C", color: "#112233" });
    expect(cp.data.created).toBe(true);
    expect((await tool(t, s.mcp, "create_project", { name: "c" })).data.created).toBe(false);
    expect((await tool(t, s.mcp, "list_projects", {})).data.projects).toHaveLength(3);
  });

  it("origins: upsert on (client, session_id), keeps hook values, links parents", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    await tool(t, s.mcp, "create_entry", { project: "A", title: "one", origin });
    await tool(t, s.mcp, "create_entry", { project: "A", title: "two", origin: { client: "claude_code", session_id: "sess-1", title: "Chat title" } });
    const rows = await t.storage.all<{ resume_command: string; title: string }>("SELECT * FROM origins WHERE session_id = 'sess-1'");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resume_command).toBe(origin.resume_command); // kept
    expect(rows[0]!.title).toBe("Chat title"); // filled
    await tool(t, s.mcp, "create_entry", { project: "A", title: "sub", origin: { client: "claude_code", session_id: "sub-1", parent_session_id: "sess-1" } });
    const sub = await t.storage.first<{ parent_origin_id: string }>("SELECT parent_origin_id FROM origins WHERE session_id = 'sub-1'");
    const parent = await t.storage.first<{ id: string }>("SELECT id FROM origins WHERE session_id = 'sess-1'");
    expect(sub!.parent_origin_id).toBe(parent!.id);
    const lo = await tool(t, s.mcp, "list_origins", { client: "claude_code" });
    expect(lo.data.origins).toHaveLength(2);
    expect((await tool(t, s.mcp, "list_origins", { project: "A" })).data.origins).toHaveLength(2);
  });

  it("origins without session id: one row per client, title, token and day", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const o = { client: "cursor", title: "Refactor" };
    await tool(t, s.mcp, "create_entry", { project: "A", title: "1", origin: o });
    await tool(t, s.mcp, "create_entry", { project: "A", title: "2", origin: o });
    expect((await t.storage.first<{ n: number }>("SELECT COUNT(*) AS n FROM origins"))!.n).toBe(1);
    t.advance(86400_000);
    await tool(t, s.mcp, "create_entry", { project: "A", title: "3", origin: o });
    expect((await t.storage.first<{ n: number }>("SELECT COUNT(*) AS n FROM origins"))!.n).toBe(2);
  });

  it("missing origin is accepted and flagged; client guessed from the token name, else other", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const r = await tool(t, s.mcp, "create_entry", { project: "A", title: "x" });
    expect(r.isError).toBe(false);
    expect(r.data.entry.origin_flagged).toBe(true);
    const o = await t.storage.first<{ client: string }>("SELECT client FROM origins WHERE id = ?", [r.data.entry.origin_id]);
    expect(o!.client).toBe("claude_code"); // token is named "Claude Code"
    const tok = (await (await t.req("/api/tokens", { method: "POST", json: { name: "my script" }, token: s.device })).json()).secret;
    const r2 = await tool(t, tok, "create_entry", { project: "A", title: "y" });
    const o2 = await t.storage.first<{ client: string }>("SELECT client FROM origins WHERE id = ?", [r2.data.entry.origin_id]);
    expect(o2!.client).toBe("other");
    // a later write with an origin clears the flag
    const u = await tool(t, s.mcp, "update_entry", { id: r.data.entry.id, notes: "n", origin });
    expect(u.data.entry.origin_flagged).toBe(false);
    expect(u.data.entry.last_origin_id).not.toBe(u.data.entry.origin_id);
  });

  it("60 writes a minute per token", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    for (let i = 0; i < 60; i++) {
      const r = await tool(t, s.mcp, "create_entry", { project: "A", title: `t${i}`, origin });
      expect(r.isError).toBe(false);
    }
    const over = await tool(t, s.mcp, "create_entry", { project: "A", title: "too many", origin });
    expect(over.isError).toBe(true);
    expect(over.text).toContain("rate_limited");
    expect((await tool(t, s.mcp, "list_entries", {})).isError).toBe(false); // reads still fine
    t.advance(61_000);
    expect((await tool(t, s.mcp, "create_entry", { project: "A", title: "later", origin })).isError).toBe(false);
  });

  it("every write is in the activity log, and the Test button sees the call", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const before = t.clock.t;
    await tool(t, s.mcp, "create_entry", { project: "A", title: "x", origin });
    const acts = await t.storage.all<{ action: string; actor_type: string; origin_id: string | null }>("SELECT * FROM activity WHERE action = 'create_entry'");
    expect(acts).toHaveLength(1);
    expect(acts[0]!.actor_type).toBe("mcp_token");
    expect(acts[0]!.origin_id).toBeTruthy();
    const last = await (await t.req(`/api/mcp/last-call?since=${new Date(before - 1000).toISOString()}`, { token: s.device })).json();
    expect(last.token_name).toBe("Claude Code");
  });

  it("get_money_summary returns month totals", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    await t.req("/api/metrics", { method: "POST", token: s.mcp, json: { metric: "cost", unit: "USD", value: 12.5, period_start: "2026-11-02" } });
    const r = await tool(t, s.mcp, "get_money_summary", { month: "2026-11" });
    expect(r.isError).toBe(false);
    expect(r.data.month).toBe("2026-11");
    expect(r.data.costs.value).toBe(12.5);
  });
});
