import { describe, expect, it } from "vitest";
import { cloudflare, dailyCosts } from "../../src/providers/cloudflare";
import { BASE_FEE, PRICES_AS_OF } from "../../src/providers/prices/cloudflare";
import { ctx, fixture, json, mockFetch } from "./helpers";

const cfg = { api_token: "cf-token", account_id: "acc123" };

function cf() {
  return mockFetch([
    [
      "/graphql",
      (_u, init) => {
        const q = JSON.parse(String(init.body)).query as string;
        if (q.includes("workersInvocationsAdaptive")) return json(fixture("cloudflare/workers.json"));
        if (q.includes("d1AnalyticsAdaptiveGroups")) return json(fixture("cloudflare/d1.json"));
        if (q.includes("r2OperationsAdaptiveGroups")) return json(fixture("cloudflare/r2.json"));
        return json(fixture("cloudflare/kv.json"));
      },
    ],
  ]);
}

describe("cloudflare", () => {
  it("has a dated price table", () => {
    expect(PRICES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cloudflare.freshness).toContain(PRICES_AS_OF);
  });

  it("prices usage beyond the monthly included amounts", async () => {
    const m = cf();
    const { snapshots } = await cloudflare.sync(cfg, ctx(m.fetch));
    const cost = (date: string, label: string | null = null) => snapshots.find((s) => s.metric === "cost" && s.period_start === date && (s.label ?? null) === label)?.value;
    // Nov 1: 6M requests (under 10M), 10M CPU ms (under 30M): only the base fee.
    expect(cost("2026-11-01")).toBe(BASE_FEE);
    // Nov 2: requests reach 12M (2M over x 0.30/M = 0.60); D1 writes 60M (10M over x 1.00/M = 10);
    // KV under the included amounts.
    expect(cost("2026-11-02", "Workers")).toBeCloseTo(0.6);
    expect(cost("2026-11-02", "D1")).toBeCloseTo(10);
    expect(cost("2026-11-02")).toBeCloseTo(10.6);
    // Oct 31 is last month: usage only, no cost (the month's earlier days are not in the window).
    expect(cost("2026-10-31")).toBeUndefined();
    expect(snapshots.find((s) => s.metric === "usage" && s.label === "Workers requests" && s.period_start === "2026-10-31")?.value).toBe(1_000_000);
    // R2 failed (permission): skipped and reported, not fatal.
    expect(JSON.stringify(snapshots.find((s) => s.metric === "cost" && s.label == null && s.period_start === "2026-11-01")?.raw)).toContain("r2");
    expect(snapshots.find((s) => s.metric === "forecast")?.value).toBeGreaterThan(10.6);
  });

  it("free plan has no cost", () => {
    const usage = new Map([["workers_requests", new Map([["2026-11-01", 50_000_000]])]]);
    expect(dailyCosts(usage, "2026-11", false).size).toBe(0);
    expect(dailyCosts(usage, "2026-11", true).get("2026-11-01")!.get("Workers")).toBeCloseTo(12);
  });

  it("fails when no dataset can be read", async () => {
    const m = mockFetch([["/graphql", () => json({ data: null, errors: [{ message: "Authentication error" }] })]]);
    await expect(cloudflare.sync(cfg, ctx(m.fetch))).rejects.toThrow("no analytics");
  });
});
