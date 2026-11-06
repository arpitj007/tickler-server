import { describe, expect, it } from "vitest";
import { openai } from "../../src/providers/openai";
import { ctx, fixture, headerOf, json, mockFetch } from "./helpers";

const cfg = { admin_key: "sk-admin-test" };

describe("openai", () => {
  it("syncs daily cost by line item and tokens by model", async () => {
    const m = mockFetch([
      ["/costs", () => json(fixture("openai/costs.json"))],
      ["/usage/completions", () => json(fixture("openai/usage.json"))],
    ]);
    const { snapshots } = await openai.sync(cfg, ctx(m.fetch));
    expect(snapshots.find((s) => s.metric === "cost" && s.label == null && s.period_start === "2026-11-05")?.value).toBe(5);
    expect(snapshots.find((s) => s.metric === "cost" && s.label == null && s.period_start === "2026-11-06")?.value).toBe(0);
    expect(snapshots.find((s) => s.label === "gpt-5, input")?.value).toBe(3.25);
    expect(snapshots.find((s) => s.metric === "usage" && s.label === "gpt-5")?.value).toBe(15000);
    expect(m.calls[0].url).toContain(`start_time=${Date.UTC(2026, 9, 29) / 1000}`);
    expect(headerOf(m.calls[0].init, "authorization")).toBe("Bearer sk-admin-test");
  });

  it("test fails clearly on a non-admin key", async () => {
    const r = await openai.test(cfg, ctx(mockFetch([["/costs", () => json({ error: { message: "Admin key required" } }, 403)]]).fetch));
    expect(r).toEqual({ ok: false, message: "OpenAI: HTTP 403 Admin key required" });
  });
});
