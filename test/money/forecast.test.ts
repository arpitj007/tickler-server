import { describe, expect, it } from "vitest";
import { forecastMonth } from "../../src/money/forecast";
import { dateRange } from "../../src/providers/util";

const flat = (start: string, end: string, v: number) => Object.fromEntries(dateRange(start, end).map((d) => [d, v]));

describe("forecastMonth", () => {
  it("uses the provider forecast when given", () => {
    expect(forecastMonth({}, "2026-11", new Date("2026-11-10T00:00:00Z"), 123.456)).toEqual({ value: 123.46, method: "provider" });
  });

  it("month to date + 7 day average x days left", () => {
    // Nov 1..9 complete at $2/day, today (10th) partial is ignored; 21 days left.
    const daily = { ...flat("2026-11-01", "2026-11-09", 2), "2026-11-10": 50 };
    expect(forecastMonth(daily, "2026-11", new Date("2026-11-10T08:00:00Z"))).toEqual({ value: 18 + 2 * 21, method: "run_rate_7d" });
  });

  it("averages only the last 7 complete days", () => {
    const daily = { ...flat("2026-11-01", "2026-11-03", 100), ...flat("2026-11-04", "2026-11-10", 1) };
    expect(forecastMonth(daily, "2026-11", new Date("2026-11-11T01:00:00Z")).value).toBe(307 + 20);
  });

  it("uses last month's days at the start of a month", () => {
    const daily = flat("2026-10-25", "2026-11-01", 3);
    // Horizon Nov 1: done = 3, avg of Oct 26..Nov 1 = 3, 29 days left.
    expect(forecastMonth(daily, "2026-11", new Date("2026-11-02T00:10:00Z")).value).toBe(3 + 3 * 29);
    // On the 1st nothing is complete yet: the whole month from the average.
    expect(forecastMonth(daily, "2026-11", new Date("2026-11-01T12:00:00Z")).value).toBe(3 * 30);
  });

  it("averages fewer than 7 days for a new source", () => {
    expect(forecastMonth({ "2026-11-01": 4, "2026-11-02": 6 }, "2026-11", new Date("2026-11-03T00:00:00Z")).value).toBe(10 + 5 * 28);
  });

  it("handles lagging sources (horizon = last day with data)", () => {
    const daily = flat("2026-11-01", "2026-11-08", 1); // data stops on the 8th, today the 10th
    expect(forecastMonth(daily, "2026-11", new Date("2026-11-10T00:00:00Z")).value).toBe(8 + 22);
  });

  it("counts gaps between known days as zero", () => {
    const daily = { "2026-11-01": 7, "2026-11-07": 7 };
    expect(forecastMonth(daily, "2026-11", new Date("2026-11-08T00:00:00Z")).value).toBe(14 + 2 * 23);
  });

  it("knows February in leap and common years", () => {
    expect(forecastMonth(flat("2028-02-01", "2028-02-10", 1), "2028-02", new Date("2028-02-11T00:00:00Z")).value).toBe(29);
    expect(forecastMonth(flat("2027-02-01", "2027-02-10", 1), "2027-02", new Date("2027-02-11T00:00:00Z")).value).toBe(28);
  });

  it("returns the actual total for a past month and 0 with no data", () => {
    expect(forecastMonth(flat("2026-10-01", "2026-10-31", 1), "2026-10", new Date("2026-11-15T00:00:00Z")).value).toBe(31);
    expect(forecastMonth({}, "2026-11", new Date("2026-11-15T00:00:00Z"))).toEqual({ value: 0, method: "run_rate_7d" });
  });

  it("accepts an array of points", () => {
    expect(forecastMonth([{ date: "2026-12-30", value: 1 }, { date: "2026-12-30", value: 1 }], "2026-12", new Date("2026-12-31T05:00:00Z")).value).toBe(4);
  });
});
