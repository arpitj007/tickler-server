import { describe, expect, it } from "vitest";
import { buildMoneySummary, monthToDateFromSummary, type StoredSnapshot } from "../../src/money/summary";
import type { ProviderStatusLike } from "../../src/money/summary";
import { dateRange } from "../../src/providers/util";

const NOW = new Date("2026-11-11T12:00:00Z");
const AT = "2026-11-11T11:45:00.000Z";
const s = (provider: any, metric: any, date: string, value: number, extra: Partial<StoredSnapshot> = {}): StoredSnapshot => ({
  provider, account: "default", metric, unit: "USD", value, label: null, period_start: date, period_end: date, fetched_at: AT, ...extra,
});
const status = (provider: any, kind: "revenue" | "cost", last = AT): ProviderStatusLike => ({ provider, kind, configured: true, enabled: true, freshness: "hourly", last_sync_at: last });

describe("buildMoneySummary", () => {
  const snapshots: StoredSnapshot[] = [
    ...dateRange("2026-11-01", "2026-11-10").map((d) => s("anthropic", "cost", d, 2)),
    s("anthropic", "cost", "2026-11-05", 5, { label: "claude-opus-5-5" }),
    s("anthropic", "cost", "2026-11-06", 3, { label: "claude-sonnet-5" }),
    s("anthropic", "usage", "2026-11-05", 99999, { unit: "tokens" }),
    s("anthropic", "cost", "2026-10-31", 2), // last month: only for the run rate
    ...dateRange("2026-11-01", "2026-11-10").map((d) => s("aws", "cost", d, 1, { fetched_at: "2026-11-11T06:00:00.000Z" })),
    s("aws", "forecast", "2026-11-01", 40, { period_end: "2026-11-30", fetched_at: "2026-11-11T06:00:00.000Z" }),
    ...dateRange("2026-11-01", "2026-11-09").map((d) => s("app_store", "proceeds", d, 10)),
    s("app_store", "proceeds", "2026-11-05", 7, { unit: "EUR", label: "currency:EUR" }),
    s("app_store", "proceeds", "2026-10-01", 300, { period_end: "2026-10-31", label: "finance:USD" }),
    s("app_store", "units", "2026-11-05", 4, { unit: "units" }),
    s("stripe", "revenue", "2026-11-03", 50),
    s("stripe", "proceeds", "2026-11-03", 47),
    s("stripe", "revenue", "2026-11-11", 30, { label: "mrr" }),
  ];
  const summary = buildMoneySummary({
    snapshots,
    salesEvents: [
      { store: "app_store", type: "subscribed", occurred_at: "2026-11-10T10:00:00Z" },
      { store: "app_store", type: "renewed", occurred_at: "2026-11-10T11:00:00Z" },
      { store: "app_store", type: "trial_started", occurred_at: "2026-11-11T11:59:00Z" },
      { store: "app_store", type: "refunded", occurred_at: "2026-10-30T11:00:00Z" },
    ],
    budgets: [{ id: "b1", provider: "anthropic", monthly_limit: 100, currency: "USD", thresholds: [0.5, 0.8, 1] }],
    fixedCosts: [
      { id: "f1", name: "Apple Developer Program", amount: 99, currency: "USD", interval: "yearly", renews_on: "2026-11-20" },
      { id: "f2", name: "VPS", amount: 6, currency: "USD", interval: "monthly", renews_on: "2026-01-02" },
      { id: "f3", name: "Domain", amount: 10, currency: "EUR", interval: "monthly", renews_on: "2026-11-05" },
    ],
    providerStatuses: [status("anthropic", "cost"), status("aws", "cost", "2026-11-11T06:00:00.000Z"), status("app_store", "revenue"), status("stripe", "revenue"), status("manual", "cost")],
    month: "2026-11",
    now: NOW,
    currency: "USD",
  });
  const row = (p: string) => summary.providers.find((x) => x.provider === p)!;

  it("sums daily totals only, in the base currency", () => {
    expect(row("anthropic").month_to_date).toBe(20);
    expect(row("aws").month_to_date).toBe(10);
    expect(row("app_store").month_to_date).toBe(90);
    expect(row("stripe").month_to_date).toBe(47); // proceeds, not gross revenue or MRR
    expect(row("manual").month_to_date).toBe(6); // VPS charged on the 2nd; Apple fee not yet
    expect(summary.revenue.value).toBe(137);
    expect(summary.costs.value).toBe(36);
    expect(summary.net.value).toBe(101);
  });

  it("forecasts per provider and labels the method", () => {
    expect(row("aws")).toMatchObject({ forecast: 40, forecast_method: "provider" });
    expect(row("anthropic")).toMatchObject({ forecast: 20 + 2 * 20, forecast_method: "run_rate_7d" });
    expect(row("manual").forecast).toBe(6 + 99);
    expect(summary.forecast.method).toBe("mixed");
    expect(summary.forecast.costs).toBe(40 + 60 + 105);
  });

  it("budget use, top lines, as_of and freshness", () => {
    expect(row("anthropic").budget_used).toBe(0.2);
    expect(row("anthropic").top_lines).toEqual([{ label: "claude-opus-5-5", value: 5 }, { label: "claude-sonnet-5", value: 3 }]);
    expect(row("manual").top_lines).toEqual([{ label: "VPS", value: 6 }]);
    expect(summary.costs.as_of).toBe("2026-11-11T06:00:00.000Z"); // the stalest source
    expect(row("anthropic").freshness).toBe("hourly");
  });

  it("store cards count webhook events in the month", () => {
    expect(summary.stores.find((x) => x.store === "app_store")).toMatchObject({ proceeds: 90, units: 4, new_subscriptions: 1, renewals: 1, trials: 1, refunds: 0, as_of: "2026-11-11T11:59:00Z" });
  });

  it("notes what was left out", () => {
    expect(summary.notes).toEqual(expect.arrayContaining([expect.stringContaining("Domain"), "app_store: EUR 7.00 is not in totals (no conversion to USD)."]));
  });

  it("feeds budgets", () => {
    expect(monthToDateFromSummary(summary)).toEqual({ total: 36, byProvider: { anthropic: 20, aws: 10, manual: 6 }, currency: "USD" });
  });

  it("is empty but well formed with nothing connected", () => {
    const e = buildMoneySummary({ snapshots: [], salesEvents: [], budgets: [], fixedCosts: [], providerStatuses: [], month: "2026-11", now: NOW, currency: "USD" });
    expect(e).toEqual({
      month: "2026-11", currency: "USD",
      revenue: { value: 0, as_of: null }, costs: { value: 0, as_of: null }, net: { value: 0, as_of: null },
      forecast: { revenue: 0, costs: 0, net: 0, method: "run_rate_7d" }, providers: [], stores: [], notes: [],
    });
  });
});
