import { createExecutionContext, env, runDurableObjectAlarm, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../../src/cloud/worker";
import { INTERNAL_HEADER, internalKey, type CloudEnv } from "../../src/cloud/server";

const e = env as unknown as CloudEnv;
const ID = "k7q2mxrpab";
const BASE = `https://cloud.test/s/${ID}`;

async function call(url: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(url, init), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
async function internal(action: string, body: unknown, key?: string) {
  const stub = e.SERVERS.get(e.SERVERS.idFromName(ID));
  return stub.fetch(`https://internal/__cloud/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INTERNAL_HEADER]: key ?? (await internalKey(e.CLOUD_SECRET)) },
    body: JSON.stringify(body),
  });
}

describe("Tickler Cloud in workerd", () => {
  it("runs a customer server on a Durable Object end to end", async () => {
    expect((await call(`${BASE}/api/health`)).status).toBe(404); // not provisioned yet
    expect((await internal("init", { server_id: ID, url: BASE, status: "active" }, "wrong")).status).toBe(403);
    expect((await internal("init", { server_id: ID, url: BASE, status: "active" })).status).toBe(200);

    const health = await (await call(`${BASE}/api/health`)).json<any>();
    expect(health).toMatchObject({ ok: true, hosting: "cloud", server_name: "Tickler Cloud", public_url: BASE });
    // Internal routes are never reachable from outside.
    expect((await call(`${BASE}/__cloud/purge`, { method: "POST" })).status).toBe(404);
    expect(await (await call(`${BASE}/setup`)).text()).toContain("managed from the Tickler app");

    const dev = await (await internal("devices", { device_name: "iPhone", platform: "ios" })).json<any>();
    expect(dev.token).toMatch(/^tkd_/);
    const auth = { authorization: `Bearer ${dev.token}`, "content-type": "application/json" };
    const created = await call(`${BASE}/api/projects`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Launch" }) });
    expect(created.status).toBe(201);
    // Single-use checks rely on exact change counts.
    const changes = await (await call(`${BASE}/api/changes`, { headers: auth })).json<any>();
    expect(changes.projects.map((p: any) => p.name)).toEqual(["Launch"]);

    // OAuth metadata through the root .well-known path (RFC 9728 path insertion).
    const prm = await (await call(`https://cloud.test/.well-known/oauth-protected-resource/s/${ID}/mcp`)).json<any>();
    expect(prm.resource).toBe(`${BASE}/mcp`);

    // The alarm runs the scheduler and re-arms itself.
    const stub = e.SERVERS.get(e.SERVERS.idFromName(ID));
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    await internal("status", { status: "expired" });
    const blocked = await call(`${BASE}/api/projects`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Nope" }) });
    expect(blocked.status).toBe(402);
    expect((await blocked.json<any>()).error.code).toBe("subscription_required");
    expect((await call(`${BASE}/api/export`, { headers: auth })).status).toBe(200);

    await internal("purge", {});
    expect((await call(`${BASE}/api/health`)).status).toBe(404);
  });

  it("serves the control plane on other paths", async () => {
    expect(await (await call("https://cloud.test/v1/health")).json()).toMatchObject({ ok: true, name: "tickler-cloud" });
    expect((await call("https://cloud.test/v1/accounts/me")).status).toBe(401);
  });
});
