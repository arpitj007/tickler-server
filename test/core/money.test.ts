import { describe, expect, it } from "vitest";
import type { Provider, WebhookHandler } from "../../src/providers/types";
import { makeApp, setupAll } from "./helpers";

function fakeProvider(over: Partial<Provider> = {}): Provider & { calls: number } {
  const p = {
    id: "anthropic",
    displayName: "Anthropic",
    kind: "cost",
    fields: [{ key: "admin_key", label: "Admin key", secret: true }],
    freshness: "hourly",
    syncEveryMinutes: 15,
    guide: "providers/anthropic",
    calls: 0,
    configured: (cfg: Record<string, string>) => !!cfg.admin_key,
    test: async () => ({ ok: true, message: "Connected" }),
    async sync(_cfg: Record<string, string>, ctx: { now: Date }) {
      p.calls++;
      const day = ctx.now.toISOString().slice(0, 10);
      return {
        snapshots: [
          { provider: "anthropic", account: "default", metric: "cost", unit: "USD", value: 160, label: null, period_start: day, period_end: day },
          { provider: "anthropic", account: "default", metric: "cost", unit: "USD", value: 160, label: "claude-sonnet", period_start: day, period_end: day },
        ],
      };
    },
    ...over,
  } as Provider & { calls: number };
  return p;
}

const fakeHook: WebhookHandler = {
  store: "stripe",
  async handle(req) {
    if (req.headers["x-sig"] !== req.cfg.webhook_secret) throw new Error("bad signature");
    const b = JSON.parse(req.body) as { id: string };
    return {
      events: [{ store: "stripe", external_id: b.id, type: "purchase", product_id: "p", price: 5, currency: "USD", country: "DE", occurred_at: req.now.toISOString() }],
      notice: b.id === "notice" ? "Confirm the subscription" : undefined,
    };
  },
};
const stripeProvider = fakeProvider({ id: "stripe", displayName: "Stripe", kind: "revenue", fields: [{ key: "webhook_secret", label: "Secret", secret: true }], configured: () => true, needsPublicUrl: true });

describe("provider credentials", () => {
  it("are stored encrypted and never returned", async () => {
    const p = fakeProvider();
    const t = makeApp({ providers: [p] });
    const s = await setupAll(t);
    const put = await t.req("/api/money/providers/anthropic", { method: "PUT", token: s.device, json: { credentials: { admin_key: "sk-ant-admin-SECRET" }, enabled: true } });
    expect(put.status).toBe(200);
    const st = await put.json();
    expect(st.configured).toBe(true);
    expect(JSON.stringify(st)).not.toContain("SECRET");
    const raw = JSON.stringify(await t.storage.all("SELECT * FROM provider_configs"));
    expect(raw).not.toContain("sk-ant-admin-SECRET");
    expect((await (await t.req("/api/money/providers/anthropic/test", { method: "POST", token: s.device })).json()).ok).toBe(true);
    expect((await t.req("/api/money/providers/nope", { method: "PUT", token: s.device, json: {} })).status).toBe(404);
  });

  it("setup form renders fields and saves, keeping secrets on empty submit", async () => {
    const p = fakeProvider();
    const t = makeApp({ providers: [p] });
    const s = await setupAll(t);
    const page = await (await t.req("/setup/money/anthropic", { cookie: s.cookie })).text();
    expect(page).toContain('name="admin_key"');
    expect((await t.form("/setup/money/anthropic", { admin_key: "k1", enabled: "1" }, s.cookie)).status).toBe(302);
    await t.form("/setup/money/anthropic", { admin_key: "", enabled: "1" }, s.cookie);
    const { readProviderConfig } = await import("../../src/core/moneyStore");
    expect(await readProviderConfig(t.ctx, "anthropic")).toEqual({ admin_key: "k1" });
    const page2 = await (await t.req("/setup/money/anthropic", { cookie: s.cookie })).text();
    expect(page2).not.toContain("k1");
  });
});

describe("scheduler", () => {
  it("syncs on the provider's interval, upserts snapshots idempotently", async () => {
    const p = fakeProvider();
    const t = makeApp({ providers: [p] });
    const s = await setupAll(t);
    await t.req("/api/money/providers/anthropic", { method: "PUT", token: s.device, json: { credentials: { admin_key: "k" } } });
    await t.scheduled("tick");
    expect(p.calls).toBe(1);
    t.advance(5 * 60_000);
    await t.scheduled("tick");
    expect(p.calls).toBe(1);
    t.advance(10 * 60_000);
    await t.scheduled("tick");
    expect(p.calls).toBe(2);
    expect((await t.storage.first<{ n: number }>("SELECT COUNT(*) AS n FROM metric_snapshots"))!.n).toBe(2);
    const summary = await (await t.req("/api/money/summary?month=2026-11", { token: s.device })).json();
    const a = summary.providers.find((x: { provider: string }) => x.provider === "anthropic");
    expect(a.month_to_date).toBe(160);
    expect(a.top_lines[0].label).toBe("claude-sonnet");
    const series = await (await t.req("/api/money/series?provider=anthropic&metric=cost&from=2026-11-01&to=2026-11-30", { token: s.device })).json();
    expect(series.points).toEqual([{ date: "2026-11-06", unit: "USD", value: 160 }]);
  });

  it("records sync errors and retries on the interval", async () => {
    const p = fakeProvider({ sync: async () => { throw new Error("401 invalid key"); } });
    const t = makeApp({ providers: [p] });
    const s = await setupAll(t);
    await t.req("/api/money/providers/anthropic", { method: "PUT", token: s.device, json: { credentials: { admin_key: "k" } } });
    await t.scheduled("tick");
    const st = (await (await t.req("/api/money/providers", { token: s.device })).json()).providers[0];
    expect(st.last_error).toContain("invalid key");
  });
});

describe("daily job", () => {
  it("budget alerts: once per threshold per month, critical at 100%, entry in Money", async () => {
    const p = fakeProvider();
    const t = makeApp({ providers: [p], start: "2026-11-06T05:50:00Z" });
    const s = await setupAll(t);
    await t.req("/api/money/providers/anthropic", { method: "PUT", token: s.device, json: { credentials: { admin_key: "k" } } });
    await t.req("/api/budgets", { method: "POST", token: s.device, json: { provider: "anthropic", monthly_limit: 300 } });
    await t.scheduled("tick"); // 160 of 300 = 53%
    t.advance(10 * 60_000);
    const r1 = await t.scheduled("daily");
    expect(r1).toMatchObject({ alerts: 1 });
    const r2 = await t.scheduled("daily");
    expect(r2).toMatchObject({ alerts: 0 });
    let alerts = await t.storage.all<{ threshold: number; entry_id: string }>("SELECT * FROM alerts ORDER BY threshold");
    expect(alerts.map((a) => a.threshold)).toEqual([0.5]);
    const e = await t.storage.first<{ importance: string; source: string; project_id: string }>("SELECT * FROM entries WHERE id = ?", [alerts[0]!.entry_id]);
    expect(e!.source).toBe("system");
    expect(e!.importance).toBe("important");
    const proj = await t.storage.first<{ name: string }>("SELECT name FROM projects WHERE id = ?", [e!.project_id]);
    expect(proj!.name).toBe("Money");

    // next day: spend jumps past 100% -> 0.8 and 1.0 crossed, one critical entry
    t.advance(24 * 3600_000);
    await t.scheduled("tick");
    await t.scheduled("daily");
    alerts = await t.storage.all("SELECT * FROM alerts ORDER BY threshold");
    expect(alerts.map((a) => a.threshold)).toEqual([0.5, 0.8, 1]);
    const crit = await t.storage.all<{ importance: string }>("SELECT importance FROM entries WHERE source = 'system' AND importance = 'critical'");
    expect(crit).toHaveLength(1);
    await t.scheduled("daily");
    expect(await t.storage.all("SELECT * FROM alerts")).toHaveLength(3);
  });

  it("renewal reminders 14 days ahead, created once", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    await t.req("/api/fixed-costs", { method: "POST", token: s.device, json: { name: "Apple Developer", amount: 99, interval: "yearly", renews_on: "2026-11-25" } });
    expect((await t.scheduled("daily")) as { reminders: number }).toMatchObject({ reminders: 0 });
    t.advance(6 * 86400_000); // 2026-11-12: 13 days before
    expect(await t.scheduled("daily")).toMatchObject({ reminders: 1 });
    expect(await t.scheduled("daily")).toMatchObject({ reminders: 0 });
    const e = await t.storage.all<{ kind: string; external_key: string }>("SELECT * FROM entries WHERE kind = 'renewal'");
    expect(e).toHaveLength(1);
  });

  it("prunes raw provider data after 90 days", async () => {
    const t = makeApp();
    await t.scheduled("daily");
    await t.storage.run(
      "INSERT INTO metric_snapshots (id, provider, account, metric, unit, value, label, period_start, period_end, fetched_at, raw, rev) VALUES ('x','aws','a','cost','USD',1,'','2026-07-01','2026-07-01','2026-07-01T00:00:00Z','{\"a\":1}',1)",
    );
    await t.scheduled("daily");
    expect((await t.storage.first<{ raw: string | null }>("SELECT raw FROM metric_snapshots"))!.raw).toBeNull();
  });
});

describe("webhooks", () => {
  it("routes /hooks/:store and aliases, verifies, dedupes retries, stores notices", async () => {
    const t = makeApp({ providers: [stripeProvider], webhookHandlers: [fakeHook] });
    const s = await setupAll(t);
    await t.req("/api/money/providers/stripe", { method: "PUT", token: s.device, json: { credentials: { webhook_secret: "whsec" } } });
    const bad = await t.req("/hooks/stripe", { method: "POST", body: JSON.stringify({ id: "evt_1" }), headers: { "x-sig": "nope" } });
    expect(bad.status).toBe(401);
    for (let i = 0; i < 2; i++) {
      const ok = await t.req("/hooks/stripe", { method: "POST", body: JSON.stringify({ id: "evt_1" }), headers: { "x-sig": "whsec", origin: "https://stripe.com" } });
      expect(ok.status).toBe(200);
    }
    expect(await t.storage.all("SELECT * FROM sales_events")).toHaveLength(1);
    const ev = await (await t.req("/api/sales-events?store=stripe", { token: s.device })).json();
    expect(ev.events[0]).not.toHaveProperty("raw");
    await t.req("/hooks/stripe", { method: "POST", body: JSON.stringify({ id: "notice" }), headers: { "x-sig": "whsec" } });
    const st = (await (await t.req("/api/money/providers", { token: s.device })).json()).providers[0];
    expect(st.last_message).toBe("Confirm the subscription");
    expect(st.needs_public_url).toBe(true);
    expect(st.public_url_ok).toBe(false); // http://tickler.test
    expect((await t.req("/hooks/apple", { method: "POST", body: "{}" })).status).toBe(404); // no app_store handler here
    expect((await t.req("/hooks/unknown", { method: "POST", body: "{}" })).status).toBe(404);
  });
});
