// Budget threshold alerts: one alert per budget, threshold and month, created on the first
// crossing only.

import type { ProviderId } from "../providers/types";

export interface Budget {
  id: string;
  provider: ProviderId | null; // null = all costs
  project_id?: string | null;
  monthly_limit: number;
  currency: string;
  thresholds: number[];
}

export interface ExistingAlert {
  budget_id: string;
  month: string;
  threshold: number;
}

export interface EntryDraft {
  project: string; // project name, created by the core if missing
  title: string;
  notes: string;
  kind: "reminder" | "renewal" | "deadline";
  start_at: string;
  all_day: boolean;
  importance: "normal" | "important" | "critical";
  source: "system";
  external_key: string;
  tags: string[];
  links?: { title: string; url: string }[];
}

export interface NewAlert {
  budget_id: string;
  month: string;
  threshold: number;
  value: number;
  /** Entry to create and link. Only the highest threshold crossed in one run gets an entry,
   *  so a jump from 0% to 120% gives one critical entry, not three. */
  entry: EntryDraft | null;
}

export interface MonthToDate {
  /** All costs in `currency`, fixed costs included. */
  total: number;
  byProvider: Partial<Record<ProviderId, number>>;
  currency: string;
}

const NAMES: Record<string, string> = {
  app_store: "App Store",
  google_play: "Google Play",
  amazon_appstore: "Amazon Appstore",
  stripe: "Stripe",
  cloudflare: "Cloudflare",
  google_cloud: "Google Cloud",
  aws: "AWS",
  anthropic: "Anthropic",
  openai: "OpenAI",
  github: "GitHub",
  manual: "Manual costs",
};

function money(v: number, currency: string): string {
  return `${currency} ${v.toFixed(2)}`;
}

/** Returns the alerts to create now. Budgets in a currency other than the summary
 *  currency are skipped (no conversion in v1). */
export function evaluateBudgets(input: {
  budgets: Budget[];
  monthToDate: MonthToDate;
  existingAlerts: ExistingAlert[];
  month: string; // YYYY-MM
  now?: Date;
}): NewAlert[] {
  const { budgets, monthToDate, existingAlerts, month } = input;
  const now = input.now ?? new Date();
  const out: NewAlert[] = [];
  for (const b of budgets) {
    if (!(b.monthly_limit > 0) || b.currency !== monthToDate.currency) continue;
    const value = b.provider ? monthToDate.byProvider[b.provider] ?? 0 : monthToDate.total;
    const used = value / b.monthly_limit;
    const crossed = [...new Set(b.thresholds)]
      .filter((t) => t > 0 && used >= t)
      .filter((t) => !existingAlerts.some((a) => a.budget_id === b.id && a.month === month && Math.abs(a.threshold - t) < 1e-9))
      .sort((x, y) => x - y);
    crossed.forEach((t, i) => {
      const top = i === crossed.length - 1;
      out.push({ budget_id: b.id, month, threshold: t, value: round2(value), entry: top ? entryFor(b, t, value, used, month, now) : null });
    });
  }
  return out;
}

function entryFor(b: Budget, t: number, value: number, used: number, month: string, now: Date): EntryDraft {
  const name = b.provider ? NAMES[b.provider] ?? b.provider : "All costs";
  const pct = Math.round(t * 100);
  const title = t >= 1 ? `${name} is over budget for ${month}` : `${name} reached ${pct}% of budget for ${month}`;
  return {
    project: "Money",
    title: title.slice(0, 120),
    notes: [
      `${name} spent ${money(value, b.currency)} of ${money(b.monthly_limit, b.currency)} in ${month} (${Math.round(used * 100)}%).`,
      `Threshold: ${pct}%.`,
      "Open Money in Tickler for the breakdown and the forecast.",
    ].join("\n\n"),
    kind: "reminder",
    start_at: now.toISOString(),
    all_day: false,
    importance: t >= 1 ? "critical" : "important",
    source: "system",
    external_key: `budget:${b.id}:${month}:${t}`,
    tags: ["budget", b.provider ?? "all"],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
