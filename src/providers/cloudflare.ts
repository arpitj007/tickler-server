// Cloudflare: usage from the GraphQL Analytics API (Workers, D1, R2, KV), turned into cost with
// the dated price table in ./prices/cloudflare.ts. Cost is an estimate: the price table is per
// calendar month, while Cloudflare bills from your plan's renewal date.
// Docs: https://developers.cloudflare.com/analytics/graphql-api/

import { forecastMonth } from "../money/forecast";
import { BASE_FEE, CURRENCY, lineCost, PRICES, PRICES_AS_OF, R2_CLASS_B, R2_FREE } from "./prices/cloudflare";
import type { MetricSnapshotInput, Provider, ProviderConfig, SyncContext } from "./types";
import { daysInMonth, monthEnd, monthOf, monthStart, num, ProviderError, requestJson, required, snap, syncWindow, testWith, ymd } from "./util";

const API = "https://api.cloudflare.com/client/v4";
const LATENCY = "~5 minutes";

const QUERIES: Record<string, string> = {
  workers: `query($a: string!, $s: Date!, $e: Date!) { viewer { accounts(filter: {accountTag: $a}) {
    workersInvocationsAdaptive(limit: 10000, filter: {date_geq: $s, date_leq: $e}) { sum { requests cpuTimeUs } dimensions { date } } } } }`,
  d1: `query($a: string!, $s: Date!, $e: Date!) { viewer { accounts(filter: {accountTag: $a}) {
    d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: $s, date_leq: $e}) { sum { rowsRead rowsWritten } dimensions { date } }
    d1StorageAdaptiveGroups(limit: 10000, filter: {date_geq: $s, date_leq: $e}) { max { databaseSizeBytes } dimensions { date databaseId } } } } }`,
  r2: `query($a: string!, $st: Time!, $et: Time!) { viewer { accounts(filter: {accountTag: $a}) {
    r2OperationsAdaptiveGroups(limit: 10000, filter: {datetime_geq: $st, datetime_leq: $et}) { sum { requests } dimensions { date actionType } }
    r2StorageAdaptiveGroups(limit: 10000, filter: {datetime_geq: $st, datetime_leq: $et}) { max { payloadSize metadataSize } dimensions { date bucketName } } } } }`,
  kv: `query($a: string!, $s: Date!, $e: Date!) { viewer { accounts(filter: {accountTag: $a}) {
    kvOperationsAdaptiveGroups(limit: 10000, filter: {date_geq: $s, date_leq: $e}) { sum { requests } dimensions { date actionType } } } } }`,
};

async function graphql(ctx: SyncContext, cfg: ProviderConfig, query: string, variables: Record<string, string>): Promise<any> {
  const r: any = await requestJson(ctx.fetch, "Cloudflare", `${API}/graphql`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.api_token.trim()}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (r.errors?.length && !r.data?.viewer) throw new ProviderError(`Cloudflare: ${r.errors[0].message}`);
  return r.data?.viewer?.accounts?.[0] ?? {};
}

type Usage = Map<string, Map<string, number>>; // metric -> date -> value

function add(u: Usage, metric: string, date: string, v: number) {
  if (!u.has(metric)) u.set(metric, new Map());
  const m = u.get(metric)!;
  m.set(date, (m.get(date) ?? 0) + v);
}

/** Pull usage per day for [start, end]. Datasets that fail are skipped and reported. */
export async function fetchUsage(ctx: SyncContext, cfg: ProviderConfig, start: string, end: string): Promise<{ usage: Usage; failed: string[] }> {
  const a = cfg.account_id.trim();
  const dateVars = { a, s: start, e: end };
  const timeVars = { a, st: `${start}T00:00:00Z`, et: `${end}T23:59:59Z` };
  const usage: Usage = new Map();
  const failed: string[] = [];
  const run = async (name: string, vars: Record<string, string>, fn: (acc: any) => void) => {
    try {
      fn(await graphql(ctx, cfg, QUERIES[name], vars));
    } catch (e) {
      if (e instanceof ProviderError && e.status === 401) throw e;
      failed.push(`${name}: ${(e as Error).message}`);
    }
  };
  await run("workers", dateVars, (acc) => {
    for (const g of acc.workersInvocationsAdaptive ?? []) {
      add(usage, "workers_requests", g.dimensions.date, num(g.sum.requests));
      add(usage, "workers_cpu_ms", g.dimensions.date, num(g.sum.cpuTimeUs) / 1000);
    }
  });
  await run("d1", dateVars, (acc) => {
    for (const g of acc.d1AnalyticsAdaptiveGroups ?? []) {
      add(usage, "d1_rows_read", g.dimensions.date, num(g.sum.rowsRead));
      add(usage, "d1_rows_written", g.dimensions.date, num(g.sum.rowsWritten));
    }
    for (const g of acc.d1StorageAdaptiveGroups ?? []) add(usage, "d1_storage_gb", g.dimensions.date, num(g.max.databaseSizeBytes) / 1e9);
  });
  await run("r2", timeVars, (acc) => {
    for (const g of acc.r2OperationsAdaptiveGroups ?? []) {
      const t = g.dimensions.actionType;
      if (R2_FREE.has(t)) continue;
      add(usage, R2_CLASS_B.has(t) ? "r2_class_b" : "r2_class_a", g.dimensions.date, num(g.sum.requests));
    }
    for (const g of acc.r2StorageAdaptiveGroups ?? []) add(usage, "r2_storage_gb", g.dimensions.date, (num(g.max.payloadSize) + num(g.max.metadataSize)) / 1e9);
  });
  await run("kv", dateVars, (acc) => {
    for (const g of acc.kvOperationsAdaptiveGroups ?? []) {
      add(usage, String(g.dimensions.actionType).toLowerCase() === "read" ? "kv_reads" : "kv_writes", g.dimensions.date, num(g.sum.requests));
    }
  });
  return { usage, failed };
}

/** Daily cost for each day of `month` from cumulative usage (included amounts are per month). */
export function dailyCosts(usage: Usage, month: string, paid: boolean): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>(); // date -> product -> cost
  const first = monthStart(month);
  const last = monthEnd(month);
  const days = daysInMonth(month);
  const put = (date: string, product: string, v: number) => {
    if (!out.has(date)) out.set(date, new Map());
    const m = out.get(date)!;
    m.set(product, (m.get(product) ?? 0) + v);
  };
  if (!paid) return out;
  put(first, "Workers Paid plan", BASE_FEE);
  for (const line of PRICES) {
    const series = [...(usage.get(line.metric) ?? new Map()).entries()].filter(([d]) => d >= first && d <= last).sort();
    let cum = 0;
    for (const [date, v] of series) {
      if (line.kind === "gauge") {
        put(date, line.product, lineCost(line, v) / days);
      } else {
        put(date, line.product, lineCost(line, cum + v) - lineCost(line, cum));
        cum += v;
      }
    }
  }
  return out;
}

/** Month-end cost estimate: each usage line projected with the 7 day run rate, then priced. */
export function forecastCost(usage: Usage, month: string, now: Date, paid: boolean): number {
  if (!paid) return 0;
  let total = BASE_FEE;
  for (const line of PRICES) {
    const series = Object.fromEntries(usage.get(line.metric) ?? new Map());
    if (line.kind === "gauge") {
      const dates = Object.keys(series).sort();
      total += dates.length ? lineCost(line, series[dates[dates.length - 1]]) : 0;
    } else {
      total += lineCost(line, forecastMonth(series, month, now).value);
    }
  }
  return total;
}

export const cloudflare: Provider = {
  id: "cloudflare",
  displayName: "Cloudflare",
  kind: "cost",
  guide: "providers/cloudflare",
  freshness: `every 15 minutes; cost estimated from usage (prices as of ${PRICES_AS_OF})`,
  syncEveryMinutes: 15,
  fields: [
    { key: "api_token", label: "API token", secret: true, help: "Custom token with Account > Account Analytics > Read only." },
    { key: "account_id", label: "Account ID", secret: false, help: "Shown on the account home page and in the URL." },
    { key: "plan", label: "Workers plan", secret: false, optional: true, help: '"paid" (default) or "free". Free plans have no usage cost.' },
  ],

  configured: (cfg) => required(cfg, "api_token", "account_id"),

  test: (cfg, ctx) =>
    testWith(async () => {
      const today = ymd(ctx.now);
      await graphql(ctx, cfg, QUERIES.workers, { a: cfg.account_id.trim(), s: today, e: today });
      return "Connected: the token can read account analytics.";
    }),

  async sync(cfg, ctx) {
    const { start, end } = syncWindow(ctx.now);
    const month = monthOf(ctx.now);
    const paid = (cfg.plan ?? "paid").trim().toLowerCase() !== "free";
    const { usage, failed } = await fetchUsage(ctx, cfg, start, end);
    if (failed.length === 4) throw new ProviderError(`Cloudflare: no analytics could be read (${failed[0]})`);
    const account = cfg.account_id.trim();
    const snapshots: MetricSnapshotInput[] = [];
    const o = { source_latency: LATENCY };

    for (const line of PRICES) {
      for (const [date, v] of usage.get(line.metric) ?? []) {
        snapshots.push(snap("cloudflare", account, "usage", line.unit, v, date, date, { ...o, label: line.label }));
      }
    }
    // Cost only for days of the current month: earlier days need the previous month's totals.
    const costs = dailyCosts(usage, month, paid);
    const today = ymd(ctx.now);
    for (const date of [...new Set([monthStart(month), ...[...usage.values()].flatMap((m) => [...m.keys()])])].sort()) {
      if (date < monthStart(month) || date > today) continue;
      const byProduct = costs.get(date) ?? new Map();
      let total = 0;
      for (const [product, v] of byProduct) {
        total += v;
        snapshots.push(snap("cloudflare", account, "cost", CURRENCY, v, date, date, { ...o, label: product }));
      }
      snapshots.push(snap("cloudflare", account, "cost", CURRENCY, total, date, date, { ...o, raw: failed.length ? { skipped: failed } : undefined }));
    }
    snapshots.push(
      snap("cloudflare", account, "forecast", CURRENCY, forecastCost(usage, month, ctx.now, paid), monthStart(month), monthEnd(month), {
        ...o,
        raw: { method: "usage run rate x price table", prices_as_of: PRICES_AS_OF },
      }),
    );
    return { snapshots };
  },
};
