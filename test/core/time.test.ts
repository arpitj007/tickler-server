import { describe, expect, it } from "vitest";
import { mergeEntry, DEFAULTS } from "../../src/core/entries";
import { localToUtc, nextLocalMidnight, parseTimeInput, rruleError } from "../../src/core/time";

const now = new Date("2026-11-06T10:00:00Z");
const merge = (patch: Parameters<typeof mergeEntry>[1]) => mergeEntry({ ...DEFAULTS, title: "x" }, patch, now);

describe("time input and DST", () => {
  it("absolute times and offsets", () => {
    expect(parseTimeInput("2026-03-29T09:00:00+02:00", "UTC")!.at.toISOString()).toBe("2026-03-29T07:00:00.000Z");
    expect(parseTimeInput("2026-03-29T09:00:00Z", "Europe/Berlin")!.at.toISOString()).toBe("2026-03-29T09:00:00.000Z");
    expect(parseTimeInput("tomorrow", "UTC")).toBeNull();
    expect(parseTimeInput("2026-02-30", "UTC")).toBeNull();
  });

  it("wall time either side of the Berlin spring-forward (2026-03-29)", () => {
    expect(localToUtc(2026, 3, 29, 1, 30, 0, "Europe/Berlin").toISOString()).toBe("2026-03-29T00:30:00.000Z"); // CET
    expect(localToUtc(2026, 3, 29, 3, 30, 0, "Europe/Berlin").toISOString()).toBe("2026-03-29T01:30:00.000Z"); // CEST
    // 02:30 doesn't exist: moves forward to 03:30 CEST
    expect(localToUtc(2026, 3, 29, 2, 30, 0, "Europe/Berlin").toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("ambiguous fall-back hour takes the first occurrence (2026-10-25 Berlin, 2026-11-01 New York)", () => {
    expect(localToUtc(2026, 10, 25, 2, 30, 0, "Europe/Berlin").toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(localToUtc(2026, 11, 1, 1, 30, 0, "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("all-day entries on DST days span 23 and 25 hours", () => {
    const spring = merge({ start_at: "2026-03-29", end_at: "2026-03-29", timezone: "Europe/Berlin", kind: "event" });
    expect(spring.all_day).toBe(true);
    expect(spring.start_at).toBe("2026-03-28T23:00:00.000Z");
    expect(spring.end_at).toBe("2026-03-29T22:00:00.000Z");
    expect(Date.parse(spring.end_at!) - Date.parse(spring.start_at!)).toBe(23 * 3600_000);
    const fall = nextLocalMidnight({ y: 2026, m: 10, d: 25 }, "Europe/Berlin").getTime() - localToUtc(2026, 10, 25, 0, 0, 0, "Europe/Berlin").getTime();
    expect(fall).toBe(25 * 3600_000);
  });

  it("rejects over two years out, end before start, undated non-tasks, bad zone and rrule", () => {
    expect(() => merge({ start_at: "2028-12-01T00:00:00Z", kind: "event" })).toThrow(/2 years/);
    expect(() => merge({ start_at: "2027-12-01T00:00:00Z", kind: "event" })).not.toThrow();
    expect(() => merge({ start_at: "2026-12-01T10:00:00Z", end_at: "2026-12-01T09:00:00Z", kind: "event" })).toThrow(/before/);
    expect(() => merge({ kind: "launch" })).toThrow(/only tasks/);
    expect(() => merge({ kind: "task" })).not.toThrow();
    expect(() => merge({ start_at: "2026-12-01T10:00", timezone: "Nowhere/Here", kind: "event" })).toThrow(/time zone/);
    expect(() => merge({ start_at: "2026-12-01T10:00:00Z", recurrence: "FREQ=SOMETIMES", kind: "event" })).toThrow();
    expect(rruleError("FREQ=WEEKLY;BYDAY=MO,WE")).toBeNull();
    expect(rruleError("DTSTART=20260101;FREQ=DAILY")).toMatch(/DTSTART/);
  });
});
