// Fixed cost renewal reminders: an Important entry 14 days before each renewal.

import { addDays, parseYmd, startOfUtcDay, ymd } from "../providers/util";
import type { EntryDraft } from "./budgets";

export interface FixedCost {
  id: string;
  name: string;
  amount: number;
  currency: string;
  interval: "monthly" | "yearly";
  renews_on: string; // YYYY-MM-DD, the next (or a past) renewal date
  project_id?: string | null;
}

export const RENEWAL_LEAD_DAYS = 14;

/** Add months, clamping to the month's last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: string, months: number, anchorDay?: number): string {
  const d = parseYmd(date);
  const day = anchorDay ?? d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return ymd(target);
}

/** The first renewal on or after `today`, rolling a past renews_on forward by its interval. */
export function nextRenewal(fc: FixedCost, today: string): string {
  const step = fc.interval === "yearly" ? 12 : 1;
  const anchor = parseYmd(fc.renews_on).getUTCDate();
  let d = fc.renews_on;
  for (let i = 1; d < today && i < 1000; i++) d = addMonths(fc.renews_on, step * i, anchor);
  return d;
}

/** Every date this fixed cost is charged within [from, to] (inclusive). */
export function renewalsBetween(fc: FixedCost, from: string, to: string): string[] {
  const out: string[] = [];
  const first = nextRenewal(fc, from);
  const step = fc.interval === "yearly" ? 12 : 1;
  const anchor = parseYmd(fc.renews_on).getUTCDate();
  for (let d = first, i = 1; d <= to && out.length < 400; i++) {
    out.push(d);
    d = addMonths(first, step * i, anchor);
  }
  return out;
}

/**
 * Reminders due now: fixed costs renewing within the next 14 days. The entry sits on the
 * renewal day (all day). external_key = renewal:<id>:<date>, so re-running the daily job
 * upserts the same entry instead of adding another.
 */
export function dueRenewalReminders(input: { fixedCosts: FixedCost[]; now: Date }): EntryDraft[] {
  const today = ymd(startOfUtcDay(input.now));
  const until = ymd(addDays(parseYmd(today), RENEWAL_LEAD_DAYS));
  const out: EntryDraft[] = [];
  for (const fc of input.fixedCosts) {
    const date = nextRenewal(fc, today);
    if (date > until) continue;
    out.push({
      project: "Money",
      title: `Renewal: ${fc.name}`.slice(0, 120),
      notes: `${fc.name} renews on ${date} for ${fc.currency} ${fc.amount.toFixed(2)} (${fc.interval}). Cancel or update the card before then if needed.`,
      kind: "renewal",
      start_at: `${date}T00:00:00.000Z`,
      all_day: true,
      importance: "important",
      source: "system",
      external_key: `renewal:${fc.id}:${date}`,
      tags: ["renewal", "fixed_cost"],
    });
  }
  return out;
}
