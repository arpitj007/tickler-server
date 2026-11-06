// Time input handling. Stored times are UTC ISO strings. Inputs may be:
//   "2026-03-29T09:00:00Z" or with an offset ("+02:00")  -> that instant
//   "2026-03-29T09:00"                                      -> wall time in the entry's time zone
//   "2026-03-29"                                            -> all day: local midnight in the time zone
// Wall times in a DST gap move forward (02:30 in a spring-forward gap becomes 03:30, as RFC 5545
// specifies); ambiguous wall times in a fall-back hour take the first occurrence.

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds (local minus UTC). */
export function tzOffsetMs(tz: string, ms: number): number {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const local = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return local - Math.floor(ms / 1000) * 1000;
}

/** Wall-clock fields in `tz` to a UTC Date. */
export function localToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const before = tzOffsetMs(tz, guess - 14 * 3600_000);
  const after = tzOffsetMs(tz, guess + 14 * 3600_000);
  const valid = [before, after].map((o) => guess - o).filter((t) => guess - tzOffsetMs(tz, t) === t);
  if (valid.length) return new Date(Math.min(...valid));
  return new Date(guess - before); // gap: shift forward by the jump
}

const ABS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ParsedTime {
  at: Date;
  dateOnly: boolean;
  date?: { y: number; m: number; d: number };
}

/** Returns null if the value can't be parsed. */
export function parseTimeInput(value: string, tz: string): ParsedTime | null {
  const v = value.trim();
  if (ABS.test(v)) {
    const at = new Date(v);
    return isNaN(at.getTime()) ? null : { at, dateOnly: false };
  }
  let m = LOCAL.exec(v);
  if (m) {
    const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number) as number[];
    if (!validDate(y!, mo!, d!) || h! > 23 || mi! > 59 || s! > 59) return null;
    return { at: localToUtc(y!, mo!, d!, h!, mi!, s!, tz), dateOnly: false };
  }
  m = DATE.exec(v);
  if (m) {
    const [y, mo, d] = [m[1], m[2], m[3]].map(Number) as number[];
    if (!validDate(y!, mo!, d!)) return null;
    return { at: localToUtc(y!, mo!, d!, 0, 0, 0, tz), dateOnly: true, date: { y: y!, m: mo!, d: d! } };
  }
  return null;
}

/** Local midnight at the start of the day after `date` (all-day end, exclusive). 23 or 25 h on DST days. */
export function nextLocalMidnight(date: { y: number; m: number; d: number }, tz: string): Date {
  const next = new Date(Date.UTC(date.y, date.m - 1, date.d + 1));
  return localToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, 0, tz);
}

function validDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const RRULE_KEYS = new Set([
  "FREQ", "UNTIL", "COUNT", "INTERVAL", "BYSECOND", "BYMINUTE", "BYHOUR", "BYDAY",
  "BYMONTHDAY", "BYYEARDAY", "BYWEEKNO", "BYMONTH", "BYSETPOS", "WKST",
]);
const FREQS = new Set(["SECONDLY", "MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

/** Light RRULE check (RFC 5545 syntax, no DTSTART). Returns an error message or null. */
export function rruleError(rule: string): string | null {
  const r = rule.trim().replace(/^RRULE:/i, "");
  const parts = r.split(";").filter(Boolean);
  const seen = new Map<string, string>();
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (!k || !v) return `Bad RRULE part "${p}"`;
    const key = k.toUpperCase();
    if (!RRULE_KEYS.has(key)) return `Unsupported RRULE part ${key} (no DTSTART; start_at is the start)`;
    seen.set(key, v.toUpperCase());
  }
  const freq = seen.get("FREQ");
  if (!freq || !FREQS.has(freq)) return "RRULE needs FREQ=DAILY|WEEKLY|MONTHLY|YEARLY (or HOURLY...)";
  if (seen.has("COUNT") && seen.has("UNTIL")) return "RRULE can't have both COUNT and UNTIL";
  return null;
}
