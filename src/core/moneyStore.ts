// Storage for money data: provider configs (encrypted), metric snapshots, sales events,
// budgets, alerts and fixed costs. Upserts are idempotent on the keys in src/providers/types.ts.
import { z } from "zod";
import type { MetricSnapshotInput, ProviderConfig, ProviderId, SalesEventInput } from "../providers/types";
import { logActivity } from "./activity";
import { BUMP, REV, type Actor, type Ctx } from "./context";
import { decryptJson, encryptJson } from "./crypto";
import { ApiError, jsonParse, uuid } from "./util";
import type { Stmt } from "../storage/types";

export const PROVIDER_IDS = [
  "app_store", "google_play", "amazon_appstore", "stripe", "cloudflare", "google_cloud", "aws", "anthropic", "openai", "github", "manual",
] as const satisfies readonly ProviderId[];
export const METRICS = ["revenue", "proceeds", "units", "cost", "usage", "forecast"] as const;

const RAW_MAX = 8_000;

// ---------- rows and JSON shapes

export interface SnapshotRow {
  id: string;
  provider: string;
  account: string;
  metric: string;
  unit: string;
  value: number;
  label: string;
  period_start: string;
  period_end: string;
  fetched_at: string;
  source_latency: string | null;
  raw: string | null;
  rev: number;
}
export function snapshotJson({ raw: _raw, ...r }: SnapshotRow) {
  return { ...r, label: r.label === "" ? null : r.label };
}

export interface SalesEventRow {
  id: string;
  store: string;
  external_id: string;
  type: string;
  product_id: string | null;
  price: number | null;
  currency: string | null;
  country: string | null;
  occurred_at: string;
  raw: string | null;
  created_at: string;
  rev: number;
}
export function salesEventJson({ raw: _raw, external_id: _e, created_at: _c, ...r }: SalesEventRow) {
  return r;
}

export interface BudgetRow {
  id: string;
  provider: string | null;
  project_id: string | null;
  monthly_limit: number;
  currency: string;
  thresholds: string;
  created_at: string;
  updated_at: string;
  rev: number;
}
export function budgetJson(r: BudgetRow) {
  return { ...r, thresholds: jsonParse<number[]>(r.thresholds, [0.5, 0.8, 1]) };
}
export type Budget = ReturnType<typeof budgetJson>;

export interface FixedCostRow {
  id: string;
  name: string;
  amount: number;
  currency: string;
  interval: "monthly" | "yearly";
  renews_on: string;
  project_id: string | null;
  reminded_for: string | null;
  created_at: string;
  updated_at: string;
  rev: number;
}
export function fixedCostJson({ reminded_for: _r, ...r }: FixedCostRow) {
  return r;
}

export interface AlertRow {
  id: string;
  budget_id: string;
  month: string;
  threshold: number;
  entry_id: string | null;
  value: number;
  created_at: string;
  rev: number;
}

function trimRaw(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = JSON.stringify(raw);
  return s.length > RAW_MAX ? JSON.stringify({ truncated: true, head: s.slice(0, RAW_MAX - 100) }) : s;
}

// ---------- snapshots and sales events

/** Upsert on (provider, account, metric, label, period_start, period_end); a re-sync replaces the value. */
export function snapshotStmts(ctx: Ctx, list: MetricSnapshotInput[]): Stmt[] {
  const now = ctx.now().toISOString();
  return list.flatMap((s) => [
    BUMP,
    {
      sql: `INSERT INTO metric_snapshots (id, provider, account, metric, unit, value, label, period_start, period_end, fetched_at, source_latency, raw, rev)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${REV})
            ON CONFLICT (provider, account, metric, label, period_start, period_end) DO UPDATE SET
              unit = excluded.unit, value = excluded.value, fetched_at = excluded.fetched_at,
              source_latency = excluded.source_latency, raw = excluded.raw, rev = excluded.rev`,
      params: [
        uuid(), s.provider, s.account || "default", s.metric, s.unit, s.value, s.label ?? "", s.period_start,
        s.period_end, now, s.source_latency ?? null, trimRaw(s.raw),
      ],
    },
  ]);
}

export async function upsertSnapshots(ctx: Ctx, list: MetricSnapshotInput[]) {
  // Chunk to keep D1 batches small.
  for (let i = 0; i < list.length; i += 50) await ctx.storage.batch(snapshotStmts(ctx, list.slice(i, i + 50)));
}

/** Insert, ignoring duplicates on (store, external_id) so webhook retries are harmless. Returns new rows count. */
export async function insertSalesEvents(ctx: Ctx, list: SalesEventInput[]): Promise<number> {
  let added = 0;
  for (const e of list) {
    const exists = await ctx.storage.first("SELECT 1 FROM sales_events WHERE store = ? AND external_id = ?", [e.store, e.external_id]);
    if (exists) continue;
    await ctx.storage.batch([
      BUMP,
      {
        sql: `INSERT INTO sales_events (id, store, external_id, type, product_id, price, currency, country, occurred_at, raw, created_at, rev)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${REV}) ON CONFLICT (store, external_id) DO NOTHING`,
        params: [
          uuid(), e.store, e.external_id, e.type, e.product_id, e.price, e.currency, e.country, e.occurred_at,
          trimRaw(e.raw), ctx.now().toISOString(),
        ],
      },
    ]);
    added++;
  }
  return added;
}

export const manualMetricSchema = z.object({
  provider: z.enum(PROVIDER_IDS).default("manual"),
  account: z.string().trim().max(200).optional(),
  metric: z.enum(METRICS),
  unit: z.string().trim().min(1).max(20),
  value: z.number().finite(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  label: z.string().trim().max(200).nullish(),
});

export async function getSnapshotByKey(ctx: Ctx, s: MetricSnapshotInput) {
  return ctx.storage.first<SnapshotRow>(
    "SELECT * FROM metric_snapshots WHERE provider = ? AND account = ? AND metric = ? AND label = ? AND period_start = ? AND period_end = ?",
    [s.provider, s.account || "default", s.metric, s.label ?? "", s.period_start, s.period_end],
  );
}

// ---------- provider configs

export interface ProviderConfigRow {
  provider: string;
  credentials_enc: string;
  enabled: number;
  last_sync_at: string | null;
  last_error: string | null;
  last_message: string | null;
  updated_at: string;
}

export async function getProviderConfigRow(ctx: Ctx, provider: string) {
  return ctx.storage.first<ProviderConfigRow>("SELECT * FROM provider_configs WHERE provider = ?", [provider]);
}

export async function readProviderConfig(ctx: Ctx, provider: string): Promise<ProviderConfig | null> {
  const row = await getProviderConfigRow(ctx, provider);
  if (!row) return null;
  if (!ctx.config.secret) throw new ApiError(500, "internal", "TICKLER_SECRET is not set");
  return decryptJson<ProviderConfig>(ctx.config.secret, row.credentials_enc);
}

export async function saveProviderConfig(ctx: Ctx, provider: string, credentials: ProviderConfig | null, enabled: boolean, actor: Actor) {
  if (!ctx.config.secret) throw new ApiError(500, "internal", "TICKLER_SECRET is not set");
  const existing = await readProviderConfig(ctx, provider).catch(() => null);
  // Empty fields keep the stored value, so forms never need to echo secrets back.
  const merged: ProviderConfig = { ...(existing ?? {}) };
  for (const [k, v] of Object.entries(credentials ?? {})) if (typeof v === "string" && v.trim() !== "") merged[k] = v.trim();
  const enc = await encryptJson(ctx.config.secret, merged);
  await ctx.storage.run(
    `INSERT INTO provider_configs (provider, credentials_enc, enabled, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (provider) DO UPDATE SET credentials_enc = excluded.credentials_enc, enabled = excluded.enabled, updated_at = excluded.updated_at`,
    [provider, enc, enabled ? 1 : 0, ctx.now().toISOString()],
  );
  await logActivity(ctx, actor, `PUT /api/money/providers/${provider}`, `Saved ${provider} credentials (${Object.keys(merged).length} fields)`);
}

export async function deleteProviderConfig(ctx: Ctx, provider: string, actor: Actor) {
  await ctx.storage.run("DELETE FROM provider_configs WHERE provider = ?", [provider]);
  await logActivity(ctx, actor, `DELETE /api/money/providers/${provider}`, `Removed ${provider} credentials`);
}

export async function setProviderSyncResult(ctx: Ctx, provider: string, error: string | null) {
  await ctx.storage.run(
    "UPDATE provider_configs SET last_sync_at = CASE WHEN ? IS NULL THEN ? ELSE last_sync_at END, last_error = ? WHERE provider = ?",
    [error, ctx.now().toISOString(), error, provider],
  );
}

// ---------- budgets

export const budgetSchema = z.object({
  provider: z.enum(PROVIDER_IDS).nullable().default(null),
  project_id: z.string().uuid().nullable().default(null),
  monthly_limit: z.number().positive().finite(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  thresholds: z.array(z.number().gt(0).max(10)).min(1).max(10).default([0.5, 0.8, 1.0]),
});

export async function listBudgets(ctx: Ctx) {
  return (await ctx.storage.all<BudgetRow>("SELECT * FROM budgets ORDER BY created_at")).map(budgetJson);
}
export async function getBudget(ctx: Ctx, id: string) {
  const r = await ctx.storage.first<BudgetRow>("SELECT * FROM budgets WHERE id = ?", [id]);
  return r ? budgetJson(r) : null;
}

export async function saveBudget(ctx: Ctx, id: string | null, input: Partial<z.infer<typeof budgetSchema>>, actor: Actor) {
  const now = ctx.now().toISOString();
  const cur = id ? await getBudget(ctx, id) : null;
  if (id && !cur) throw new ApiError(404, "not_found", "Budget not found");
  const b = {
    provider: input.provider !== undefined ? input.provider : (cur?.provider ?? null),
    project_id: input.project_id !== undefined ? input.project_id : (cur?.project_id ?? null),
    monthly_limit: input.monthly_limit ?? cur?.monthly_limit,
    currency: input.currency ?? cur?.currency ?? ctx.config.currency,
    thresholds: [...(input.thresholds ?? cur?.thresholds ?? [0.5, 0.8, 1])].sort((a, b) => a - b),
  };
  if (b.monthly_limit === undefined) throw new ApiError(422, "validation_failed", "monthly_limit is required", { fields: { monthly_limit: "Required." } });
  const newId = id ?? uuid();
  await ctx.storage.batch([
    BUMP,
    cur
      ? {
          sql: `UPDATE budgets SET provider = ?, project_id = ?, monthly_limit = ?, currency = ?, thresholds = ?, updated_at = ?, rev = ${REV} WHERE id = ?`,
          params: [b.provider, b.project_id, b.monthly_limit, b.currency, JSON.stringify(b.thresholds), now, newId],
        }
      : {
          sql: `INSERT INTO budgets (id, provider, project_id, monthly_limit, currency, thresholds, created_at, updated_at, rev)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${REV})`,
          params: [newId, b.provider, b.project_id, b.monthly_limit, b.currency, JSON.stringify(b.thresholds), now, now],
        },
  ]);
  await logActivity(ctx, actor, cur ? "PATCH /api/budgets" : "POST /api/budgets", `Budget ${b.provider ?? "all costs"}: ${b.monthly_limit} ${b.currency}`);
  return (await getBudget(ctx, newId))!;
}

export async function deleteRow(ctx: Ctx, table: "budgets" | "fixed_costs", type: "budget" | "fixed_cost", id: string, actor: Actor) {
  const exists = await ctx.storage.first(`SELECT 1 FROM ${table} WHERE id = ?`, [id]);
  if (!exists) throw new ApiError(404, "not_found", "Not found");
  await ctx.storage.batch([
    BUMP,
    { sql: `DELETE FROM ${table} WHERE id = ?`, params: [id] },
    { sql: `INSERT INTO tombstones (rev, type, id, deleted_at) VALUES (${REV}, ?, ?, ?)`, params: [type, id, ctx.now().toISOString()] },
  ]);
  await logActivity(ctx, actor, `DELETE /api/${table.replace("_", "-")}`, `Deleted ${type} ${id}`);
}

// ---------- fixed costs

export const fixedCostSchema = z.object({
  name: z.string().trim().min(1).max(120),
  amount: z.number().nonnegative().finite(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  interval: z.enum(["monthly", "yearly"]),
  renews_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  project_id: z.string().uuid().nullable().default(null),
});

export async function listFixedCosts(ctx: Ctx) {
  return ctx.storage.all<FixedCostRow>("SELECT * FROM fixed_costs ORDER BY renews_on");
}

export async function saveFixedCost(ctx: Ctx, id: string | null, input: Partial<z.infer<typeof fixedCostSchema>>, actor: Actor) {
  const now = ctx.now().toISOString();
  const cur = id ? await ctx.storage.first<FixedCostRow>("SELECT * FROM fixed_costs WHERE id = ?", [id]) : null;
  if (id && !cur) throw new ApiError(404, "not_found", "Fixed cost not found");
  const f = {
    name: input.name ?? cur?.name,
    amount: input.amount ?? cur?.amount,
    currency: input.currency ?? cur?.currency ?? ctx.config.currency,
    interval: input.interval ?? cur?.interval,
    renews_on: input.renews_on ?? cur?.renews_on,
    project_id: input.project_id !== undefined ? input.project_id : (cur?.project_id ?? null),
  };
  if (!f.name || f.amount === undefined || !f.interval || !f.renews_on) {
    throw new ApiError(422, "validation_failed", "name, amount, interval and renews_on are required");
  }
  const newId = id ?? uuid();
  // Changing the renewal date re-arms the reminder.
  const remindedFor = cur && cur.renews_on === f.renews_on ? cur.reminded_for : null;
  await ctx.storage.batch([
    BUMP,
    cur
      ? {
          sql: `UPDATE fixed_costs SET name = ?, amount = ?, currency = ?, interval = ?, renews_on = ?, project_id = ?, reminded_for = ?, updated_at = ?, rev = ${REV} WHERE id = ?`,
          params: [f.name, f.amount, f.currency, f.interval, f.renews_on, f.project_id, remindedFor, now, newId],
        }
      : {
          sql: `INSERT INTO fixed_costs (id, name, amount, currency, interval, renews_on, project_id, created_at, updated_at, rev)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${REV})`,
          params: [newId, f.name, f.amount, f.currency, f.interval, f.renews_on, f.project_id, now, now],
        },
  ]);
  await logActivity(ctx, actor, cur ? "PATCH /api/fixed-costs" : "POST /api/fixed-costs", `Fixed cost "${f.name}" ${f.amount} ${f.currency} ${f.interval}`);
  return fixedCostJson((await ctx.storage.first<FixedCostRow>("SELECT * FROM fixed_costs WHERE id = ?", [newId]))!);
}
