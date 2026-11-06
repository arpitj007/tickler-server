// Month-end forecast. All dates are UTC calendar days (YYYY-MM-DD).

import { addDays, monthEnd, monthStart, parseYmd, startOfUtcDay, ymd } from "../providers/util";

export type DailyValues = Record<string, number> | { date: string; value: number }[];

export interface Forecast {
  value: number;
  method: "provider" | "run_rate_7d";
}

function toMap(daily: DailyValues): Map<string, number> {
  const m = new Map<string, number>();
  const list = Array.isArray(daily) ? daily.map((d) => [d.date, d.value] as const) : Object.entries(daily);
  for (const [date, value] of list) m.set(date, (m.get(date) ?? 0) + value);
  return m;
}

/**
 * The provider's own forecast when it has one. Otherwise:
 * complete days of the month + average of the last 7 complete days x days left.
 *
 * "Complete" ends at the horizon: yesterday (UTC), or the last day the source has data for if
 * it lags (App Store reports arrive a day late). Today's partial value is not counted; the
 * average stands in for it. Days between the first known day and the horizon with no value
 * count as 0. With fewer than 7 known days (new source), the average uses the days there are.
 * For a past month this returns the actual total.
 */
export function forecastMonth(
  dailyValues: DailyValues,
  month: string,
  now: Date,
  providerForecast?: number | null,
): Forecast {
  if (providerForecast != null && Number.isFinite(providerForecast)) {
    return { value: round2(providerForecast), method: "provider" };
  }
  const daily = toMap(dailyValues);
  const dates = [...daily.keys()].sort();
  if (!dates.length) return { value: 0, method: "run_rate_7d" };

  const first = monthStart(month);
  const last = monthEnd(month);
  const yesterday = ymd(addDays(startOfUtcDay(now), -1));
  let horizon = dates[dates.length - 1] < yesterday ? dates[dates.length - 1] : yesterday;
  if (horizon > last) horizon = last;

  let done = 0;
  for (const [date, value] of daily) if (date >= first && date <= horizon) done += value;

  // Days of the month after the horizon still to come.
  const fromDay = horizon < first ? first : ymd(addDays(parseYmd(horizon), 1));
  const daysLeft = fromDay > last ? 0 : Math.round((parseYmd(last).getTime() - parseYmd(fromDay).getTime()) / 86_400_000) + 1;
  if (daysLeft === 0) return { value: round2(done), method: "run_rate_7d" };

  const weekStart = ymd(addDays(parseYmd(horizon), -6));
  const windowStart = dates[0] > weekStart ? dates[0] : weekStart;
  let sum = 0;
  let n = 0;
  for (let d = parseYmd(windowStart); ymd(d) <= horizon; d = addDays(d, 1)) {
    sum += daily.get(ymd(d)) ?? 0;
    n++;
  }
  const avg = n > 0 ? sum / n : 0;
  return { value: round2(done + avg * daysLeft), method: "run_rate_7d" };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
