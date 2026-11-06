import { describe, expect, it } from "vitest";
import { github } from "../../src/providers/github";
import { ctx, fixture, json, mockFetch } from "./helpers";

/** Answer like GitHub: only the items of the requested month. */
function byMonth(url: string) {
  const u = new URL(url);
  const month = `${u.searchParams.get("year")}-${u.searchParams.get("month")!.padStart(2, "0")}`;
  const all = JSON.parse(fixture("github/usage.json")).usageItems;
  return json({ usageItems: all.filter((i: any) => i.date.startsWith(month)) });
}

describe("github", () => {
  it("uses the user endpoint by default and the org endpoint for orgs", async () => {
    const m = mockFetch([["/settings/billing/usage", byMonth]]);
    await github.sync({ token: "github_pat_x", owner: "octo" }, ctx(m.fetch));
    expect(m.calls.map((c) => c.url)).toEqual([
      "https://api.github.com/users/octo/settings/billing/usage?year=2026&month=10",
      "https://api.github.com/users/octo/settings/billing/usage?year=2026&month=11",
    ]);
    const o = mockFetch([["/settings/billing/usage", byMonth]]);
    await github.sync({ token: "t", owner: "acme", owner_type: "org" }, ctx(o.fetch));
    expect(o.calls[0].url).toContain("/organizations/acme/");
  });

  it("sums net amounts per day and keeps the window", async () => {
    const m = mockFetch([["/settings/billing/usage", byMonth]]);
    const { snapshots } = await github.sync({ token: "t", owner: "octo" }, ctx(m.fetch));
    const total = (d: string) => snapshots.filter((s) => s.metric === "cost" && s.label == null && s.period_start === d);
    expect(total("2026-11-04")[0].value).toBeCloseTo(3.5);
    expect(total("2026-11-03")[0].value).toBe(0);
    expect(total("2026-11-01")[0].value).toBe(0); // zero-filled
    expect(total("2026-10-20")).toHaveLength(0); // outside the window
    expect(snapshots.find((s) => s.metric === "usage" && s.label === "actions minutes" && s.period_start === "2026-11-04")?.value).toBe(50);
    expect(snapshots.find((s) => s.metric === "cost" && s.label === "copilot")?.value).toBe(0.4);
  });
});
