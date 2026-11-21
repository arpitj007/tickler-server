import { describe, expect, it } from "vitest";
import { makeApp, setupAll, tool, type TestApp } from "./helpers";

const T3_THREAD = "0c547790-c32a-4b2e-b4a1-7140edcd4172";
const HEARTBEAT = {
  machine: "Mac.lan",
  name: "AJ's MacBook Pro",
  version: "0.1.0",
  runners: [{ client: "t3_code", version: "0.1.3" }, { client: "claude_code", version: "2.1.308" }],
  projects: [{ project_id: "p1", cwd: "/Users/aj/dev/tickler-app", client: "t3_code" }],
};

async function setup() {
  const t = makeApp();
  const s = await setupAll(t);
  const code = (await (await t.req("/api/bridge-codes", { method: "POST", token: s.device })).json()) as { code: string; command: string };
  const pair = await t.req("/api/bridge/pair", { method: "POST", json: { code: code.code, machine: "Mac.lan", name: "AJ's MacBook Pro" } });
  const bridge = (await pair.json()) as { bridge_id: string; token: string };
  return { t, ...s, bridge: bridge.token, bridgeId: bridge.bridge_id, command: code.command, pairStatus: pair.status };
}

const beat = (t: TestApp, token: string, body: unknown = HEARTBEAT) => t.req("/api/bridge/heartbeat", { method: "POST", token, json: body });
const dispatch = (t: TestApp, token: string, body: Record<string, unknown>) =>
  t.req("/api/dispatches", { method: "POST", token, json: { id: crypto.randomUUID(), project_id: "p1", message: "Build the paywall", ...body } });

/** An origin like the one an agent creates through MCP. */
async function t3Origin(t: TestApp, mcp: string, machine: string | null = null) {
  const r = await tool(t, mcp, "create_entry", {
    project: "Tickler",
    title: "Ship it",
    origin: { client: "t3_code", session_id: T3_THREAD, open_url: `t3-thread://v1/${T3_THREAD}`, machine },
  });
  return r.data.entry.origin_id as string;
}

describe("bridge pairing", () => {
  it("the phone makes a one-time code; the bridge gets a tkb_ token that only reaches bridge routes", async () => {
    const { t, device, bridge, command, pairStatus } = await setup();
    expect(pairStatus).toBe(201);
    expect(bridge).toMatch(/^tkb_/);
    expect(command).toMatch(/^npx tickler bridge install --server http:\/\/tickler\.test --code [A-Z0-9]{8}$/);
    // Single use.
    const code = command.split(" ").pop()!;
    const again = await t.req("/api/bridge/pair", { method: "POST", json: { code, machine: "x" } });
    expect((await again.json()).error.code).toBe("pairing_expired");
    // A bridge can't read entries, list devices or create dispatches.
    for (const [method, path] of [["GET", "/api/entries"], ["GET", "/api/devices"], ["GET", "/api/bridges"], ["POST", "/api/dispatches"]] as const) {
      const r = await t.req(path, { method, token: bridge, json: method === "POST" ? {} : undefined });
      expect(r.status, path).toBe(403);
    }
    // A phone can't act as a bridge.
    expect((await t.req("/api/bridge/next", { token: device })).status).toBe(403);
    expect((await beat(t, device)).status).toBe(403);
  });

  it("a /setup pairing code also works, and expired codes don't", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const page = await (await t.req("/setup/pair", { cookie: s.cookie })).text();
    const code = /class="code">([A-Z0-9]{8})/.exec(page)![1]!;
    expect((await t.req("/api/bridge/pair", { method: "POST", json: { code, machine: "linux-box" } })).status).toBe(201);
    const c2 = (await (await t.req("/api/bridge-codes", { method: "POST", token: s.device })).json()).code;
    t.advance(15 * 60_000 + 1);
    expect((await t.req("/api/bridge/pair", { method: "POST", json: { code: c2, machine: "x" } })).status).toBe(400);
  });

  it("MCP and OAuth-style agent tokens can never create dispatches or make bridge codes", async () => {
    const { t, mcp } = await setup();
    expect((await dispatch(t, mcp, { new_session: { client: "t3_code", cwd: "/tmp" } })).status).toBe(401);
    expect((await t.req("/api/bridge-codes", { method: "POST", token: mcp })).status).toBe(401);
    const tools = (await (await t.req("/mcp", {
      method: "POST",
      token: mcp,
      headers: { accept: "application/json, text/event-stream" },
      json: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    })).json()) as { result: { tools: { name: string }[] } };
    expect(tools.result.tools.map((x) => x.name).filter((n) => /dispatch|bridge|run/i.test(n))).toEqual([]);
  });
});

describe("bridges", () => {
  it("heartbeat makes a bridge online for 90 s; the phone lists it and can remove it", async () => {
    const { t, device, bridge, bridgeId } = await setup();
    const hb = await beat(t, bridge, { ...HEARTBEAT, runners: [...HEARTBEAT.runners, { client: "chatgpt" }] });
    expect(hb.status).toBe(200);
    expect((await hb.json()).bridge.runners.map((r: { client: string }) => r.client)).toEqual(["t3_code", "claude_code"]);
    let list = (await (await t.req("/api/bridges", { token: device })).json()).bridges;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: bridgeId, machine: "Mac.lan", name: "AJ's MacBook Pro", online: true, projects: HEARTBEAT.projects });
    t.advance(91_000);
    list = (await (await t.req("/api/bridges", { token: device })).json()).bridges;
    expect(list[0].online).toBe(false);
    expect((await t.req(`/api/bridges/${bridgeId}`, { method: "DELETE", token: device })).status).toBe(204);
    expect((await beat(t, bridge)).status).toBe(401);
  });
});

describe("dispatches", () => {
  it("resume a T3 session: queued, claimed by the bridge, sent", async () => {
    const { t, device, bridge, mcp } = await setup();
    await beat(t, bridge);
    const originId = await t3Origin(t, mcp);
    const id = crypto.randomUUID();
    const r = await dispatch(t, device, { id, origin_id: originId, entry_id: "e1" });
    expect(r.status).toBe(201);
    const d = (await r.json()).dispatch;
    expect(d).toMatchObject({ id, status: "queued", client: "t3_code", session_id: T3_THREAD, machine: "Mac.lan", entry_id: "e1" });
    expect(Date.parse(d.expires_at) - Date.parse(d.created_at)).toBe(10 * 60_000);
    // Same id: same dispatch, not a second one.
    const again = await dispatch(t, device, { id, origin_id: originId });
    expect(again.status).toBe(200);
    expect((await again.json()).dispatch.id).toBe(id);

    const next = await t.req("/api/bridge/next?wait=0", { token: bridge });
    expect(next.status).toBe(200);
    expect((await next.json()).dispatch).toMatchObject({ id, status: "claimed", message: "Build the paywall", session_id: T3_THREAD });
    expect((await t.req("/api/bridge/next?wait=0", { token: bridge })).status).toBe(204);

    const res = await t.req(`/api/dispatches/${id}/result`, { method: "POST", token: bridge, json: { status: "sent", detail: "Queued as the next turn" } });
    expect(res.status).toBe(200);
    const got = (await (await t.req(`/api/dispatches/${id}`, { token: device })).json()).dispatch;
    expect(got).toMatchObject({ status: "sent", detail: "Queued as the next turn" });
    expect((await t.req(`/api/dispatches/${id}`, { method: "DELETE", token: device })).status).toBe(409);
  });

  it("the session id comes from a T3 open_url when the origin has none", async () => {
    const { t, device, bridge, mcp } = await setup();
    await beat(t, bridge);
    const r = await tool(t, mcp, "create_entry", {
      project: "Tickler",
      title: "x",
      origin: { client: "t3_code", title: "Chat", open_url: `t3-thread://v1/${T3_THREAD}` },
    });
    const d = (await (await dispatch(t, device, { origin_id: r.data.entry.origin_id })).json()).dispatch;
    expect(d.session_id).toBe(T3_THREAD);
  });

  it("a new session: the bridge reports the session it started and the server records the origin", async () => {
    const { t, device, bridge } = await setup();
    await beat(t, bridge);
    const id = crypto.randomUUID();
    const r = await dispatch(t, device, { id, new_session: { client: "claude_code", cwd: "/Users/aj/dev/tickler-app" }, machine: "Mac.local" });
    expect(r.status).toBe(201);
    await t.req("/api/bridge/next?wait=0", { token: bridge });
    await t.req(`/api/dispatches/${id}/result`, { method: "POST", token: bridge, json: { status: "running" } });
    const long = "x".repeat(2500) + "THE END";
    const done = await t.req(`/api/dispatches/${id}/result`, {
      method: "POST",
      token: bridge,
      json: { status: "done", detail: long, session_id: "sess-123" },
    });
    const d = (await done.json()).dispatch;
    expect(d.status).toBe("done");
    expect(d.detail.length).toBe(2000);
    expect(d.detail.endsWith("THE END")).toBe(true);
    expect(d.session_id).toBe("sess-123");
    const origin = (await (await t.req(`/api/origins/${d.origin_id}`, { token: device })).json()).origin;
    expect(origin).toMatchObject({ client: "claude_code", session_id: "sess-123", cwd: "/Users/aj/dev/tickler-app", title: "Build the paywall" });
    // Final: no more changes.
    expect((await t.req(`/api/dispatches/${id}/result`, { method: "POST", token: bridge, json: { status: "failed" } })).status).toBe(409);
    const listed = (await (await t.req("/api/dispatches?project_id=p1", { token: device })).json()).dispatches;
    expect(listed.map((x: { id: string }) => x.id)).toEqual([id]);
  });

  it("422 no_runner when no online bridge runs that client or machine; validation", async () => {
    const { t, device, bridge, mcp } = await setup();
    // Bridge offline.
    let r = await dispatch(t, device, { new_session: { client: "t3_code", cwd: "/tmp" } });
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe("no_runner");
    await beat(t, bridge);
    expect((await (await dispatch(t, device, { new_session: { client: "codex", cwd: "/tmp" } })).json()).error.code).toBe("no_runner");
    expect((await (await dispatch(t, device, { new_session: { client: "chatgpt", cwd: "/tmp" } })).json()).error.code).toBe("no_runner");
    const other = await t3Origin(t, mcp, "other-laptop");
    expect((await (await dispatch(t, device, { origin_id: other })).json()).error.code).toBe("no_runner");
    // Exactly one of origin_id and new_session; message 1 to 16,000 characters.
    expect((await dispatch(t, device, {})).status).toBe(422);
    expect((await dispatch(t, device, { origin_id: other, new_session: { client: "t3_code", cwd: "/tmp" } })).status).toBe(422);
    expect((await dispatch(t, device, { message: "", new_session: { client: "t3_code", cwd: "/tmp" } })).status).toBe(422);
    expect((await dispatch(t, device, { message: "x".repeat(16_001), new_session: { client: "t3_code", cwd: "/tmp" } })).status).toBe(422);
    expect((await dispatch(t, device, { message: "x".repeat(16_000), new_session: { client: "t3_code", cwd: "/tmp" } })).status).toBe(201);
  });

  it("a dispatch for one machine only goes to that machine's bridge", async () => {
    const { t, device, bridge } = await setup();
    const c2 = (await (await t.req("/api/bridge-codes", { method: "POST", token: device })).json()).code;
    const b2 = (await (await t.req("/api/bridge/pair", { method: "POST", json: { code: c2, machine: "studio" } })).json()).token;
    await beat(t, bridge);
    await beat(t, b2, { ...HEARTBEAT, machine: "studio" });
    const id = crypto.randomUUID();
    await dispatch(t, device, { id, new_session: { client: "t3_code", cwd: "/tmp" }, machine: "studio" });
    expect((await t.req("/api/bridge/next?wait=0", { token: bridge })).status).toBe(204);
    expect((await (await t.req("/api/bridge/next?wait=0", { token: b2 })).json()).dispatch.id).toBe(id);
    // Another bridge can't report on it.
    expect((await t.req(`/api/dispatches/${id}/result`, { method: "POST", token: bridge, json: { status: "sent" } })).status).toBe(404);
  });

  it("cancel while queued; unclaimed dispatches expire after 10 minutes; a lost claim retries once then fails", async () => {
    const { t, device, bridge } = await setup();
    await beat(t, bridge);
    const ns = { new_session: { client: "t3_code", cwd: "/tmp" } };
    const a = crypto.randomUUID();
    await dispatch(t, device, { id: a, ...ns });
    expect((await t.req(`/api/dispatches/${a}`, { method: "DELETE", token: device })).status).toBe(204);
    expect((await t.req(`/api/dispatches/${a}`, { token: device })).status).toBe(404);

    const b = crypto.randomUUID();
    await dispatch(t, device, { id: b, ...ns });
    t.advance(10 * 60_000);
    expect((await (await t.req(`/api/dispatches/${b}`, { token: device })).json()).dispatch.status).toBe("expired");
    expect((await t.req("/api/bridge/next?wait=0", { token: bridge })).status).toBe(204);

    await beat(t, bridge);
    const c = crypto.randomUUID();
    await dispatch(t, device, { id: c, ...ns });
    expect((await t.req("/api/bridge/next?wait=0", { token: bridge })).status).toBe(200);
    t.advance(10 * 60_000);
    expect((await (await t.req("/api/bridge/next?wait=0", { token: bridge })).json()).dispatch.id).toBe(c);
    t.advance(10 * 60_000);
    expect((await t.req("/api/bridge/next?wait=0", { token: bridge })).status).toBe(204);
    expect((await (await t.req(`/api/dispatches/${c}`, { token: device })).json()).dispatch.status).toBe("failed");
  });

  it("30 per hour per phone, and dispatches are deleted after 30 days", async () => {
    const { t, device, bridge } = await setup();
    await beat(t, bridge);
    const ns = { new_session: { client: "t3_code", cwd: "/tmp" } };
    for (let i = 0; i < 30; i++) expect((await dispatch(t, device, ns)).status).toBe(201);
    const over = await dispatch(t, device, ns);
    expect(over.status).toBe(429);
    t.advance(31 * 24 * 3600_000);
    await t.scheduled("daily");
    expect((await (await t.req("/api/dispatches?limit=100", { token: device })).json()).dispatches).toEqual([]);
  });
});
