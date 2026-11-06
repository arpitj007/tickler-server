// Wires the money adapters (src/providers) and pure money functions (src/money) to storage:
// provider status, sync, summary, series, and the daily job (budgets, renewals, pruning).
import { buildMoneySummary, dueRenewalReminders, evaluateBudgets, monthToDateFromSummary, type MoneySummary, type StoredSnapshot } from "../money/index";
import type { Provider, ProviderId, SyncContext } from "../providers/types";
import { logActivity } from "./activity";
import { BUMP, REV, SYSTEM, type Actor, type Ctx } from "./context";
import { createEntry } from "./entries";
import {
  budgetJson, getProviderConfigRow, insertSalesEvents, listBudgets, listFixedCosts, PROVIDER_IDS, readProviderConfig,
  setProviderSyncResult, upsertSnapshots, type BudgetRow, type ProviderConfigRow, type SnapshotRow,
} from "./moneyStore";
import { resolveOrCreateProject } from "./projects";
import { ApiError, uuid } from "./util";

const STATIC: Record<string, { display_name: string; kind: "revenue" | "cost" }> = {
  app_store: { display_name: "App Store", kind: "revenue" },
  google_play: { display_name: "Google Play", kind: "revenue" },
  amazon_appstore: { display_name: "Amazon Appstore", kind: "revenue" },
  stripe: { display_name: "Stripe", kind: "revenue" },
  cloudflare: { display_name: "Cloudflare", kind: "cost" },
  google_cloud: { display_name: "Google Cloud", kind: "cost" },
  aws: { display_name: "AWS", kind: "cost" },
  anthropic: { display_name: "Anthropic", kind: "cost" },
  openai: { display_name: "OpenAI", kind: "cost" },
  github: { display_name: "GitHub", kind: "cost" },
  manual: { display_name: "Manual", kind: "cost" },
};

export function findProvider(ctx: Ctx, id: string): Provider | undefined {
  return ctx.providers.find((p) => p.id === id);
}

export function isPublicUrlOk(ctx: Ctx, baseUrl: string | null): boolean {
  const u = ctx.config.publicUrl ?? baseUrl ?? "";
  return /^https:\/\//.test(u) && !/\/\/(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(u);
}

export async function providerStatus(ctx: Ctx, id: string, baseUrl: string | null, row?: ProviderConfigRow | null) {
  const p = findProvider(ctx, id);
  const r = row === undefined ? await getProviderConfigRow(ctx, id) : row;
  let configured = !!r;
  if (r && p) {
    try {
      configured = p.configured((await readProviderConfig(ctx, id)) ?? {});
    } catch {
      configured = false;
    }
  }
  return {
    provider: id,
    display_name: p?.displayName ?? STATIC[id]?.display_name ?? id,
    kind: p?.kind ?? STATIC[id]?.kind ?? "cost",
    configured,
    enabled: r ? !!r.enabled : false,
    freshness: p?.freshness ?? (id === "manual" ? "manual" : "unknown"),
    needs_public_url: !!p?.needsPublicUrl,
    public_url_ok: p?.needsPublicUrl ? isPublicUrlOk(ctx, baseUrl) : true,
    last_sync_at: r?.last_sync_at ?? null,
    last_error: r?.last_error ?? null,
    last_message: r?.last_message ?? null,
    guide: p?.guide ?? `providers/${id.replace(/_/g, "-")}`,
  };
}
export type ProviderStatus = Awaited<ReturnType<typeof providerStatus>>;

export async function listProviderStatuses(ctx: Ctx, baseUrl: string | null) {
  const rows = await ctx.storage.all<ProviderConfigRow>("SELECT * FROM provider_configs");
  const ids = new Set<string>([...ctx.providers.map((p) => p.id), ...rows.map((r) => r.provider)]);
  const out: ProviderStatus[] = [];
  for (const id of PROVIDER_IDS) {
    if (!ids.has(id)) continue;
    out.push(await providerStatus(ctx, id, baseUrl, rows.find((r) => r.provider === id) ?? null));
  }
  return out;
}

function syncContext(ctx: Ctx, lastSyncAt: string | null): SyncContext {
  return { now: ctx.now(), fetch: ctx.fetch, lastSyncAt: lastSyncAt ? new Date(lastSyncAt) : null, currency: ctx.config.currency };
}

export async function testProvider(ctx: Ctx, id: string) {
  const p = findProvider(ctx, id);
  if (!p) throw new ApiError(404, "not_found", `Unknown provider ${id}`);
  const cfg = await readProviderConfig(ctx, id);
  if (!cfg || !p.configured(cfg)) return { ok: false, message: "Not configured yet: save the credentials first." };
  try {
    return await p.test(cfg, syncContext(ctx, null));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Run one provider's sync and store its results. Errors are recorded on the config, not thrown. */
export async function syncProvider(ctx: Ctx, id: string): Promise<{ ok: boolean; error: string | null; snapshots: number; events: number }> {
  const p = findProvider(ctx, id);
  if (!p) throw new ApiError(404, "not_found", `Unknown provider ${id}`);
  const row = await getProviderConfigRow(ctx, id);
  const cfg = await readProviderConfig(ctx, id);
  if (!row || !cfg || !p.configured(cfg)) throw new ApiError(400, "bad_request", "Provider is not configured");
  try {
    const res = await p.sync(cfg, syncContext(ctx, row.last_sync_at));
    await upsertSnapshots(ctx, res.snapshots);
    const events = res.salesEvents?.length ? await insertSalesEvents(ctx, res.salesEvents) : 0;
    await setProviderSyncResult(ctx, id, null);
    return { ok: true, error: null, snapshots: res.snapshots.length, events };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await setProviderSyncResult(ctx, id, msg);
    return { ok: false, error: msg, snapshots: 0, events: 0 };
  }
}

/** Called every 15 minutes: sync each enabled, configured provider whose interval has passed. */
export async function runDueSyncs(ctx: Ctx): Promise<Record<string, string>> {
  const rows = await ctx.storage.all<ProviderConfigRow>("SELECT * FROM provider_configs WHERE enabled = 1");
  const now = ctx.now().getTime();
  const out: Record<string, string> = {};
  for (const row of rows) {
    const p = findProvider(ctx, row.provider);
    if (!p) continue;
    // One minute of slack so a 15-minute provider isn't skipped by cron jitter.
    if (row.last_sync_at && now - Date.parse(row.last_sync_at) < (p.syncEveryMinutes - 1) * 60_000) continue;
    // Failed syncs retry on the provider's own interval, using updated_at as the attempt time.
    if (row.last_error && now - Date.parse(row.updated_at) < (p.syncEveryMinutes - 1) * 60_000) continue;
    const r = await syncProvider(ctx, row.provider);
    if (!r.ok) await ctx.storage.run("UPDATE provider_configs SET updated_at = ? WHERE provider = ?", [ctx.now().toISOString(), row.provider]);
    out[row.provider] = r.ok ? `ok (${r.snapshots} snapshots, ${r.events} events)` : `error: ${r.error}`;
  }
  return out;
}

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const lookback = new Date(Date.UTC(y, m - 1, 1 - 7)).toISOString().slice(0, 10);
  return { first, last, lookback };
}

export async function getMoneySummary(ctx: Ctx, month: string, baseUrl: string | null = null): Promise<MoneySummary> {
  const { first, last, lookback } = monthBounds(month);
  const snaps = await ctx.storage.all<SnapshotRow>(
    "SELECT * FROM metric_snapshots WHERE period_end >= ? AND period_start <= ?",
    [lookback, last],
  );
  const snapshots: StoredSnapshot[] = snaps.map((s) => ({
    provider: s.provider as ProviderId,
    account: s.account,
    metric: s.metric as StoredSnapshot["metric"],
    unit: s.unit,
    value: s.value,
    label: s.label === "" ? null : s.label,
    period_start: s.period_start,
    period_end: s.period_end,
    fetched_at: s.fetched_at,
  }));
  const salesEvents = await ctx.storage.all<{ store: "app_store"; type: "purchase"; occurred_at: string; price: number | null; currency: string | null }>(
    "SELECT store, type, occurred_at, price, currency FROM sales_events WHERE occurred_at >= ? AND occurred_at < ?",
    [first, `${last}T23:59:59.999Z`],
  );
  return buildMoneySummary({
    snapshots,
    salesEvents,
    budgets: (await listBudgets(ctx)).map((b) => ({ ...b, provider: b.provider as ProviderId | null })),
    fixedCosts: await listFixedCosts(ctx),
    providerStatuses: (await listProviderStatuses(ctx, baseUrl)).map((s) => ({ ...s, provider: s.provider as ProviderId })),
    month,
    now: ctx.now(),
    currency: ctx.config.currency,
  });
}

/** Daily points for one provider and metric (money totals and labeled lines both summed per day). */
export async function getSeries(ctx: Ctx, q: { provider?: string | null; metric?: string | null; from: string; to: string }) {
  const where = ["period_start = period_end", "period_start >= ?", "period_start <= ?"];
  const params: string[] = [q.from, q.to];
  if (q.provider) where.push("provider = ?"), params.push(q.provider);
  if (q.metric) where.push("metric = ?"), params.push(q.metric);
  // Totals only (label '' or currency:*), unless a provider has only labeled rows for the metric (usage).
  const rows = await ctx.storage.all<{ date: string; unit: string; value: number }>(
    `SELECT period_start AS date, unit, SUM(value) AS value
     FROM metric_snapshots WHERE ${where.join(" AND ")} AND (label = '' OR label LIKE 'currency:%')
     GROUP BY period_start, unit ORDER BY period_start`,
    params,
  );
  if (rows.length) return rows.map((r) => ({ ...r, value: Math.round(r.value * 100) / 100 }));
  const lines = await ctx.storage.all<{ date: string; unit: string; value: number }>(
    `SELECT period_start AS date, unit, SUM(value) AS value FROM metric_snapshots WHERE ${where.join(" AND ")}
     GROUP BY period_start, unit ORDER BY period_start`,
    params,
  );
  return lines.map((r) => ({ ...r, value: Math.round(r.value * 100) / 100 }));
}

/**
 * Daily job (06:00 UTC): evaluate budgets for this month (alert + Important entry in "Money" on the
 * first crossing of each threshold; critical at 100%), create renewal reminders 14 days ahead,
 * prune raw provider data older than 90 days and expired housekeeping rows.
 */
export async function runDaily(ctx: Ctx) {
  const now = ctx.now();
  const month = now.toISOString().slice(0, 7);
  const actor: Actor = SYSTEM;
  const summary = await getMoneySummary(ctx, month);
  const existing = await ctx.storage.all<{ budget_id: string; month: string; threshold: number }>(
    "SELECT budget_id, month, threshold FROM alerts WHERE month = ?",
    [month],
  );
  const budgets = (await ctx.storage.all<BudgetRow>("SELECT * FROM budgets")).map(budgetJson);
  const newAlerts = evaluateBudgets({
    budgets: budgets.map((b) => ({ ...b, provider: b.provider as ProviderId | null })),
    monthToDate: monthToDateFromSummary(summary),
    existingAlerts: existing,
    month,
    now,
  });
  let alertsCreated = 0;
  for (const a of newAlerts) {
    let entryId: string | null = null;
    if (a.entry) {
      const { project, ...draft } = a.entry;
      const p = await resolveOrCreateProject(ctx, project, actor);
      entryId = (await createEntry(ctx, p.id, draft, { actor, action: "budget_alert", source: "system" })).entry.id;
    }
    await ctx.storage.batch([
      BUMP,
      {
        sql: `INSERT INTO alerts (id, budget_id, month, threshold, entry_id, value, created_at, rev)
              VALUES (?, ?, ?, ?, ?, ?, ?, ${REV}) ON CONFLICT (budget_id, month, threshold) DO NOTHING`,
        params: [uuid(), a.budget_id, a.month, a.threshold, entryId, a.value, now.toISOString()],
      },
    ]);
    alertsCreated++;
  }
  if (alertsCreated) await logActivity(ctx, actor, "budget_alert", `${alertsCreated} budget alert(s) for ${month}`);

  let reminders = 0;
  const fixed = await listFixedCosts(ctx);
  for (const draft of dueRenewalReminders({ fixedCosts: fixed, now })) {
    const { project, ...rest } = draft;
    const p = await resolveOrCreateProject(ctx, project, actor);
    const r = await createEntry(ctx, p.id, rest, { actor, action: "renewal_reminder", source: "system" });
    if (r.created) reminders++;
  }

  const cutoff90 = new Date(now.getTime() - 90 * 86400_000).toISOString();
  const cutoff1d = new Date(now.getTime() - 86400_000).toISOString();
  await ctx.storage.run("UPDATE metric_snapshots SET raw = NULL WHERE raw IS NOT NULL AND fetched_at < ?", [cutoff90]);
  await ctx.storage.run("UPDATE sales_events SET raw = NULL WHERE raw IS NOT NULL AND created_at < ?", [cutoff90]);
  await housekeeping(ctx, cutoff1d);
  return { month, alerts: alertsCreated, reminders };
}

export async function housekeeping(ctx: Ctx, cutoff1d: string) {
  const now = ctx.now();
  const nowIso = now.toISOString();
  await ctx.storage.batch([
    { sql: "DELETE FROM idempotency_keys WHERE created_at < ?", params: [cutoff1d] },
    { sql: "DELETE FROM rate_limits WHERE window_start < ?", params: [Math.floor(now.getTime() / 1000) - 86400] },
    { sql: "DELETE FROM pairing_codes WHERE expires_at < ?", params: [cutoff1d] },
    { sql: "DELETE FROM sessions WHERE expires_at < ?", params: [nowIso] },
    { sql: "DELETE FROM challenges WHERE expires_at < ?", params: [nowIso] },
    { sql: "DELETE FROM oauth_codes WHERE expires_at < ?", params: [cutoff1d] },
    { sql: "DELETE FROM oauth_tokens WHERE expires_at < ?", params: [cutoff1d] },
    { sql: "DELETE FROM activity WHERE at < ?", params: [new Date(now.getTime() - 365 * 86400_000).toISOString()] },
  ]);
}
