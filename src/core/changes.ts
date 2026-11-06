import type { Ctx } from "./context";
import { entryJson, type EntryRow } from "./entries";
import { ORIGIN_COLS } from "./origins";
import { projectJson, type ProjectRow } from "./projects";
import { budgetJson, snapshotJson, salesEventJson, type BudgetRow, type SnapshotRow, type SalesEventRow } from "./moneyStore";

type Tagged = { t: string; rev: number; row: Record<string, unknown> };

const TABLES: Array<{ key: string; sql: (since: number) => string; params?: (ctx: Ctx) => (string | number)[]; map: (r: any) => unknown }> = [
  { key: "projects", sql: () => "SELECT * FROM projects WHERE rev > ? ORDER BY rev LIMIT ?", map: (r: ProjectRow) => projectJson(r) },
  { key: "entries", sql: () => "SELECT * FROM entries WHERE rev > ? ORDER BY rev LIMIT ?", map: (r: EntryRow) => entryJson(r) },
  { key: "origins", sql: () => `SELECT ${ORIGIN_COLS} FROM origins WHERE rev > ? ORDER BY rev LIMIT ?`, map: (r) => r },
  { key: "budgets", sql: () => "SELECT * FROM budgets WHERE rev > ? ORDER BY rev LIMIT ?", map: (r: BudgetRow) => budgetJson(r) },
  { key: "alerts", sql: () => "SELECT * FROM alerts WHERE rev > ? ORDER BY rev LIMIT ?", map: (r) => r },
  {
    key: "metric_snapshots",
    // Full snapshots and incremental pulls alike skip data older than 400 days.
    sql: () => "SELECT * FROM metric_snapshots WHERE rev > ? AND period_end >= ? ORDER BY rev LIMIT ?",
    params: (ctx) => [new Date(ctx.now().getTime() - 400 * 86400_000).toISOString().slice(0, 10)],
    map: (r: SnapshotRow) => snapshotJson(r),
  },
  { key: "sales_events", sql: () => "SELECT * FROM sales_events WHERE rev > ? ORDER BY rev LIMIT ?", map: (r: SalesEventRow) => salesEventJson(r) },
  { key: "fixed_costs", sql: () => "SELECT * FROM fixed_costs WHERE rev > ? ORDER BY rev LIMIT ?", map: ({ reminded_for: _r, ...r }) => r },
  { key: "deleted", sql: () => "SELECT rev, type, id FROM tombstones WHERE rev > ? ORDER BY rev LIMIT ?", map: (r) => ({ type: r.type, id: r.id }) },
];

/**
 * Everything with rev > since, at most `limit` rows across all tables, in global rev order.
 * Each table is read up to `limit` rows; merging and cutting at `limit` keeps the cursor exact.
 */
export async function getChanges(ctx: Ctx, since: number, limit: number) {
  const all: Tagged[] = [];
  for (const t of TABLES) {
    const extra = t.params?.(ctx) ?? [];
    const rows = await ctx.storage.all<Record<string, unknown>>(t.sql(since), [since, ...extra, limit + 1]);
    for (const row of rows) all.push({ t: t.key, rev: Number(row.rev), row });
  }
  all.sort((a, b) => a.rev - b.rev);
  const page = all.slice(0, limit);
  const out: Record<string, unknown> = {
    cursor: String(page.length ? page[page.length - 1]!.rev : since),
    has_more: all.length > limit,
  };
  for (const t of TABLES) out[t.key] = [];
  for (const p of page) (out[p.t] as unknown[]).push(TABLES.find((t) => t.key === p.t)!.map(p.row));
  return out;
}
