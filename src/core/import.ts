// POST /api/import: merge an /api/export document into this server, so people can move between
// Tickler Cloud and a self-hosted server in either direction. Rows keep their ids and rows whose id
// already exists are skipped. A project or origin that exists here under another id (same slug,
// same client session) is merged into the existing one, and references are pointed at it.
import { z } from "zod";
import { logActivity } from "./activity";
import { BUMP, REV, type Actor, type Ctx } from "./context";
import type { Stmt } from "../storage/types";

const rows = z.array(z.record(z.string(), z.unknown())).default([]);
export const importSchema = z.object({
  projects: rows,
  origins: rows,
  entries: rows,
  budgets: rows,
  alerts: rows,
  metric_snapshots: rows,
  sales_events: rows,
  fixed_costs: rows,
});
export type ImportDoc = z.infer<typeof importSchema>;

type R = Record<string, unknown>;
const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
const bool = (v: unknown) => (v ? 1 : 0);
const json = (v: unknown, fallback: string) => (v === undefined || v === null ? fallback : typeof v === "string" ? v : JSON.stringify(v));

const COLS: Record<keyof ImportDoc, Array<[string, (r: R) => unknown]>> = {
  projects: [
    ["name", (r) => str(r.name) ?? "Imported"], ["slug", (r) => str(r.slug)], ["color", (r) => str(r.color) ?? "#5B5BD6"],
    ["icon", (r) => str(r.icon) ?? "folder"], ["archived", (r) => bool(r.archived)],
  ],
  origins: [
    ["origin_key", () => null], ["client", (r) => str(r.client) ?? "other"], ["session_id", (r) => str(r.session_id)],
    ["title", (r) => str(r.title)], ["open_url", (r) => str(r.open_url)], ["resume_command", (r) => str(r.resume_command)],
    ["machine", (r) => str(r.machine)], ["cwd", (r) => str(r.cwd)], ["repo", (r) => str(r.repo)], ["branch", (r) => str(r.branch)],
    ["transcript_path", (r) => str(r.transcript_path)], ["parent_origin_id", (r) => str(r.parent_origin_id)],
    ["first_seen_at", (r) => str(r.first_seen_at)], ["last_seen_at", (r) => str(r.last_seen_at)],
  ],
  entries: [
    ["project_id", (r) => str(r.project_id)], ["title", (r) => str(r.title) ?? "Untitled"], ["notes", (r) => str(r.notes)],
    ["kind", (r) => str(r.kind) ?? "task"], ["start_at", (r) => str(r.start_at)], ["end_at", (r) => str(r.end_at)],
    ["all_day", (r) => bool(r.all_day)], ["timezone", (r) => str(r.timezone) ?? "UTC"], ["recurrence", (r) => str(r.recurrence)],
    ["status", (r) => str(r.status) ?? "planned"], ["importance", (r) => str(r.importance) ?? "normal"],
    ["source", (r) => str(r.source) ?? "manual"], ["origin_id", (r) => str(r.origin_id)], ["last_origin_id", (r) => str(r.last_origin_id)],
    ["origin_flagged", (r) => bool(r.origin_flagged)], ["external_key", (r) => str(r.external_key)], ["links", (r) => json(r.links, "[]")],
    ["tags", (r) => json(r.tags, "[]")], ["source_ref", (r) => str(r.source_ref)], ["completed_at", (r) => str(r.completed_at)],
    ["deleted_at", (r) => str(r.deleted_at)],
  ],
  budgets: [
    ["provider", (r) => str(r.provider)], ["project_id", (r) => str(r.project_id)], ["monthly_limit", (r) => num(r.monthly_limit) ?? 0],
    ["currency", (r) => str(r.currency) ?? "USD"], ["thresholds", (r) => json(r.thresholds, "[0.5,0.8,1]")],
  ],
  alerts: [
    ["budget_id", (r) => str(r.budget_id)], ["month", (r) => str(r.month)], ["threshold", (r) => num(r.threshold)],
    ["entry_id", (r) => str(r.entry_id)], ["value", (r) => num(r.value)],
  ],
  metric_snapshots: [
    ["provider", (r) => str(r.provider)], ["account", (r) => str(r.account) ?? "default"], ["metric", (r) => str(r.metric)],
    ["unit", (r) => str(r.unit)], ["value", (r) => num(r.value) ?? 0], ["label", (r) => str(r.label) ?? ""],
    ["period_start", (r) => str(r.period_start)], ["period_end", (r) => str(r.period_end)], ["fetched_at", (r) => str(r.fetched_at)],
    ["source_latency", (r) => str(r.source_latency)],
  ],
  sales_events: [
    ["store", (r) => str(r.store)], ["external_id", (r) => `import:${r.id}`], ["type", (r) => str(r.type)],
    ["product_id", (r) => str(r.product_id)], ["price", (r) => num(r.price)], ["currency", (r) => str(r.currency)],
    ["country", (r) => str(r.country)], ["occurred_at", (r) => str(r.occurred_at)],
  ],
  fixed_costs: [
    ["name", (r) => str(r.name) ?? "Imported"], ["amount", (r) => num(r.amount) ?? 0], ["currency", (r) => str(r.currency) ?? "USD"],
    ["interval", (r) => str(r.interval) ?? "monthly"], ["renews_on", (r) => str(r.renews_on)], ["project_id", (r) => str(r.project_id)],
  ],
};
/** Tables that also store created_at / updated_at. */
const STAMPS: Record<keyof ImportDoc, string[]> = {
  projects: ["created_at", "updated_at"], origins: [], entries: ["created_at", "updated_at"], budgets: ["created_at", "updated_at"],
  alerts: ["created_at"], metric_snapshots: [], sales_events: ["created_at"], fixed_costs: ["created_at", "updated_at"],
};
const ORDER: Array<keyof ImportDoc> = ["projects", "origins", "entries", "budgets", "alerts", "metric_snapshots", "sales_events", "fixed_costs"];

export async function importAll(ctx: Ctx, doc: ImportDoc, actor: Actor) {
  const now = ctx.now().toISOString();
  const projectMap = new Map<string, string>();
  const originMap = new Map<string, string>();
  const imported: Record<string, number> = {};

  for (const p of doc.projects) {
    const id = String(p.id ?? "");
    if (!id || (await ctx.storage.first("SELECT 1 FROM projects WHERE id = ?", [id]))) continue;
    const same = await ctx.storage.first<{ id: string }>("SELECT id FROM projects WHERE slug = ?", [str(p.slug)]);
    if (same) projectMap.set(id, same.id);
  }
  const originKey = (o: R) => (o.session_id ? `${str(o.client) ?? "other"}:s:${o.session_id}` : `${str(o.client) ?? "other"}:import:${o.id}`);
  for (const o of doc.origins) {
    const id = String(o.id ?? "");
    if (!id || (await ctx.storage.first("SELECT 1 FROM origins WHERE id = ?", [id]))) continue;
    const same = await ctx.storage.first<{ id: string }>("SELECT id FROM origins WHERE origin_key = ?", [originKey(o)]);
    if (same) originMap.set(id, same.id);
  }
  const remap = (m: Map<string, string>, v: unknown) => (typeof v === "string" ? m.get(v) ?? v : v);

  for (const table of ORDER) {
    const stmts: Stmt[] = [];
    for (const raw of doc[table]) {
      const r: R = { ...raw };
      if (!r.id || (table === "projects" && projectMap.has(String(r.id))) || (table === "origins" && originMap.has(String(r.id)))) continue;
      for (const k of ["project_id"]) if (k in r) r[k] = remap(projectMap, r[k]);
      for (const k of ["origin_id", "last_origin_id", "parent_origin_id"]) if (k in r) r[k] = remap(originMap, r[k]);
      if (table === "entries" && !(await ctx.storage.first("SELECT 1 FROM projects WHERE id = ?", [str(r.project_id)])) &&
          !doc.projects.some((p) => p.id === r.project_id)) continue; // dangling: its project wasn't exported
      const cols = COLS[table].map(([c]) => c);
      const vals = COLS[table].map(([c, f]) => (table === "origins" && c === "origin_key" ? originKey(r) : f(r)));
      for (const s of STAMPS[table]) {
        cols.push(s);
        vals.push(str(r[s]) ?? now);
      }
      stmts.push({
        sql: `INSERT OR IGNORE INTO ${table} (id, ${cols.join(", ")}, rev) VALUES (?, ${cols.map(() => "?").join(", ")}, ${REV})`,
        params: [String(r.id), ...(vals as (string | number | null)[])],
      });
    }
    let n = 0;
    // One rev for the whole import is enough: every imported row is newer than any cursor a phone holds.
    for (let i = 0; i < stmts.length; i += 50) {
      const chunk = stmts.slice(i, i + 50);
      const before = await ctx.storage.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
      await ctx.storage.batch([BUMP, ...chunk]);
      const after = await ctx.storage.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
      n += (after?.n ?? 0) - (before?.n ?? 0);
    }
    imported[table] = n;
  }
  const total = Object.values(imported).reduce((a, b) => a + b, 0);
  await logActivity(ctx, actor, "POST /api/import", `Imported ${total} rows (${ORDER.map((t) => `${imported[t]} ${t}`).join(", ")})`);
  return { imported };
}
