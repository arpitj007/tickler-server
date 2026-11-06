// JSON API for the apps. docs/reference/api-contract.md is the source of truth.
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { listActivity } from "../core/activity";
import { authenticate, bearer } from "../core/auth";
import { getChanges } from "../core/changes";
import { connectClients, INSTRUCTION_BLOCK } from "../core/connect";
import {
  createToken, deviceJson, lastMcpCall, listDevices, listOAuthClients, listTokens, pairDevice, revokeDevice, revokeOAuthClient,
  revokeToken, tokenJson,
} from "../core/devices";
import {
  completeEntry, createEntry, deleteEntry, entryFieldsSchema, entryJson, getEntry, IMPORTANCES, listEntries, snoozeEntry,
  STATUSES, updateEntry,
} from "../core/entries";
import {
  budgetSchema, deleteProviderConfig, deleteRow, fixedCostJson, fixedCostSchema, getBudget, listBudgets, listFixedCosts,
  manualMetricSchema, salesEventJson, saveBudget, saveFixedCost, saveProviderConfig, snapshotJson, upsertSnapshots,
  getSnapshotByKey, type SalesEventRow,
} from "../core/moneyStore";
import { findProvider, getMoneySummary, getSeries, listProviderStatuses, providerStatus, syncProvider, testProvider } from "../core/moneyService";
import { getOrigin, listOrigins } from "../core/origins";
import { createProject, getProject, listProjects, projectCreateSchema, projectJson, projectPatchSchema, updateProject } from "../core/projects";
import { rateLimit } from "../core/rateLimit";
import { API_VERSION, ApiError, VERSION } from "../core/util";
import { clientIp, errorResponse, intParam, jsonBody, parse, type C, type Env } from "./http";
import { exportAll } from "../core/export";

export const api = new Hono<Env>();

const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

// ---------- public

api.get("/health", (c) => {
  const ctx = c.get("ctx");
  return c.json({
    ok: true,
    name: "tickler",
    version: VERSION,
    api: API_VERSION,
    server_name: ctx.config.serverName,
    public_url: ctx.config.publicUrl ?? c.get("baseUrl"),
  });
});

api.post("/pair", async (c) => {
  const ctx = c.get("ctx");
  await rateLimit(ctx, `pair:${clientIp(c)}`, 10, 600);
  const b = await jsonBody(
    c,
    z.object({ code: z.string().min(4).max(20), device_name: z.string().max(80).default("Phone"), platform: z.string().max(20).default("other") }),
  );
  const r = await pairDevice(ctx, b.code, b.device_name, b.platform);
  return c.json({ ...r, server: { name: ctx.config.serverName, version: VERSION, api: API_VERSION } });
});

// ---------- auth

/** Device token for everything; MCP tokens only for POST /api/metrics. */
const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  const ctx = c.get("ctx");
  const p = await authenticate(ctx, bearer(c.req.header("authorization")));
  const metricsPush = c.req.method === "POST" && c.req.path.replace(/\/+$/, "") === "/api/metrics";
  if (!p || (p.actor.type !== "device" && !(metricsPush && p.actor.type === "mcp_token"))) {
    throw new ApiError(401, "unauthorized", "Missing or invalid token");
  }
  c.set("principal", p);
  await rateLimit(ctx, `api:${p.actor.id}`, 600, 60);
  await next();
};

/** Replays the stored response for a repeated Idempotency-Key (per device, 24 h). */
const idempotency: MiddlewareHandler<Env> = async (c, next) => {
  const key = c.req.header("idempotency-key");
  if (!key || c.req.method === "GET") return next();
  if (key.length > 200) throw new ApiError(400, "bad_request", "Idempotency-Key too long");
  const ctx = c.get("ctx");
  const actorId = c.get("principal").actor.id!;
  const prev = await ctx.storage.first<{ method: string; path: string; status: number; body: string; created_at: string }>(
    "SELECT * FROM idempotency_keys WHERE actor_id = ? AND key = ?",
    [actorId, key],
  );
  if (prev && ctx.now().getTime() - Date.parse(prev.created_at) < IDEMPOTENCY_TTL_MS) {
    if (prev.method !== c.req.method || prev.path !== c.req.path) {
      throw new ApiError(409, "conflict", "Idempotency-Key was already used for a different request");
    }
    return new Response(prev.body || null, {
      status: prev.status,
      headers: { "content-type": "application/json", "idempotency-replayed": "true" },
    });
  }
  await next();
  const status = c.res.status;
  if (status >= 500 || status === 429) return;
  const body = status === 204 ? "" : await c.res.clone().text();
  await ctx.storage.run(
    `INSERT INTO idempotency_keys (actor_id, key, method, path, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (actor_id, key) DO UPDATE SET method = excluded.method, path = excluded.path, status = excluded.status,
       body = excluded.body, created_at = excluded.created_at`,
    [actorId, key, c.req.method, c.req.path, status, body, ctx.now().toISOString()],
  );
};

api.use("*", async (c, next) => {
  const path = c.req.path.replace(/\/+$/, "");
  if (path === "/api/health" || path === "/api/pair") return next();
  return requireAuth(c, async () => idempotency(c, next));
});

const meta = (c: C, action: string) => ({ actor: c.get("principal").actor, action, source: "manual" as const });

// ---------- me, devices, tokens, oauth clients

api.get("/me", (c) => {
  const p = c.get("principal");
  return c.json({ device: deviceJson(p.device!, p.device!.id), server_name: c.get("ctx").config.serverName });
});

api.get("/devices", async (c) => {
  const me = c.get("principal").device!.id;
  return c.json({ devices: (await listDevices(c.get("ctx"))).map((d) => deviceJson(d, me)) });
});

api.delete("/devices/:id", async (c) => {
  const p = c.get("principal");
  const id = c.req.param("id") === "me" ? p.device!.id : c.req.param("id");
  await revokeDevice(c.get("ctx"), id, p.actor);
  return c.body(null, 204);
});

api.get("/tokens", async (c) => c.json({ tokens: (await listTokens(c.get("ctx"))).map(tokenJson) }));
api.post("/tokens", async (c) => {
  const b = await jsonBody(c, z.object({ name: z.string().trim().min(1).max(80) }));
  return c.json(await createToken(c.get("ctx"), b.name, c.get("principal").actor), 201);
});
api.delete("/tokens/:id", async (c) => {
  await revokeToken(c.get("ctx"), c.req.param("id"), c.get("principal").actor);
  return c.body(null, 204);
});

api.get("/oauth-clients", async (c) => c.json({ clients: await listOAuthClients(c.get("ctx")) }));
api.delete("/oauth-clients/:id", async (c) => {
  await revokeOAuthClient(c.get("ctx"), c.req.param("id"), c.get("principal").actor);
  return c.body(null, 204);
});

api.get("/activity", async (c) => {
  const before = c.req.query("before") ?? null;
  return c.json({ activity: await listActivity(c.get("ctx"), before, intParam(c.req.query("limit"), 100, 200)) });
});

api.get("/mcp/last-call", async (c) => c.json(await lastMcpCall(c.get("ctx"), c.req.query("since") ?? null)));

api.get("/connect", (c) => {
  const base = c.get("baseUrl");
  return c.json({
    mcp_url: `${base}/mcp`,
    clients: connectClients(base).map(({ id, name, snippet, docs, auth, note }) => ({ id, name, snippet, docs, auth, note: note ?? null })),
    instruction_block: INSTRUCTION_BLOCK,
  });
});

// ---------- sync

api.get("/changes", async (c) => {
  const since = Number.parseInt(c.req.query("since") ?? "0", 10);
  if (!Number.isFinite(since) || since < 0) throw new ApiError(400, "bad_request", "since must be a cursor from a previous response");
  return c.json(await getChanges(c.get("ctx"), since, intParam(c.req.query("limit"), 500, 1000)));
});

api.get("/export", async (c) => {
  c.header("content-disposition", 'attachment; filename="tickler-export.json"');
  return c.json(await exportAll(c.get("ctx")));
});

// ---------- projects

api.get("/projects", async (c) => {
  const rows = await listProjects(c.get("ctx"), c.req.query("archived") === "true");
  return c.json({ projects: rows.map(projectJson) });
});
api.post("/projects", async (c) => {
  const b = await jsonBody(c, projectCreateSchema);
  return c.json(projectJson(await createProject(c.get("ctx"), b, c.get("principal").actor, "POST /api/projects")), 201);
});
api.patch("/projects/:id", async (c) => {
  const b = await jsonBody(c, projectPatchSchema);
  return c.json(projectJson(await updateProject(c.get("ctx"), c.req.param("id"), b, c.get("principal").actor, "PATCH /api/projects")));
});
api.delete("/projects/:id", async (c) => {
  return c.json(projectJson(await updateProject(c.get("ctx"), c.req.param("id"), { archived: true }, c.get("principal").actor, "DELETE /api/projects")));
});

// ---------- entries

const isoOrNull = (v: string | undefined) => {
  if (!v) return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new ApiError(400, "bad_request", `Bad time "${v}"`);
  return new Date(t).toISOString();
};

api.get("/entries", async (c) => {
  const q = c.req.query();
  const rows = await listEntries(c.get("ctx"), {
    from: isoOrNull(q.from),
    to: isoOrNull(q.to),
    project_id: q.project_id ?? null,
    status: q.status ?? null,
    importance: q.importance ?? null,
    q: q.q ?? null,
    limit: intParam(q.limit, 500, 500),
  });
  return c.json({ entries: rows.map(entryJson) });
});

api.get("/entries/:id", async (c) => {
  const ctx = c.get("ctx");
  const e = await getEntry(ctx, c.req.param("id"));
  if (!e) throw new ApiError(404, "not_found", "Entry not found");
  return c.json({ entry: entryJson(e), origin: await getOrigin(ctx, e.origin_id), last_origin: await getOrigin(ctx, e.last_origin_id) });
});

const entryCreateSchema = entryFieldsSchema.partial().extend({
  id: z.string().uuid().optional(),
  project_id: z.string().min(1),
  title: z.string().trim().min(1).max(120),
});

api.post("/entries", async (c) => {
  const { id, project_id, ...b } = await jsonBody(c, entryCreateSchema);
  const r = await createEntry(c.get("ctx"), project_id, b, meta(c, "POST /api/entries"), id?.toLowerCase());
  return c.json(entryJson(r.entry), r.created ? 201 : 200);
});

const entryPatchSchema = entryFieldsSchema.partial().extend({
  project_id: z.string().min(1).optional(),
  base_updated_at: z.string().nullish(),
});

api.patch("/entries/:id", async (c) => {
  const b = await jsonBody(c, entryPatchSchema);
  return c.json(entryJson(await updateEntry(c.get("ctx"), c.req.param("id"), b, meta(c, "PATCH /api/entries"))));
});

api.post("/entries/:id/complete", async (c) => {
  const b = await jsonBody(c, z.object({ status: z.enum(STATUSES).default("done"), note: z.string().max(2000).nullish(), base_updated_at: z.string().nullish() }));
  return c.json(entryJson(await completeEntry(c.get("ctx"), c.req.param("id"), b, meta(c, "POST /api/entries/complete"))));
});

api.post("/entries/:id/snooze", async (c) => {
  const b = await jsonBody(c, z.object({ start_at: z.string().min(10) }));
  return c.json(entryJson(await snoozeEntry(c.get("ctx"), c.req.param("id"), b.start_at, meta(c, "POST /api/entries/snooze"))));
});

api.delete("/entries/:id", async (c) => {
  return c.json(entryJson(await deleteEntry(c.get("ctx"), c.req.param("id"), meta(c, "DELETE /api/entries"))));
});

// ---------- origins

api.get("/origins", async (c) => {
  return c.json({ origins: await listOrigins(c.get("ctx"), { client: c.req.query("client"), project_id: c.req.query("project_id") }) });
});

api.get("/origins/:id", async (c) => {
  const ctx = c.get("ctx");
  const o = await getOrigin(ctx, c.req.param("id"));
  if (!o) throw new ApiError(404, "not_found", "Origin not found");
  const entries = await listEntries(ctx, { origin_id: o.id, include_deleted: true, limit: 500 });
  return c.json({ origin: o, entries: entries.map(entryJson), parent: await getOrigin(ctx, o.parent_origin_id) });
});

// ---------- money

const monthRe = /^\d{4}-\d{2}$/;

api.get("/money/summary", async (c) => {
  const month = c.req.query("month") ?? c.get("ctx").now().toISOString().slice(0, 7);
  if (!monthRe.test(month)) throw new ApiError(400, "bad_request", "month must be YYYY-MM");
  return c.json(await getMoneySummary(c.get("ctx"), month, c.get("baseUrl")));
});

api.get("/money/providers", async (c) => c.json({ providers: await listProviderStatuses(c.get("ctx"), c.get("baseUrl")) }));

const providerParam = (c: C) => {
  const id = c.req.param("provider")!;
  if (!findProvider(c.get("ctx"), id)) throw new ApiError(404, "not_found", `Unknown provider ${id}`);
  return id;
};

api.put("/money/providers/:provider", async (c) => {
  const id = providerParam(c);
  const b = await jsonBody(c, z.object({ credentials: z.record(z.string(), z.string()).default({}), enabled: z.boolean().default(true) }));
  await saveProviderConfig(c.get("ctx"), id, b.credentials, b.enabled, c.get("principal").actor);
  return c.json(await providerStatus(c.get("ctx"), id, c.get("baseUrl")));
});

api.delete("/money/providers/:provider", async (c) => {
  await deleteProviderConfig(c.get("ctx"), providerParam(c), c.get("principal").actor);
  return c.body(null, 204);
});

api.post("/money/providers/:provider/test", async (c) => c.json(await testProvider(c.get("ctx"), providerParam(c))));

api.post("/money/providers/:provider/sync", async (c) => {
  const id = providerParam(c);
  const ctx = c.get("ctx");
  await rateLimit(ctx, `sync:${id}`, 6, 600);
  await syncProvider(ctx, id);
  return c.json(await providerStatus(ctx, id, c.get("baseUrl")));
});

api.get("/money/series", async (c) => {
  const q = c.req.query();
  const now = c.get("ctx").now();
  const to = q.to ?? now.toISOString().slice(0, 10);
  const from = q.from ?? new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new ApiError(400, "bad_request", "from and to must be YYYY-MM-DD");
  return c.json({ points: await getSeries(c.get("ctx"), { provider: q.provider, metric: q.metric, from, to }) });
});

api.get("/budgets", async (c) => c.json({ budgets: await listBudgets(c.get("ctx")) }));
api.get("/budgets/:id", async (c) => {
  const b = await getBudget(c.get("ctx"), c.req.param("id"));
  if (!b) throw new ApiError(404, "not_found", "Budget not found");
  return c.json(b);
});
api.post("/budgets", async (c) => c.json(await saveBudget(c.get("ctx"), null, await jsonBody(c, budgetSchema), c.get("principal").actor), 201));
api.patch("/budgets/:id", async (c) => {
  const b = await jsonBody(c, budgetSchema.partial());
  return c.json(await saveBudget(c.get("ctx"), c.req.param("id"), stripDefaults(b, await c.req.json()), c.get("principal").actor));
});
api.delete("/budgets/:id", async (c) => {
  await deleteRow(c.get("ctx"), "budgets", "budget", c.req.param("id"), c.get("principal").actor);
  return c.body(null, 204);
});

api.get("/sales-events", async (c) => {
  const store = c.req.query("store");
  const rows = await c.get("ctx").storage.all<SalesEventRow>(
    `SELECT * FROM sales_events ${store ? "WHERE store = ?" : ""} ORDER BY occurred_at DESC LIMIT ?`,
    [...(store ? [store] : []), intParam(c.req.query("limit"), 50, 200)],
  );
  return c.json({ events: rows.map(salesEventJson) });
});

api.get("/fixed-costs", async (c) => c.json({ fixed_costs: (await listFixedCosts(c.get("ctx"))).map(fixedCostJson) }));
api.post("/fixed-costs", async (c) => c.json(await saveFixedCost(c.get("ctx"), null, await jsonBody(c, fixedCostSchema), c.get("principal").actor), 201));
api.patch("/fixed-costs/:id", async (c) => {
  const b = await jsonBody(c, fixedCostSchema.partial());
  return c.json(await saveFixedCost(c.get("ctx"), c.req.param("id"), stripDefaults(b, await c.req.json()), c.get("principal").actor));
});
api.delete("/fixed-costs/:id", async (c) => {
  await deleteRow(c.get("ctx"), "fixed_costs", "fixed_cost", c.req.param("id"), c.get("principal").actor);
  return c.body(null, 204);
});

api.post("/metrics", async (c) => {
  const ctx = c.get("ctx");
  const b = await jsonBody(c, manualMetricSchema);
  if (b.period_end && b.period_end < b.period_start) throw new ApiError(422, "validation_failed", "period_end is before period_start", { fields: { period_end: "Before period_start." } });
  const snap = { ...b, account: b.account ?? "default", period_end: b.period_end ?? b.period_start, label: b.label ?? null };
  await upsertSnapshots(ctx, [snap]);
  const p = c.get("principal");
  await ctx.storage.run(
    "INSERT INTO activity (id, at, actor_type, actor_id, actor_name, origin_id, action, summary) VALUES (?, ?, ?, ?, ?, NULL, 'POST /api/metrics', ?)",
    [crypto.randomUUID(), ctx.now().toISOString(), p.actor.type, p.actor.id, p.actor.name, `${b.provider} ${b.metric} ${b.value} ${b.unit}`],
  );
  return c.json(snapshotJson((await getSnapshotByKey(ctx, snap))!), 201);
});

/** zod defaults fill absent keys on PATCH; keep only keys the client actually sent. */
function stripDefaults<T extends Record<string, unknown>>(parsed: T, raw: unknown): Partial<T> {
  const sent = raw && typeof raw === "object" ? Object.keys(raw) : [];
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.includes(k))) as Partial<T>;
}

api.notFound((c) => c.json(errorResponse(new ApiError(404, "not_found", "No such endpoint")), 404));

