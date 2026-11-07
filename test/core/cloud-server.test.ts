import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/core/util";
import { makeApp, mcp, setupAll, type TestApp } from "./helpers";

const cloudEnv = { TICKLER_HOSTING: "cloud", TICKLER_DEMO_PAIRING_CODE: "CLOUD234" };

async function cloudDevice(t: TestApp) {
  const r = await t.req("/api/pair", { method: "POST", json: { code: "CLOUD234", device_name: "Phone", platform: "ios" } });
  return ((await r.json()) as { token: string }).token;
}

describe("hosting", () => {
  it("health reports self or cloud", async () => {
    expect((await (await makeApp().req("/api/health")).json()).hosting).toBe("self");
    expect((await (await makeApp({ env: cloudEnv }).req("/api/health")).json()).hosting).toBe("cloud");
  });

  it("cloud servers have no setup or server key pairing", async () => {
    const t = makeApp({ env: cloudEnv });
    const page = await t.req("/setup");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("managed from the Tickler app");
    expect((await t.form("/setup/claim", { secret: "test-secret-0123456789abcdef", passphrase: "x", passphrase2: "x" })).status).toBe(200);
    expect(await (await t.req("/setup/pair")).text()).not.toContain('class="code"');
    const key = await t.req("/api/pair", { method: "POST", json: { server_key: "test-secret-0123456789abcdef" } });
    expect(key.status).toBe(400);
  });
});

describe("read-only when the subscription has expired", () => {
  it("blocks API and MCP writes with subscription_required, keeps reads", async () => {
    let expired = false;
    const t = makeApp({
      env: cloudEnv,
      writeGuard: async () => {
        if (expired) throw new ApiError(402, "subscription_required", "Your Tickler Cloud subscription has ended. Renew it in the app.");
      },
    });
    const device = await cloudDevice(t);
    const tok = (await (await t.req("/api/tokens", { method: "POST", json: { name: "Agent" }, token: device })).json()).secret as string;
    const make = () => t.req("/api/projects", { method: "POST", json: { name: "P" }, token: device });
    expect((await make()).status).toBe(201);

    expired = true;
    const w = await make();
    expect(w.status).toBe(402);
    expect((await w.json()).error.code).toBe("subscription_required");
    expect((await t.req("/api/projects", { token: device })).status).toBe(200);
    expect((await t.req("/api/changes", { token: device })).status).toBe(200);
    expect((await t.req("/api/export", { token: device })).status).toBe(200);

    const call = await mcp(t, tok, "tools/call", {
      name: "create_entry",
      arguments: { project: "P", title: "x", start_at: "2026-11-07T09:00:00Z", origin: { client: "claude_code" } },
    });
    expect(call.body.result.isError).toBe(true);
    expect(call.body.result.content[0].text).toMatch(/^subscription_required/);
    const proj = await mcp(t, tok, "tools/call", { name: "create_project", arguments: { name: "Q" } });
    expect(proj.body.result.content[0].text).toMatch(/^subscription_required/);
    const list = await mcp(t, tok, "tools/call", { name: "list_projects", arguments: {} });
    expect(list.body.result.isError).toBeFalsy();

    expect((await t.req("/api/devices/me", { method: "DELETE", token: device })).status).toBe(204);
  });
});

describe("import", () => {
  it("moves everything from one server to another, keeping ids, and skips what exists", async () => {
    const a = makeApp();
    const sa = await setupAll(a);
    for (let i = 0; i < 3; i++) {
      await mcp(a, sa.mcp, "tools/call", {
        name: "create_entry",
        arguments: { project: "Launch", title: `Step ${i}`, start_at: "2026-11-10T09:00:00Z", origin: { client: "t3_code", session_id: "thread-1", open_url: "t3-thread://v1/thread-1" } },
      });
    }
    await a.req("/api/budgets", { method: "POST", json: { provider: "aws", monthly_limit: 50, currency: "USD" }, token: sa.device });
    const doc = await (await a.req("/api/export", { token: sa.device })).json();

    const b = makeApp({ env: cloudEnv });
    const device = await cloudDevice(b);
    // B already has a project with the same slug and the same agent session.
    await b.req("/api/projects", { method: "POST", json: { name: "Launch" }, token: device });
    const r = await b.req("/api/import", { method: "POST", json: doc, token: device });
    expect(r.status).toBe(200);
    const { imported } = await r.json();
    expect(imported.entries).toBe(3);
    expect(imported.projects).toBe(0);
    expect(imported.origins).toBe(1);
    expect(imported.budgets).toBe(1);

    const changes = await (await b.req("/api/changes", { token: device })).json();
    const launch = changes.projects.find((p: any) => p.slug === "launch");
    expect(changes.projects.filter((p: any) => p.slug === "launch")).toHaveLength(1);
    const ids = doc.entries.map((e: any) => e.id).sort();
    expect(changes.entries.map((e: any) => e.id).sort()).toEqual(ids);
    expect(changes.entries.every((e: any) => e.project_id === launch.id)).toBe(true);
    expect(changes.entries[0].origin_id).toBe(doc.entries[0].origin_id);
    expect(changes.origins[0].open_url).toBe("t3-thread://v1/thread-1");

    const again = await (await b.req("/api/import", { method: "POST", json: doc, token: device })).json();
    expect(Object.values(again.imported).every((n) => n === 0)).toBe(true);
  });
});
