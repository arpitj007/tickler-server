// Google Cloud: daily cost (after credits) from the Cloud Billing export to BigQuery, and budget
// amounts from the Budget API. The Budget API returns no spend or forecast, so the month-end
// forecast is Tickler's 7 day run rate.
// Docs: https://cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/standard-usage
//       https://cloud.google.com/billing/docs/reference/budget/rest/v1/billingAccounts.budgets/list

import { googleToken, parseServiceAccount } from "./google";
import type { MetricSnapshotInput, Provider, ProviderConfig, SyncContext } from "./types";
import { bump, currencyLabel, num, ProviderError, requestJson, required, snap, syncWindow, testWith } from "./util";

const SCOPES = ["https://www.googleapis.com/auth/bigquery.readonly", "https://www.googleapis.com/auth/cloud-billing"];
const LATENCY = "several hours to 1 day";
const TABLE_RE = /^[a-z0-9-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/;

function table(cfg: ProviderConfig): { project: string; ref: string } {
  const t = cfg.bigquery_table.trim().replace(/`/g, "").replace(":", ".");
  if (!TABLE_RE.test(t)) throw new ProviderError("BigQuery table must look like project.dataset.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX");
  return { project: t.split(".")[0], ref: t };
}

async function token(ctx: SyncContext, cfg: ProviderConfig) {
  return googleToken(ctx.fetch, parseServiceAccount(cfg.service_account_json), SCOPES, ctx.now);
}

export function dailyCostSql(ref: string): string {
  return `SELECT FORMAT_DATE('%F', DATE(usage_start_time)) AS day, service.description AS service, currency,
  SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net
FROM \`${ref}\`
WHERE usage_start_time >= TIMESTAMP(@start)
GROUP BY day, service, currency`;
}

/** Run a query with jobs.query, polling getQueryResults until complete. Rows as objects. */
export async function bigQuery(ctx: SyncContext, tok: string, project: string, query: string, params: Record<string, string>, location?: string): Promise<Record<string, string | null>[]> {
  const auth = { authorization: `Bearer ${tok}`, "content-type": "application/json" };
  const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}`;
  let r: any = await requestJson(ctx.fetch, "BigQuery", `${base}/queries`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      query,
      useLegacySql: false,
      timeoutMs: 20000,
      parameterMode: "NAMED",
      queryParameters: Object.entries(params).map(([name, value]) => ({ name, parameterType: { type: "STRING" }, parameterValue: { value } })),
      ...(location ? { location } : {}),
    }),
  });
  const rows: any[] = [...(r.rows ?? [])];
  let schema = r.schema;
  for (let i = 0; i < 10 && (!r.jobComplete || r.pageToken); i++) {
    const job = r.jobReference;
    const qs = `location=${encodeURIComponent(job.location ?? location ?? "")}&timeoutMs=20000${r.pageToken ? `&pageToken=${encodeURIComponent(r.pageToken)}` : ""}`;
    r = await requestJson(ctx.fetch, "BigQuery", `${base}/queries/${encodeURIComponent(job.jobId)}?${qs}`, { headers: auth });
    schema = r.schema ?? schema;
    rows.push(...(r.rows ?? []));
  }
  if (!r.jobComplete) throw new ProviderError("BigQuery: query did not finish in time");
  const names: string[] = (schema?.fields ?? []).map((f: any) => f.name);
  return rows.map((row) => Object.fromEntries(names.map((n, i) => [n, row.f[i]?.v ?? null])));
}

export const googleCloud: Provider = {
  id: "google_cloud",
  displayName: "Google Cloud",
  kind: "cost",
  guide: "providers/google_cloud",
  freshness: "every 6 hours; Google exports costs several hours to a day late",
  syncEveryMinutes: 360,
  fields: [
    { key: "service_account_json", label: "Service account key (JSON)", secret: true, multiline: true },
    { key: "bigquery_table", label: "Billing export table", secret: false, help: "project.dataset.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX" },
    { key: "bigquery_location", label: "Dataset location", secret: false, optional: true, help: "US, EU or a region. Default: US." },
    { key: "billing_account_id", label: "Billing account ID", secret: false, optional: true, help: "XXXXXX-XXXXXX-XXXXXX, to read budgets." },
  ],

  configured: (cfg) => required(cfg, "service_account_json", "bigquery_table"),

  test: (cfg, ctx) =>
    testWith(async () => {
      const tok = await token(ctx, cfg);
      const { project, ref } = table(cfg);
      await bigQuery(ctx, tok, project, `SELECT COUNT(*) AS n FROM \`${ref}\` WHERE usage_start_time >= TIMESTAMP(@start)`, { start: ctx.now.toISOString().slice(0, 10) }, cfg.bigquery_location?.trim() || undefined);
      let budgets = "";
      if (cfg.billing_account_id) budgets = ` ${(await listBudgets(ctx, cfg, tok)).length} budget(s) found.`;
      return `Connected: the billing export table is readable.${budgets}`;
    }),

  async sync(cfg, ctx) {
    const tok = await token(ctx, cfg);
    const { project, ref } = table(cfg);
    const { start, end } = syncWindow(ctx.now);
    const rows = await bigQuery(ctx, tok, project, dailyCostSql(ref), { start }, cfg.bigquery_location?.trim() || undefined);
    const totals = new Map<string, number>(); // day|currency
    const lines = new Map<string, number>(); // day|currency|service
    for (const r of rows) {
      if (!r.day || r.day > end) continue;
      const cur = String(r.currency ?? "USD").toUpperCase();
      bump(totals, `${r.day}|${cur}`, num(r.net));
      bump(lines, `${r.day}|${cur}|${r.service ?? "other"}`, num(r.net));
    }
    const snapshots: MetricSnapshotInput[] = [];
    const account = cfg.billing_account_id?.trim() || ref.split(".").pop()!;
    for (const [key, v] of totals) {
      const [date, cur] = key.split("|");
      snapshots.push(snap("google_cloud", account, "cost", cur, v, date, date, { label: currencyLabel(cur, ctx.currency), source_latency: LATENCY }));
    }
    for (const [key, v] of lines) {
      const [date, cur, service] = key.split("|");
      if (cur === ctx.currency && v !== 0) snapshots.push(snap("google_cloud", account, "cost", cur, v, date, date, { label: service, source_latency: LATENCY }));
    }
    // Budget amounts and thresholds ride along in raw of the newest total (for the detail screen).
    if (cfg.billing_account_id && snapshots.length) {
      try {
        const budgets = await listBudgets(ctx, cfg, tok);
        const newest = snapshots.filter((x) => x.label == null).sort((a, b) => b.period_start.localeCompare(a.period_start))[0];
        if (newest) newest.raw = { budgets };
      } catch {
        // Budgets are optional; costs still sync without the Billing Account Viewer role.
      }
    }
    return { snapshots };
  },
};

/** Budgets on the billing account (amounts and thresholds only; the API has no spend). */
export async function listBudgets(ctx: SyncContext, cfg: ProviderConfig, tok?: string) {
  const t = tok ?? (await token(ctx, cfg));
  const id = encodeURIComponent(cfg.billing_account_id.trim());
  const r: any = await requestJson(ctx.fetch, "Budget API", `https://billingbudgets.googleapis.com/v1/billingAccounts/${id}/budgets?pageSize=100`, {
    headers: { authorization: `Bearer ${t}` },
  });
  return (r.budgets ?? []).map((b: any) => ({
    name: b.displayName ?? b.name,
    amount: b.amount?.specifiedAmount ? num(b.amount.specifiedAmount.units) + (b.amount.specifiedAmount.nanos ?? 0) / 1e9 : null,
    currency: b.amount?.specifiedAmount?.currencyCode ?? null,
    thresholds: (b.thresholdRules ?? []).map((t: any) => t.thresholdPercent),
  }));
}
