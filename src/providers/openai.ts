// OpenAI: organization costs (USD per day, by line item) and completions usage (tokens by model).
// Docs: https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs

import type { MetricSnapshotInput, Provider, ProviderConfig, SyncContext } from "./types";
import { bump, num, parseYmd, requestJson, required, snap, syncWindow, testWith, ymd } from "./util";

const BASE = "https://api.openai.com/v1/organization";
const LATENCY = "~1 hour";

function auth(cfg: ProviderConfig) {
  return { headers: { authorization: `Bearer ${cfg.admin_key.trim()}` } };
}

async function pages(ctx: SyncContext, cfg: ProviderConfig, path: string, params: string[]): Promise<any[]> {
  const out: any[] = [];
  let page: string | null = null;
  for (let i = 0; i < 10; i++) {
    const qs = [...params, ...(page ? [`page=${encodeURIComponent(page)}`] : [])].join("&");
    const r: any = await requestJson(ctx.fetch, "OpenAI", `${BASE}${path}?${qs}`, auth(cfg));
    out.push(...(r.data ?? []));
    if (!r.has_more || !r.next_page) break;
    page = r.next_page;
  }
  return out;
}

const day = (unix: number) => ymd(new Date(unix * 1000));

export const openai: Provider = {
  id: "openai",
  displayName: "OpenAI",
  kind: "cost",
  guide: "providers/openai",
  freshness: "hourly",
  syncEveryMinutes: 60,
  fields: [
    { key: "admin_key", label: "Admin key", secret: true, help: "Starts with sk-admin. Settings > Organization > Admin keys." },
  ],

  configured: (cfg) => required(cfg, "admin_key"),

  test: (cfg, ctx) =>
    testWith(async () => {
      const since = Math.floor(ctx.now.getTime() / 1000) - 86_400;
      await requestJson(ctx.fetch, "OpenAI", `${BASE}/costs?start_time=${since}&limit=1`, auth(cfg));
      return "Connected: the key can read organization costs.";
    }),

  async sync(cfg, ctx) {
    const { start } = syncWindow(ctx.now);
    const startTime = Math.floor(parseYmd(start).getTime() / 1000);
    const snapshots: MetricSnapshotInput[] = [];

    const costs = await pages(ctx, cfg, "/costs", [`start_time=${startTime}`, "bucket_width=1d", "limit=31", "group_by[]=line_item"]);
    for (const b of costs) {
      const date = day(b.start_time);
      const totals = new Map<string, number>();
      const lines = new Map<string, number>();
      for (const r of b.results ?? []) {
        const cur = String(r.amount?.currency ?? "usd").toUpperCase();
        bump(totals, cur, num(r.amount?.value));
        if (r.line_item) bump(lines, `${cur}|${r.line_item}`, num(r.amount?.value));
      }
      if (!totals.size) totals.set("USD", 0);
      for (const [cur, v] of totals) snapshots.push(snap("openai", "default", "cost", cur, v, date, date, { source_latency: LATENCY }));
      for (const [key, v] of lines) {
        const [cur, label] = key.split("|");
        snapshots.push(snap("openai", "default", "cost", cur, v, date, date, { label, source_latency: LATENCY }));
      }
    }

    const usage = await pages(ctx, cfg, "/usage/completions", [`start_time=${startTime}`, "bucket_width=1d", "limit=31", "group_by[]=model"]);
    for (const b of usage) {
      const date = day(b.start_time);
      let total = 0;
      for (const r of b.results ?? []) {
        const tokens = num(r.input_tokens) + num(r.output_tokens);
        total += tokens;
        snapshots.push(snap("openai", "default", "usage", "tokens", tokens, date, date, { label: r.model ?? "other", source_latency: LATENCY }));
      }
      snapshots.push(snap("openai", "default", "usage", "tokens", total, date, date, { source_latency: LATENCY }));
    }
    return { snapshots };
  },
};
