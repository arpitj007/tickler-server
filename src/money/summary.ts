// Builds the GET /api/money/summary response (docs/reference/api-contract.md).
//
// Snapshot conventions (all providers follow them):
// - A money total for a day has label null (or "currency:XXX" when the source reports
//   several currencies, one snapshot per currency). Totals are what gets summed.
// - Any other label is a breakdown line (model, service, product) and is only used for
//   top_lines, never added to totals.
// - Daily snapshots have period_start == period_end. A provider forecast is metric
//   "forecast", label null, period = the whole month.
// - Revenue providers: daily "proceeds" (what you are paid) is used when the provider reports
//   it, otherwise daily "revenue". Monthly snapshots (finance and earnings reports) are kept for
//   the detail screens but not used here.
//
// Fixed costs are counted on a cash basis: a charge counts in the month it renews (monthly
// ones every month, yearly ones in their renewal month), in month to date once the renewal
// day has come, and in the forecast for the whole month. They show in the "manual" row.
//
// Currencies: only amounts in `currency` are summed. Others are listed in `notes` and left
// out of totals (no exchange rates in v1).

import type { MetricSnapshotInput, ProviderId, SalesEventType } from "../providers/types";
import { addDays, monthEnd, monthStart, parseYmd, startOfUtcDay, ymd } from "../providers/util";
import type { Budget } from "./budgets";
import { forecastMonth, round2 } from "./forecast";
import { renewalsBetween, type FixedCost } from "./renewals";

export type StoredSnapshot = MetricSnapshotInput & { fetched_at: string };

export interface StoredSalesEvent {
  store: "app_store" | "google_play" | "amazon_appstore" | "stripe";
  type: SalesEventType;
  occurred_at: string;
  price?: number | null;
  currency?: string | null;
}

export interface ProviderStatusLike {
  provider: ProviderId;
  kind: "revenue" | "cost";
  configured: boolean;
  enabled: boolean;
  freshness: string;
  last_sync_at: string | null;
}

export interface ProviderSummary {
  provider: ProviderId;
  kind: "revenue" | "cost";
  month_to_date: number;
  currency: string;
  forecast: number;
  forecast_method: "provider" | "run_rate_7d";
  budget: Budget | null;
  budget_used: number | null;
  as_of: string | null;
  freshness: string;
  top_lines: { label: string; value: number }[];
}

export interface StoreSummary {
  store: StoredSalesEvent["store"];
  proceeds: number;
  units: number;
  new_subscriptions: number;
  renewals: number;
  refunds: number;
  trials: number;
  currency: string;
  as_of: string | null;
}

export interface MoneySummary {
  month: string;
  currency: string;
  revenue: { value: number; as_of: string | null };
  costs: { value: number; as_of: string | null };
  net: { value: number; as_of: string | null };
  forecast: { revenue: number; costs: number; net: number; method: "provider" | "run_rate_7d" | "mixed" };
  providers: ProviderSummary[];
  stores: StoreSummary[];
  /** Additive to the contract: human readable caveats (excluded currencies). */
  notes: string[];
}

const STORES = ["app_store", "google_play", "amazon_appstore", "stripe"] as const;
const COST_KIND: Partial<Record<ProviderId, "revenue" | "cost">> = {
  app_store: "revenue",
  google_play: "revenue",
  amazon_appstore: "revenue",
  stripe: "revenue",
};

export function isTotal(s: { label?: string | null }): boolean {
  return s.label == null || s.label.startsWith("currency:");
}

function isDaily(s: StoredSnapshot): boolean {
  return s.period_start === s.period_end;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function minIso(values: (string | null)[]): string | null {
  const v = values.filter((x): x is string => !!x).sort();
  return v[0] ?? null;
}

export function buildMoneySummary(input: {
  snapshots: StoredSnapshot[];
  salesEvents: StoredSalesEvent[];
  budgets: Budget[];
  fixedCosts: FixedCost[];
  providerStatuses: ProviderStatusLike[];
  month: string;
  now: Date;
  currency: string;
}): MoneySummary {
  const { snapshots, salesEvents, budgets, fixedCosts, providerStatuses, month, now, currency } = input;
  const first = monthStart(month);
  const last = monthEnd(month);
  const today = ymd(startOfUtcDay(now));
  const lookback = ymd(addDays(parseYmd(first), -7)); // run rate needs days before the 1st
  const notes: string[] = [];
  const excluded = new Map<string, number>(); // "provider|CUR" -> amount

  const statusOf = new Map(providerStatuses.map((s) => [s.provider, s]));
  const ids = new Set<ProviderId>();
  for (const s of providerStatuses) if (s.configured && s.enabled) ids.add(s.provider);
  for (const s of snapshots) if (s.period_end >= first && s.period_start <= last) ids.add(s.provider);
  if (fixedCosts.length) ids.add("manual");

  const providers: ProviderSummary[] = [];
  const stores: StoreSummary[] = [];
  let revenue = 0;
  let costs = 0;
  let fRevenue = 0;
  let fCosts = 0;
  const revenueAsOf: (string | null)[] = [];
  const costAsOf: (string | null)[] = [];
  const methods = new Set<"provider" | "run_rate_7d">();

  for (const id of [...ids].sort()) {
    const status = statusOf.get(id);
    const kind = status?.kind ?? COST_KIND[id] ?? "cost";
    const mine = snapshots.filter((s) => s.provider === id);
    let asOf: string | null = status?.last_sync_at ?? null;
    for (const s of mine) asOf = maxIso(asOf, s.fetched_at);

    const inMonth = (s: StoredSnapshot) => s.period_start >= first && s.period_end <= last;
    const sumDaily = (metric: string) => {
      const daily: Record<string, number> = {};
      let mtd = 0;
      for (const s of mine) {
        if (s.metric !== metric || !isTotal(s) || !isDaily(s)) continue;
        if (s.period_start < lookback || s.period_start > last) continue;
        if (s.unit !== currency) {
          if (inMonth(s)) excluded.set(`${id}|${s.unit}`, (excluded.get(`${id}|${s.unit}`) ?? 0) + s.value);
          continue;
        }
        daily[s.period_start] = (daily[s.period_start] ?? 0) + s.value;
        if (inMonth(s)) mtd += s.value;
      }
      return { daily, mtd };
    };

    const hasDailyProceeds = mine.some((s) => s.metric === "proceeds" && isDaily(s));
    const metric = kind === "cost" ? "cost" : hasDailyProceeds ? "proceeds" : "revenue";
    const { daily, mtd: providerMtd } = sumDaily(metric);
    let mtd = providerMtd;

    const providerForecast = mine.find(
      (s) => s.metric === "forecast" && s.label == null && s.period_start === first && s.period_end === last && s.unit === currency,
    );
    const f = forecastMonth(daily, month, now, providerForecast?.value);
    let forecast = f.value;

    const lines = new Map<string, number>();
    for (const s of mine) {
      if (s.metric !== metric || isTotal(s) || !isDaily(s) || !inMonth(s) || s.unit !== currency) continue;
      lines.set(s.label!, (lines.get(s.label!) ?? 0) + s.value);
    }

    if (id === "manual") {
      // Manual revenue goes to the revenue total; the manual row itself is costs.
      const manualRevenue = sumDaily("revenue");
      revenue += manualRevenue.mtd;
      fRevenue += forecastMonth(manualRevenue.daily, month, now).value;
      for (const fc of fixedCosts) {
        const dates = renewalsBetween(fc, first, last);
        if (!dates.length) continue;
        if (fc.currency !== currency) {
          notes.push(`Fixed cost "${fc.name}" (${fc.currency} ${fc.amount.toFixed(2)}) is not in totals: different currency.`);
          continue;
        }
        const charged = dates.filter((d) => d <= today).length * fc.amount;
        mtd += charged;
        forecast += dates.length * fc.amount;
        if (charged) lines.set(fc.name, (lines.get(fc.name) ?? 0) + charged);
      }
    }

    const budget = budgets.find((b) => b.provider === id) ?? null;
    const row: ProviderSummary = {
      provider: id,
      kind: id === "manual" ? "cost" : kind,
      month_to_date: round2(mtd),
      currency,
      forecast: round2(forecast),
      forecast_method: f.method,
      budget,
      budget_used: budget && budget.currency === currency && budget.monthly_limit > 0 ? round2(mtd / budget.monthly_limit) : null,
      as_of: asOf,
      freshness: status?.freshness ?? (id === "manual" ? "manual" : ""),
      top_lines: [...lines.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, value]) => ({ label, value: round2(value) })),
    };
    providers.push(row);
    methods.add(f.method);

    if (row.kind === "revenue") {
      revenue += mtd;
      fRevenue += forecast;
      revenueAsOf.push(asOf);
    } else {
      costs += mtd;
      fCosts += forecast;
      costAsOf.push(id === "manual" && !mine.length ? now.toISOString() : asOf);
    }

    if ((STORES as readonly string[]).includes(id)) {
      const store = id as StoreSummary["store"];
      const events = salesEvents.filter((e) => e.store === store && e.occurred_at.slice(0, 10) >= first && e.occurred_at.slice(0, 10) <= last);
      const count = (t: SalesEventType) => events.filter((e) => e.type === t).length;
      let units = 0;
      for (const s of mine) if (s.metric === "units" && isTotal(s) && isDaily(s) && inMonth(s)) units += s.value;
      let storeAsOf = asOf;
      for (const e of salesEvents) if (e.store === store) storeAsOf = maxIso(storeAsOf, e.occurred_at);
      stores.push({
        store,
        proceeds: round2(mtd),
        units: Math.round(units),
        new_subscriptions: count("subscribed"),
        renewals: count("renewed"),
        refunds: count("refunded"),
        trials: count("trial_started"),
        currency,
        as_of: storeAsOf,
      });
    }
  }

  for (const [key, value] of excluded) {
    const [p, cur] = key.split("|");
    notes.push(`${p}: ${cur} ${value.toFixed(2)} is not in totals (no conversion to ${currency}).`);
  }

  const method = methods.size === 0 ? "run_rate_7d" : methods.size === 1 ? [...methods][0] : "mixed";
  return {
    month,
    currency,
    revenue: { value: round2(revenue), as_of: minIso(revenueAsOf) },
    costs: { value: round2(costs), as_of: minIso(costAsOf) },
    net: { value: round2(revenue - costs), as_of: minIso([...revenueAsOf, ...costAsOf]) },
    forecast: { revenue: round2(fRevenue), costs: round2(fCosts), net: round2(fRevenue - fCosts), method },
    providers,
    stores,
    notes,
  };
}

/** Month to date costs for evaluateBudgets, derived from a summary. */
export function monthToDateFromSummary(s: MoneySummary) {
  const byProvider: Partial<Record<ProviderId, number>> = {};
  for (const p of s.providers) if (p.kind === "cost") byProvider[p.provider] = p.month_to_date;
  return { total: s.costs.value, byProvider, currency: s.currency };
}
