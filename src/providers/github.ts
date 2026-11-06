// GitHub: enhanced billing platform usage report (Actions minutes, storage, Copilot, seats...)
// for a personal account or an organization. Docs: https://docs.github.com/en/rest/billing/usage

import type { MetricSnapshotInput, Provider, ProviderConfig, SyncContext } from "./types";
import { addDays, bump, dateRange, monthOf, num, requestJson, required, snap, syncWindow, testWith, ymd } from "./util";

const LATENCY = "~1 day";

function isOrg(cfg: ProviderConfig): boolean {
  return (cfg.owner_type ?? "").trim().toLowerCase().startsWith("org");
}

function usageUrl(cfg: ProviderConfig, month: string): string {
  const [year, m] = month.split("-");
  const owner = encodeURIComponent(cfg.owner.trim());
  const base = isOrg(cfg) ? `https://api.github.com/organizations/${owner}` : `https://api.github.com/users/${owner}`;
  return `${base}/settings/billing/usage?year=${year}&month=${Number(m)}`;
}

function get(ctx: SyncContext, cfg: ProviderConfig, url: string) {
  return requestJson(ctx.fetch, "GitHub", url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${cfg.token.trim()}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "tickler-server",
    },
  });
}

export const github: Provider = {
  id: "github",
  displayName: "GitHub",
  kind: "cost",
  guide: "providers/github",
  freshness: "hourly pull, GitHub updates usage about daily",
  syncEveryMinutes: 60,
  fields: [
    { key: "token", label: "Fine-grained token", secret: true, help: "Read-only: Plan (personal account) or Administration (organization)." },
    { key: "owner", label: "Username or organization", secret: false },
    { key: "owner_type", label: "Account type", secret: false, optional: true, help: '"user" (default) or "org".' },
  ],

  configured: (cfg) => required(cfg, "token", "owner"),

  test: (cfg, ctx) =>
    testWith(async () => {
      const r: any = await get(ctx, cfg, usageUrl(cfg, monthOf(ctx.now)));
      return `Connected: ${r.usageItems?.length ?? 0} usage lines this month for ${cfg.owner.trim()}.`;
    }),

  async sync(cfg, ctx) {
    const { start, end } = syncWindow(ctx.now);
    const months = [...new Set([monthOf(new Date(`${start}T00:00:00Z`)), monthOf(new Date(`${end}T00:00:00Z`))])];
    const account = cfg.owner.trim();
    const cost = new Map<string, number>(); // date -> net amount
    const byProduct = new Map<string, number>(); // date|product -> net
    const usage = new Map<string, number>(); // date|product unit -> quantity
    for (const month of months) {
      const r: any = await get(ctx, cfg, usageUrl(cfg, month));
      for (const it of r.usageItems ?? []) {
        const date = String(it.date).slice(0, 10);
        if (date < start || date > end) continue;
        bump(cost, date, num(it.netAmount));
        bump(byProduct, `${date}|${it.product}`, num(it.netAmount));
        bump(usage, `${date}|${it.product} ${String(it.unitType ?? "units").toLowerCase()}`, num(it.quantity));
      }
    }
    // Days with no usage lines are zero spend. Skip the last day: GitHub may not have posted it yet.
    for (const date of dateRange(start, ymd(addDays(ctx.now, -2)))) if (!cost.has(date)) cost.set(date, 0);
    const snapshots: MetricSnapshotInput[] = [];
    for (const [date, v] of cost) snapshots.push(snap("github", account, "cost", "USD", v, date, date, { source_latency: LATENCY }));
    for (const [key, v] of byProduct) {
      const [date, label] = key.split("|");
      snapshots.push(snap("github", account, "cost", "USD", v, date, date, { label, source_latency: LATENCY }));
    }
    for (const [key, v] of usage) {
      const [date, label] = key.split("|");
      const unit = label.split(" ").pop() || "units";
      snapshots.push(snap("github", account, "usage", unit, v, date, date, { label, source_latency: LATENCY }));
    }
    return { snapshots };
  },
};
