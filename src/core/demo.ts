// Load the resolved demo document (seed/demo-changes.json after resolveDemo) into storage.
// Used by `npm run seed -- load` and the review demo server. Rows keep their ids; revs are new.
import type { Storage, Stmt } from "../storage/types";
import { BUMP, REV } from "./context";

type Row = Record<string, unknown>;
type Doc = Record<string, Row[] | unknown>;

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
const bool = (v: unknown) => (v ? 1 : 0);
const val = (v: unknown) => (v === undefined ? null : (v as string | number | null));

function insert(table: string, row: Row): Stmt {
  const cols = Object.keys(row);
  return {
    sql: `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}, rev) VALUES (${cols.map(() => "?").join(", ")}, ${REV})`,
    params: cols.map((c) => val(row[c])),
  };
}

export async function loadDemo(storage: Storage, doc: Doc) {
  const list = (k: string) => (Array.isArray(doc[k]) ? (doc[k] as Row[]) : []);
  const stmts: Stmt[] = [];
  const add = (table: string, row: Row) => stmts.push(BUMP, insert(table, row));

  for (const p of list("projects")) {
    const { rev: _r, ...r } = p;
    add("projects", { ...r, archived: bool(r.archived) });
  }
  for (const o of list("origins")) {
    const { rev: _r, ...r } = o;
    const key = r.session_id ? `${r.client}:s:${r.session_id}` : `${r.client}:demo:${r.id}`;
    add("origins", { ...r, origin_key: key });
  }
  for (const e of list("entries")) {
    const { rev: _r, ...r } = e;
    add("entries", { ...r, all_day: bool(r.all_day), origin_flagged: bool(r.origin_flagged), links: json(r.links ?? []), tags: json(r.tags ?? []) });
  }
  for (const b of list("budgets")) {
    const { rev: _r, ...r } = b;
    add("budgets", { ...r, thresholds: json(r.thresholds) });
  }
  for (const a of list("alerts")) {
    const { rev: _r, ...r } = a;
    add("alerts", r);
  }
  for (const s of list("metric_snapshots")) {
    const { rev: _r, ...r } = s;
    add("metric_snapshots", { ...r, label: r.label ?? "" });
  }
  for (const s of list("sales_events")) {
    const { rev: _r, ...r } = s;
    add("sales_events", { ...r, external_id: `demo:${r.id}`, created_at: r.occurred_at });
  }
  for (const f of list("fixed_costs")) {
    const { rev: _r, ...r } = f;
    add("fixed_costs", r);
  }
  for (let i = 0; i < stmts.length; i += 200) await storage.batch(stmts.slice(i, i + 200));
  return Object.fromEntries(
    ["projects", "origins", "entries", "budgets", "alerts", "metric_snapshots", "sales_events", "fixed_costs"].map((k) => [k, list(k).length]),
  );
}
