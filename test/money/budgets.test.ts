import { describe, expect, it } from "vitest";
import { evaluateBudgets, type Budget, type ExistingAlert } from "../../src/money/budgets";

const budget: Budget = { id: "b1", provider: "aws", monthly_limit: 100, currency: "USD", thresholds: [0.5, 0.8, 1.0] };
const mtd = (aws: number, total = aws) => ({ total, byProvider: { aws }, currency: "USD" });
const NOW = new Date("2026-11-06T06:00:00Z");

describe("evaluateBudgets", () => {
  it("creates nothing below the first threshold", () => {
    expect(evaluateBudgets({ budgets: [budget], monthToDate: mtd(49.99), existingAlerts: [], month: "2026-11", now: NOW })).toEqual([]);
  });

  it("alerts once per threshold per month, never twice", () => {
    const existing: ExistingAlert[] = [];
    const run = (v: number, month = "2026-11") => {
      const out = evaluateBudgets({ budgets: [budget], monthToDate: mtd(v), existingAlerts: existing, month, now: NOW });
      existing.push(...out);
      return out;
    };
    expect(run(55).map((a) => a.threshold)).toEqual([0.5]);
    expect(run(60)).toEqual([]);
    expect(run(85).map((a) => a.threshold)).toEqual([0.8]);
    expect(run(85)).toEqual([]);
    const over = run(120);
    expect(over.map((a) => a.threshold)).toEqual([1]);
    expect(over[0].entry).toMatchObject({ importance: "critical", project: "Money", source: "system", external_key: "budget:b1:2026-11:1" });
    expect(run(130)).toEqual([]);
    expect(run(55, "2026-12").map((a) => a.threshold)).toEqual([0.5]); // new month starts over
  });

  it("a jump past several thresholds records each but makes one entry", () => {
    const out = evaluateBudgets({ budgets: [budget], monthToDate: mtd(101), existingAlerts: [], month: "2026-11", now: NOW });
    expect(out.map((a) => [a.threshold, a.entry ? a.entry.importance : null])).toEqual([[0.5, null], [0.8, null], [1, "critical"]]);
    expect(out[2].entry!.title).toBe("AWS is over budget for 2026-11");
    expect(out[2].entry!.notes).toContain("USD 101.00 of USD 100.00");
  });

  it("uses importance important below 100% and handles all-costs budgets", () => {
    const all: Budget = { ...budget, id: "b2", provider: null };
    const out = evaluateBudgets({ budgets: [all], monthToDate: mtd(10, 85), existingAlerts: [], month: "2026-11", now: NOW });
    expect(out.at(-1)!.entry).toMatchObject({ importance: "important", title: "All costs reached 80% of budget for 2026-11" });
  });

  it("skips budgets in another currency", () => {
    expect(evaluateBudgets({ budgets: [{ ...budget, currency: "EUR" }], monthToDate: mtd(500), existingAlerts: [], month: "2026-11", now: NOW })).toEqual([]);
  });
});
