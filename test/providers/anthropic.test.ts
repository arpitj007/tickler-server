import { describe, expect, it } from "vitest";
import { anthropic } from "../../src/providers/anthropic";
import { ctx, fixture, headerOf, json, mockFetch } from "./helpers";

const cfg = { admin_key: "sk-ant-admin01-test" };

describe("anthropic", () => {
  it("is configured only with an admin key", () => {
    expect(anthropic.configured(cfg)).toBe(true);
    expect(anthropic.configured({ admin_key: "sk-ant-api03-x" })).toBe(false);
  });

  it("syncs cost (cents to USD) by model and tokens by model", async () => {
    const m = mockFetch([
      ["cost_report", () => json(fixture("anthropic/cost_report.json"))],
      ["usage_report", () => json(fixture("anthropic/usage_report.json"))],
    ]);
    const { snapshots } = await anthropic.sync(cfg, ctx(m.fetch));
    const total = snapshots.find((s) => s.metric === "cost" && s.label == null && s.period_start === "2026-11-04");
    expect(total?.value).toBeCloseTo(15.5); // (1234.5 + 300 + 15.5) cents
    expect(snapshots.find((s) => s.metric === "cost" && s.label === "claude-opus-5-5")?.value).toBeCloseTo(12.345);
    expect(snapshots.find((s) => s.metric === "cost" && s.label == null && s.period_start === "2026-11-05")?.value).toBe(0);
    expect(snapshots.find((s) => s.metric === "usage" && s.label === "claude-opus-5-5")?.value).toBe(4700);
    expect(snapshots.find((s) => s.metric === "usage" && s.label == null)?.value).toBe(4850);
    expect(m.calls[0].url).toContain("starting_at=2026-10-29T00:00:00Z");
    expect(headerOf(m.calls[0].init, "x-api-key")).toBe("sk-ant-admin01-test");
  });

  it("is idempotent", async () => {
    const m = mockFetch([
      ["cost_report", () => json(fixture("anthropic/cost_report.json"))],
      ["usage_report", () => json(fixture("anthropic/usage_report.json"))],
    ]);
    const a = await anthropic.sync(cfg, ctx(m.fetch));
    const b = await anthropic.sync(cfg, ctx(m.fetch));
    expect(b).toEqual(a);
  });

  it("test reports the organization or the error", async () => {
    const ok = await anthropic.test(cfg, ctx(mockFetch([["/organizations/me", () => json(fixture("anthropic/me.json"))]]).fetch));
    expect(ok).toEqual({ ok: true, message: 'Connected to organization "Example Org".' });
    const bad = await anthropic.test(cfg, ctx(mockFetch([["/organizations/me", () => json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401)]]).fetch));
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("401");
    expect(bad.message).toContain("invalid x-api-key");
  });
});
