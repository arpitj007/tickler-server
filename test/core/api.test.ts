import { describe, expect, it } from "vitest";
import { claim, makeApp, setupAll } from "./helpers";
import { providers } from "../../src/providers";

async function pairingCode(t: ReturnType<typeof makeApp>, cookie: string) {
  const page = await (await t.req("/setup/pair", { cookie })).text();
  return /class="code">([A-Z0-9]{8})/.exec(page)![1]!;
}

describe("pairing", () => {
  it("QR payload, single use, expiry after 10 minutes, wrong code", async () => {
    const t = makeApp();
    const cookie = await claim(t);
    const page = await (await t.req("/setup/pair", { cookie })).text();
    expect(page).toContain("<svg");
    expect(page).toContain("http://tickler.test");
    const code = /class="code">([A-Z0-9]{8})/.exec(page)![1]!;
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    const ok = await t.req("/api/pair", { method: "POST", json: { code: code.toLowerCase(), device_name: "P", platform: "ios" } });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.token).toMatch(/^tkd_[A-Za-z0-9_-]{43}$/);
    expect(body.server).toEqual({ name: "Test", version: "0.1.0", api: 1 });
    const again = await t.req("/api/pair", { method: "POST", json: { code } });
    expect((await again.json()).error.code).toBe("pairing_expired");

    const code2 = await pairingCode(t, cookie);
    t.advance(10 * 60_000 + 1);
    const late = await t.req("/api/pair", { method: "POST", json: { code: code2 } });
    expect(late.status).toBe(400);
    expect((await late.json()).error.code).toBe("pairing_expired");
    expect((await t.req("/api/pair", { method: "POST", json: { code: "ZZZZZZZZ" } })).status).toBe(404);
  });

  it("rate limits pairing per IP", async () => {
    const t = makeApp();
    for (let i = 0; i < 10; i++) await t.req("/api/pair", { method: "POST", json: { code: "ZZZZZZZZ" } });
    const r = await t.req("/api/pair", { method: "POST", json: { code: "ZZZZZZZZ" } });
    expect(r.status).toBe(429);
    expect((await r.json()).error.code).toBe("rate_limited");
    const other = await t.req("/api/pair", { method: "POST", json: { code: "ZZZZZZZZ" }, headers: { "x-test-ip": "10.9.9.9" } });
    expect(other.status).toBe(404);
  });

  it("demo pairing code is reusable when configured", async () => {
    const t = makeApp({ env: { TICKLER_DEMO_PAIRING_CODE: "DEMO2345" } });
    for (let i = 0; i < 2; i++) {
      const r = await t.req("/api/pair", { method: "POST", json: { code: "demo2345", device_name: "Reviewer" } });
      expect(r.status).toBe(200);
    }
  });
});

describe("auth, devices, tokens", () => {
  it("rejects missing and MCP tokens on device endpoints; revoke works", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    expect((await t.req("/api/projects")).status).toBe(401);
    expect((await t.req("/api/projects", { token: s.mcp })).status).toBe(401);
    const me = await (await t.req("/api/me", { token: s.device })).json();
    expect(me.device.current).toBe(true);
    expect(me.server_name).toBe("Test");
    const toks = await (await t.req("/api/tokens", { token: s.device })).json();
    expect(toks.tokens[0]).not.toHaveProperty("token_hash");
    expect((await t.req(`/api/tokens/${toks.tokens[0].id}`, { method: "DELETE", token: s.device })).status).toBe(204);
    expect((await t.req("/mcp", { method: "POST", token: s.mcp, json: {} })).status).toBe(401);
    expect((await t.req("/api/devices/me", { method: "DELETE", token: s.device })).status).toBe(204);
    expect((await t.req("/api/me", { token: s.device })).status).toBe(401);
  });

  it("stores only token hashes", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const dump = JSON.stringify([await t.storage.all("SELECT * FROM devices"), await t.storage.all("SELECT * FROM mcp_tokens")]);
    expect(dump).not.toContain(s.device);
    expect(dump).not.toContain(s.mcp);
  });

  it("refuses cross-origin writes (CORS locked) and sends no CORS headers", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const r = await t.req("/api/projects", { method: "POST", token: s.device, json: { name: "X" }, headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
    const pre = await t.req("/api/projects", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("projects and entries", () => {
  it("project CRUD and archive", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const p = await (await t.req("/api/projects", { method: "POST", token: s.device, json: { name: "Home Server" } })).json();
    expect(p.slug).toBe("home-server");
    expect(p.color).toMatch(/^#/);
    const p2 = await (await t.req("/api/projects", { method: "POST", token: s.device, json: { name: "Home server" } })).json();
    expect(p2.slug).toBe("home-server-2");
    const patched = await (await t.req(`/api/projects/${p.id}`, { method: "PATCH", token: s.device, json: { icon: "server.rack" } })).json();
    expect(patched.icon).toBe("server.rack");
    const del = await (await t.req(`/api/projects/${p.id}`, { method: "DELETE", token: s.device })).json();
    expect(del.archived).toBe(true);
    expect((await (await t.req("/api/projects", { token: s.device })).json()).projects).toHaveLength(1);
    expect((await (await t.req("/api/projects?archived=true", { token: s.device })).json()).projects).toHaveLength(2);
  });

  it("entry create with client id, get, patch, snooze, delete", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const p = await (await t.req("/api/projects", { method: "POST", token: s.device, json: { name: "P" } })).json();
    const id = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    const e = await t.req("/api/entries", {
      method: "POST",
      token: s.device,
      json: { id, project_id: p.id, title: "Dentist", kind: "event", start_at: "2026-11-12T09:00:00Z", end_at: "2026-11-12T09:45:00Z", links: [{ title: "Map", url: "https://maps.example/x" }] },
    });
    expect(e.status).toBe(201);
    const entry = await e.json();
    expect(entry.id).toBe(id);
    expect(entry.source).toBe("manual");
    expect(entry.links).toHaveLength(1);
    const dup = await t.req("/api/entries", { method: "POST", token: s.device, json: { id, project_id: p.id, title: "Dentist" } });
    expect(dup.status).toBe(200);
    const got = await (await t.req(`/api/entries/${id}`, { token: s.device })).json();
    expect(got.entry.title).toBe("Dentist");
    expect(got.origin).toBeNull();
    const sn = await (await t.req(`/api/entries/${id}/snooze`, { method: "POST", token: s.device, json: { start_at: "2026-11-13T10:00:00Z" } })).json();
    expect(sn.start_at).toBe("2026-11-13T10:00:00.000Z");
    expect(sn.end_at).toBe("2026-11-13T10:45:00.000Z");
    const bad = await t.req(`/api/entries/${id}`, { method: "PATCH", token: s.device, json: { title: "x".repeat(121) } });
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.fields.title).toBeTruthy();
    const d = await (await t.req(`/api/entries/${id}`, { method: "DELETE", token: s.device })).json();
    expect(d.deleted_at).toBeTruthy();
    expect((await (await t.req("/api/entries", { token: s.device })).json()).entries).toHaveLength(0);
  });

  it("conflict rule: done is not set back to planned by an older write", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const p = await (await t.req("/api/projects", { method: "POST", token: s.device, json: { name: "P" } })).json();
    const e = await (await t.req("/api/entries", { method: "POST", token: s.device, json: { project_id: p.id, title: "T", start_at: "2026-11-12T09:00:00Z" } })).json();
    const loadedAt = e.updated_at;
    t.advance(60_000);
    const done = await (await t.req(`/api/entries/${e.id}/complete`, { method: "POST", token: s.device, json: { status: "done" } })).json();
    expect(done.status).toBe("done");
    t.advance(60_000);
    const stale = await t.req(`/api/entries/${e.id}`, { method: "PATCH", token: s.device, json: { status: "planned", base_updated_at: loadedAt } });
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.current.status).toBe("done");
    // other fields from an old copy still win (last write wins)
    const title = await t.req(`/api/entries/${e.id}`, { method: "PATCH", token: s.device, json: { title: "Renamed", base_updated_at: loadedAt } });
    expect(title.status).toBe(200);
    // a write based on the completed copy may reopen it
    const fresh = await t.req(`/api/entries/${e.id}/complete`, { method: "POST", token: s.device, json: { status: "planned", base_updated_at: done.updated_at } });
    expect((await fresh.json()).status).toBe("planned");
  });

  it("Idempotency-Key replays the stored response", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const key = "a3d1c1f0-0000-4000-8000-000000000001";
    const r1 = await t.req("/api/projects", { method: "POST", token: s.device, json: { name: "Once" }, headers: { "idempotency-key": key } });
    const r2 = await t.req("/api/projects", { method: "POST", token: s.device, json: { name: "Once" }, headers: { "idempotency-key": key } });
    expect(r2.headers.get("idempotency-replayed")).toBe("true");
    expect(await r2.json()).toEqual(await r1.json());
    expect(r2.status).toBe(201);
    expect((await (await t.req("/api/projects", { token: s.device })).json()).projects).toHaveLength(1);
    const other = await t.req("/api/tokens", { method: "POST", token: s.device, json: { name: "x" }, headers: { "idempotency-key": key } });
    expect(other.status).toBe(409);
    t.advance(25 * 3600_000);
    const r3 = await t.req("/api/projects", { method: "POST", token: s.device, json: { name: "Once" }, headers: { "idempotency-key": key } });
    expect(r3.headers.get("idempotency-replayed")).toBeNull();
  });
});

describe("/api/changes", () => {
  it("cursor, pagination across tables, tombstones", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const p = await (await t.req("/api/projects", { method: "POST", token: s.device, json: { name: "P" } })).json();
    for (let i = 0; i < 5; i++) {
      await t.req("/api/entries", { method: "POST", token: s.device, json: { project_id: p.id, title: `E${i}` } });
    }
    const b = await (await t.req("/api/budgets", { method: "POST", token: s.device, json: { provider: "aws", monthly_limit: 100 } })).json();
    const full = await (await t.req("/api/changes?since=0", { token: s.device })).json();
    expect(full.projects).toHaveLength(1);
    expect(full.entries).toHaveLength(5);
    expect(full.budgets).toHaveLength(1);
    expect(full.has_more).toBe(false);

    const seen: string[] = [];
    let cursor = "0";
    for (let guard = 0; guard < 10; guard++) {
      const page = await (await t.req(`/api/changes?since=${cursor}&limit=2`, { token: s.device })).json();
      for (const k of ["projects", "entries", "budgets"]) for (const r of page[k]) seen.push(r.id);
      expect(Number(page.cursor)).toBeGreaterThanOrEqual(Number(cursor));
      cursor = page.cursor;
      if (!page.has_more) break;
    }
    expect(new Set(seen).size).toBe(7);

    const none = await (await t.req(`/api/changes?since=${full.cursor}`, { token: s.device })).json();
    expect(none.cursor).toBe(full.cursor);
    expect(none.entries).toHaveLength(0);

    await t.req(`/api/budgets/${b.id}`, { method: "DELETE", token: s.device });
    const after = await (await t.req(`/api/changes?since=${full.cursor}`, { token: s.device })).json();
    expect(after.deleted).toEqual([{ type: "budget", id: b.id }]);
    const e0 = full.entries[0];
    await t.req(`/api/entries/${e0.id}`, { method: "PATCH", token: s.device, json: { title: "changed" } });
    const after2 = await (await t.req(`/api/changes?since=${after.cursor}`, { token: s.device })).json();
    expect(after2.entries.map((e: { id: string }) => e.id)).toEqual([e0.id]);
  });
});

describe("misc endpoints", () => {
  it("connect, activity, export without secrets, metrics push", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const c = await (await t.req("/api/connect", { token: s.device })).json();
    expect(c.mcp_url).toBe("http://tickler.test/mcp");
    expect(c.clients.map((x: { id: string }) => x.id)).toContain("claude_code");
    expect(c.instruction_block).toContain("tickler.create_entry");
    const m = await t.req("/api/metrics", { method: "POST", token: s.mcp, json: { metric: "revenue", unit: "USD", value: 9.99, period_start: "2026-11-03", label: "consulting" } });
    expect(m.status).toBe(201);
    expect((await m.json()).label).toBe("consulting");
    const act = await (await t.req("/api/activity?limit=50", { token: s.device })).json();
    expect(act.activity.length).toBeGreaterThan(2);
    const exp = await (await t.req("/api/export", { token: s.device })).text();
    expect(exp).not.toContain("token_hash");
    expect(exp).not.toContain(s.mcp);
    expect(exp).not.toContain("passphrase");
  });

  it("budgets and fixed costs CRUD", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const b = await (await t.req("/api/budgets", { method: "POST", token: s.device, json: { provider: "anthropic", monthly_limit: 300 } })).json();
    expect(b.thresholds).toEqual([0.5, 0.8, 1]);
    expect(b.currency).toBe("USD");
    const b2 = await (await t.req(`/api/budgets/${b.id}`, { method: "PATCH", token: s.device, json: { monthly_limit: 400 } })).json();
    expect(b2.monthly_limit).toBe(400);
    expect(b2.provider).toBe("anthropic");
    const f = await (await t.req("/api/fixed-costs", { method: "POST", token: s.device, json: { name: "Apple Developer", amount: 99, interval: "yearly", renews_on: "2026-11-15" } })).json();
    expect(f.name).toBe("Apple Developer");
    const list = await (await t.req("/api/fixed-costs", { token: s.device })).json();
    expect(list.fixed_costs).toHaveLength(1);
    expect((await t.req(`/api/fixed-costs/${f.id}`, { method: "DELETE", token: s.device })).status).toBe(204);
    expect((await t.req("/api/nope", { token: s.device })).status).toBe(404);
  });
});

describe("offline-friendly projects and provider fields", () => {
  it("accepts a client id for projects and replays a repeated create", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const id = "5b1c3c1e-8f0e-4b8a-9d55-2f6f2b7f9a01";
    const a = await t.req("/api/projects", { method: "POST", token: s.device, json: { id, name: "Offline" } });
    expect(a.status).toBe(201);
    expect((await a.json()).id).toBe(id);
    const b = await t.req("/api/projects", { method: "POST", token: s.device, json: { id, name: "Offline" } });
    expect((await b.json()).id).toBe(id);
    const list = await (await t.req("/api/projects", { token: s.device })).json();
    expect(list.projects.filter((p: { name: string }) => p.name === "Offline")).toHaveLength(1);
  });

  it("includes credential fields in provider status", async () => {
    const t = makeApp({ providers });
    const s = await setupAll(t);
    const body = await (await t.req("/api/money/providers", { token: s.device })).json();
    const stripe = body.providers.find((p: { provider: string }) => p.provider === "stripe");
    expect(stripe.fields.length).toBeGreaterThan(0);
    expect(stripe.fields[0]).toHaveProperty("key");
  });
});
