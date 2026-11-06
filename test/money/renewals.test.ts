import { describe, expect, it } from "vitest";
import { addMonths, dueRenewalReminders, nextRenewal, renewalsBetween, type FixedCost } from "../../src/money/renewals";

const apple: FixedCost = { id: "fc1", name: "Apple Developer Program", amount: 99, currency: "USD", interval: "yearly", renews_on: "2026-11-15" };
const domain: FixedCost = { id: "fc2", name: "Domain", amount: 12, currency: "USD", interval: "monthly", renews_on: "2026-01-31" };

describe("renewals", () => {
  it("rolls past renewal dates forward and clamps month ends", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(nextRenewal(domain, "2026-11-06")).toBe("2026-11-30");
    expect(nextRenewal({ ...apple, renews_on: "2024-02-29" }, "2026-11-06")).toBe("2027-02-28");
    expect(renewalsBetween(domain, "2026-02-01", "2026-04-30")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("creates a reminder within 14 days, with a stable key", () => {
    const now = new Date("2026-11-06T06:00:00Z");
    const a = dueRenewalReminders({ fixedCosts: [apple, domain], now });
    expect(a.map((e) => e.external_key)).toEqual(["renewal:fc1:2026-11-15"]);
    expect(a[0]).toMatchObject({ kind: "renewal", importance: "important", start_at: "2026-11-15T00:00:00.000Z", all_day: true, project: "Money" });
    expect(dueRenewalReminders({ fixedCosts: [apple, domain], now: new Date("2026-11-07T06:00:00Z") })[0].external_key).toBe(a[0].external_key);
    expect(dueRenewalReminders({ fixedCosts: [apple], now: new Date("2026-10-31T06:00:00Z") })).toEqual([]);
    expect(dueRenewalReminders({ fixedCosts: [apple], now: new Date("2026-11-01T06:00:00Z") })).toHaveLength(1);
  });
});
