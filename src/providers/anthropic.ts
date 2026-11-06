// Anthropic: Admin API cost report (USD per day, by model) and usage report (tokens by model).
// Docs: https://platform.claude.com/docs/en/manage-claude/usage-cost-api

import type { MetricSnapshotInput, Provider, ProviderConfig, SyncContext } from "./types";
import { addDays, bump, num, parseYmd, requestJson, required, snap, syncWindow, testWith } from "./util";

const BASE = "https://api.anthropic.com";
const VERSION = "2023-06-01";
const LATENCY = "~5 minutes";

function headers(cfg: ProviderConfig): Record<string, string> {
  return { "x-api-key": cfg.admin_key.trim(), "anthropic-version": VERSION };
}

/** Follow next_page until done (max 10 pages). */
async function pages(ctx: SyncContext, cfg: ProviderConfig, path: string, params: string[]): Promise<any[]> {
  const out: any[] = [];
  let page: string | null = null;
  for (let i = 0; i < 10; i++) {
    const qs = [...params, ...(page ? [`page=${encodeURIComponent(page)}`] : [])].join("&");
    const r: any = await requestJson(ctx.fetch, "Anthropic", `${BASE}${path}?${qs}`, { headers: headers(cfg) });
    out.push(...(r.data ?? []));
    if (!r.has_more || !r.next_page) break;
    page = r.next_page;
  }
  return out;
}

export const anthropic: Provider = {
  id: "anthropic",
  displayName: "Anthropic",
  kind: "cost",
  guide: "providers/anthropic",
  freshness: "every 15 minutes, about 5 minutes behind",
  syncEveryMinutes: 15,
  fields: [
    { key: "admin_key", label: "Admin API key", secret: true, help: "Starts with sk-ant-admin. Claude Console > Settings > Admin keys." },
  ],

  configured: (cfg) => required(cfg, "admin_key") && cfg.admin_key.trim().startsWith("sk-ant-admin"),

  test: (cfg, ctx) =>
    testWith(async () => {
      const r: any = await requestJson(ctx.fetch, "Anthropic", `${BASE}/v1/organizations/me`, { headers: headers(cfg) });
      return `Connected to ${r.name ? `organization "${r.name}"` : "your organization"}.`;
    }),

  async sync(cfg, ctx) {
    const { start, end } = syncWindow(ctx.now);
    const range = [`starting_at=${start}T00:00:00Z`, `ending_at=${addDays(parseYmd(end), 1).toISOString().replace(".000", "")}`, "bucket_width=1d", "limit=31"];
    const snapshots: MetricSnapshotInput[] = [];

    // Costs: amount is a decimal string in cents.
    const costBuckets = await pages(ctx, cfg, "/v1/organizations/cost_report", [...range, "group_by[]=description"]);
    for (const b of costBuckets) {
      const date = String(b.starting_at).slice(0, 10);
      let total = 0;
      const byModel = new Map<string, number>();
      for (const r of b.results ?? []) {
        const usd = num(r.amount) / 100;
        total += usd;
        bump(byModel, r.model ?? r.description ?? "other", usd);
      }
      snapshots.push(snap("anthropic", "default", "cost", "USD", total, date, date, { source_latency: LATENCY }));
      for (const [model, v] of byModel) snapshots.push(snap("anthropic", "default", "cost", "USD", v, date, date, { label: model, source_latency: LATENCY }));
    }

    // Tokens by model.
    const usageBuckets = await pages(ctx, cfg, "/v1/organizations/usage_report/messages", [...range, "group_by[]=model"]);
    for (const b of usageBuckets) {
      const date = String(b.starting_at).slice(0, 10);
      let total = 0;
      for (const r of b.results ?? []) {
        const tokens =
          num(r.uncached_input_tokens) +
          num(r.cache_read_input_tokens) +
          num(r.cache_creation?.ephemeral_5m_input_tokens) +
          num(r.cache_creation?.ephemeral_1h_input_tokens) +
          num(r.output_tokens);
        total += tokens;
        snapshots.push(snap("anthropic", "default", "usage", "tokens", tokens, date, date, { label: r.model ?? "other", source_latency: LATENCY }));
      }
      snapshots.push(snap("anthropic", "default", "usage", "tokens", total, date, date, { source_latency: LATENCY }));
    }
    return { snapshots };
  },
};
