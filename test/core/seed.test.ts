import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateDemo, resolveDemo, resolvePlaceholder } from "../../scripts/seed-data";
import { loadDemo } from "../../src/core/demo";
import { makeApp, setupAll } from "./helpers";

describe("demo seed", () => {
  it("the committed file matches the generator", () => {
    const file = JSON.parse(readFileSync(join(__dirname, "../../seed/demo-changes.json"), "utf8"));
    expect(file).toEqual(JSON.parse(JSON.stringify(generateDemo())));
  });

  it("resolves placeholders", () => {
    const now = new Date("2026-11-06T10:17:42Z");
    expect(resolvePlaceholder("__NOW__+P2DT3H", now)!.toISOString()).toBe("2026-11-08T13:17:00.000Z");
    expect(resolvePlaceholder("__NOW__-PT30M", now)!.toISOString()).toBe("2026-11-06T09:47:00.000Z");
    expect(resolvePlaceholder("__TODAY__+P1D", now)!.toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(resolvePlaceholder("__MONTH_END__", now)!.toISOString()).toBe("2026-11-30T00:00:00.000Z");
    const doc = resolveDemo({ alerts: [{ month: "__NOW__" }], fixed_costs: [{ renews_on: "__TODAY__+P10D" }] }, now);
    expect(doc).toEqual({ alerts: [{ month: "2026-11" }], fixed_costs: [{ renews_on: "2026-11-16" }] });
  });

  it("loads into a server and syncs out through /api/changes", async () => {
    const t = makeApp();
    const s = await setupAll(t);
    const doc = resolveDemo(generateDemo(), new Date(t.clock.t));
    const counts = await loadDemo(t.storage, doc);
    expect(counts.entries).toBeGreaterThanOrEqual(120);
    const ch = await (await t.req("/api/changes?since=0&limit=1000", { token: s.device })).json();
    expect(ch.projects).toHaveLength(6);
    const kinds = new Set(ch.entries.map((e: { kind: string }) => e.kind));
    expect(kinds.size).toBe(8);
    const clients = new Set(ch.origins.map((o: { client: string }) => o.client));
    expect(clients.size).toBe(10);
    const sum = await (await t.req("/api/money/summary", { token: s.device })).json();
    expect(sum.costs.value).toBeGreaterThan(0);
    expect(sum.revenue.value).toBeGreaterThan(0);
  });
});
