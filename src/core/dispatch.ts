// Run in agent. The phone queues a dispatch; a `tickler bridge` on the user's computer pairs with a
// bridge token (tkb_), long-polls for work, runs the agent's own CLI with the message on stdin, and
// reports back. Only paired phones create dispatches: an agent must never be able to queue work into
// another agent's session. Contract: docs/reference/api-contract.md, "Run in agent".
import { z } from "zod";
import { logActivity } from "./activity";
import type { Actor, Ctx } from "./context";
import { getOrigin, upsertOrigin } from "./origins";
import { rateLimit } from "./rateLimit";
import { ApiError, jsonParse, pairingCode, randomToken, sha256hex, timingSafeEqual, uuid } from "./util";

/** Clients a bridge can drive. The others (chat apps) fall back to copying in the app. */
export const RUNNABLE_CLIENTS = ["t3_code", "claude_code", "codex", "cursor", "gemini_cli"] as const;
export const BRIDGE_CODE_TTL_MS = 15 * 60_000;
export const ONLINE_MS = 90_000;
export const QUEUE_TTL_MS = 10 * 60_000;
export const CLAIM_TTL_MS = 10 * 60_000;
export const KEEP_MS = 30 * 24 * 3600_000;
export const MAX_WAIT_S = 25;
const POLL_MS = 2_000;
const RESULT_STATUSES = ["sent", "running", "done", "failed", "needs_input"] as const;
const FINAL = ["sent", "done", "failed", "needs_input", "expired"];

export interface BridgeRow {
  id: string;
  machine: string;
  name: string | null;
  token_hash: string;
  version: string | null;
  runners: string;
  projects: string;
  created_at: string;
  last_seen_at: string | null;
}

export interface DispatchRow {
  id: string;
  device_id: string;
  project_id: string | null;
  origin_id: string | null;
  client: string;
  session_id: string | null;
  cwd: string | null;
  machine: string | null;
  message: string;
  entry_id: string | null;
  checklist_id: string | null;
  status: string;
  detail: string | null;
  bridge_id: string | null;
  attempts: number;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

interface Runner {
  client: string;
  version?: string | null;
}
interface ProjectPath {
  project_id: string;
  cwd: string;
  client?: string | null;
}

/** "Mac.lan", "mac.local" and "Mac" are the same computer: hostnames gain a network suffix. */
export function sameMachine(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string) => s.trim().toLowerCase().split(".")[0];
  return !!a && !!b && norm(a) === norm(b);
}

export function bridgeJson(b: BridgeRow, now: Date) {
  return {
    id: b.id,
    machine: b.machine,
    name: b.name,
    version: b.version,
    online: !!b.last_seen_at && now.getTime() - Date.parse(b.last_seen_at) < ONLINE_MS,
    last_seen_at: b.last_seen_at,
    runners: jsonParse<Runner[]>(b.runners, []),
    projects: jsonParse<ProjectPath[]>(b.projects, []),
    created_at: b.created_at,
  };
}

export function dispatchJson(d: DispatchRow) {
  return {
    id: d.id,
    project_id: d.project_id,
    origin_id: d.origin_id,
    client: d.client,
    session_id: d.session_id,
    cwd: d.cwd,
    machine: d.machine,
    message: d.message,
    entry_id: d.entry_id,
    checklist_id: d.checklist_id,
    status: d.status,
    detail: d.detail,
    created_at: d.created_at,
    updated_at: d.updated_at,
    expires_at: d.expires_at,
  };
}

// ---------- pairing

export async function createBridgeCode(ctx: Ctx, actor: Actor) {
  const now = ctx.now();
  const code = pairingCode();
  const expires = new Date(now.getTime() + BRIDGE_CODE_TTL_MS).toISOString();
  await ctx.storage.run("DELETE FROM bridge_codes WHERE expires_at < ?", [now.toISOString()]);
  await ctx.storage.run("INSERT INTO bridge_codes (code, created_at, expires_at) VALUES (?, ?, ?)", [code, now.toISOString(), expires]);
  await logActivity(ctx, actor, "create_bridge_code", "Bridge setup code created");
  return { code, expires_at: expires };
}

export const bridgeCommand = (base: string, code: string) => `npx tickler bridge install --server ${base} --code ${code}`;

/** A bridge pairs with a code the phone made (POST /api/bridge-codes) or a /setup pairing code. Single use. */
export async function pairBridge(ctx: Ctx, rawCode: string, machine: string, name: string | null) {
  const code = rawCode.trim().toUpperCase().replace(/[\s-]/g, "");
  const now = ctx.now().toISOString();
  let ok = false;
  for (const table of ["bridge_codes", "pairing_codes"]) {
    const r = await ctx.storage.run(`UPDATE ${table} SET used_at = ? WHERE code = ? AND used_at IS NULL AND expires_at > ?`, [now, code, now]);
    if (r.changes === 1) {
      ok = true;
      break;
    }
  }
  if (!ok && ctx.config.demoPairingCode && timingSafeEqual(code, ctx.config.demoPairingCode)) ok = true;
  if (!ok) throw new ApiError(400, "pairing_expired", "This code is unknown, expired or already used. Make a new one in the app.");
  const token = randomToken("tkb_");
  const id = uuid();
  const m = machine.trim().slice(0, 200) || "computer";
  await ctx.storage.run(
    "INSERT INTO bridges (id, machine, name, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, m, name?.trim().slice(0, 200) || null, await sha256hex(token), now, now],
  );
  await logActivity(ctx, { type: "bridge", id, name: name || m }, "POST /api/bridge/pair", `Bridge paired on "${name || m}"`);
  return { bridge_id: id, token };
}

export async function listBridges(ctx: Ctx) {
  const now = ctx.now();
  return (await ctx.storage.all<BridgeRow>("SELECT * FROM bridges ORDER BY last_seen_at DESC")).map((b) => bridgeJson(b, now));
}

export async function revokeBridge(ctx: Ctx, id: string, actor: Actor) {
  const b = await ctx.storage.first<BridgeRow>("SELECT * FROM bridges WHERE id = ?", [id]);
  if (!b) throw new ApiError(404, "not_found", "Bridge not found");
  await ctx.storage.run("DELETE FROM bridges WHERE id = ?", [id]);
  // Whatever it had claimed goes back to the queue for another bridge, or expires.
  await ctx.storage.run("UPDATE dispatches SET status = 'queued', bridge_id = NULL, claimed_at = NULL WHERE bridge_id = ? AND status = 'claimed'", [id]);
  await ctx.storage.run("DELETE FROM idempotency_keys WHERE actor_id = ?", [id]);
  await logActivity(ctx, actor, "revoke_bridge", `Removed the bridge on "${b.name || b.machine}"`);
}

// ---------- bridge side

export const heartbeatSchema = z.object({
  machine: z.string().trim().min(1).max(200),
  name: z.string().trim().max(200).nullish(),
  version: z.string().trim().max(40).nullish(),
  runners: z.array(z.object({ client: z.string().max(40), version: z.string().max(80).nullish() })).max(20).default([]),
  projects: z
    .array(z.object({ project_id: z.string().max(100), cwd: z.string().max(1000), client: z.string().max(40).nullish() }))
    .max(200)
    .default([]),
});

export async function heartbeat(ctx: Ctx, bridgeId: string, b: z.infer<typeof heartbeatSchema>) {
  const runners = b.runners.filter((r) => (RUNNABLE_CLIENTS as readonly string[]).includes(r.client));
  await ctx.storage.run(
    "UPDATE bridges SET machine = ?, name = ?, version = ?, runners = ?, projects = ?, last_seen_at = ? WHERE id = ?",
    [b.machine, b.name ?? null, b.version ?? null, JSON.stringify(runners), JSON.stringify(b.projects), ctx.now().toISOString(), bridgeId],
  );
  return bridgeJson((await ctx.storage.first<BridgeRow>("SELECT * FROM bridges WHERE id = ?", [bridgeId]))!, ctx.now());
}

/** Expire stale queued dispatches; a claim with no result in 10 min goes back to the queue once, then fails. */
export async function sweep(ctx: Ctx) {
  const now = ctx.now();
  const iso = now.toISOString();
  const claimCutoff = new Date(now.getTime() - CLAIM_TTL_MS).toISOString();
  await ctx.storage.run("UPDATE dispatches SET status = 'expired', updated_at = ? WHERE status = 'queued' AND expires_at <= ?", [iso, iso]);
  await ctx.storage.run(
    `UPDATE dispatches SET status = 'failed', detail = 'The computer picked it up but never reported back.', updated_at = ?
     WHERE status = 'claimed' AND claimed_at <= ? AND attempts >= 2`,
    [iso, claimCutoff],
  );
  await ctx.storage.run(
    `UPDATE dispatches SET status = 'queued', bridge_id = NULL, claimed_at = NULL, updated_at = ?, expires_at = ?
     WHERE status = 'claimed' AND claimed_at <= ?`,
    [iso, new Date(now.getTime() + QUEUE_TTL_MS).toISOString(), claimCutoff],
  );
}

async function tryClaim(ctx: Ctx, bridge: BridgeRow): Promise<DispatchRow | null> {
  await sweep(ctx);
  const clients = jsonParse<Runner[]>(bridge.runners, []).map((r) => r.client);
  if (!clients.length) return null;
  const queued = await ctx.storage.all<DispatchRow>(
    `SELECT * FROM dispatches WHERE status = 'queued' AND client IN (${clients.map(() => "?").join(", ")}) ORDER BY created_at LIMIT 20`,
    clients,
  );
  for (const d of queued) {
    if (d.machine && !sameMachine(d.machine, bridge.machine)) continue;
    const now = ctx.now().toISOString();
    const r = await ctx.storage.run(
      `UPDATE dispatches SET status = 'claimed', bridge_id = ?, claimed_at = ?, attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND status = 'queued'`,
      [bridge.id, now, now, d.id],
    );
    if (r.changes === 1) return (await ctx.storage.first<DispatchRow>("SELECT * FROM dispatches WHERE id = ?", [d.id]))!;
  }
  return null;
}

/** Long poll: claim a dispatch now, or keep checking until `waitS` runs out. */
export async function nextDispatch(ctx: Ctx, bridgeId: string, waitS: number, signal?: AbortSignal): Promise<DispatchRow | null> {
  const deadline = Date.now() + Math.max(0, Math.min(waitS, MAX_WAIT_S)) * 1000;
  for (;;) {
    const bridge = await ctx.storage.first<BridgeRow>("SELECT * FROM bridges WHERE id = ?", [bridgeId]);
    if (!bridge) throw new ApiError(401, "unauthorized", "This bridge was removed");
    await ctx.storage.run("UPDATE bridges SET last_seen_at = ? WHERE id = ?", [ctx.now().toISOString(), bridgeId]);
    const d = await tryClaim(ctx, bridge);
    if (d) return d;
    if (Date.now() + POLL_MS > deadline || signal?.aborted) return null;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export const resultSchema = z.object({
  status: z.enum(RESULT_STATUSES),
  detail: z.string().max(20_000).nullish(),
  session_id: z.string().trim().min(1).max(200).nullish(),
});

const t3Url = (threadId: string) => `t3-thread://v1/${threadId}`;

export async function reportResult(ctx: Ctx, bridgeId: string, id: string, b: z.infer<typeof resultSchema>) {
  const d = await ctx.storage.first<DispatchRow>("SELECT * FROM dispatches WHERE id = ?", [id]);
  if (!d || d.bridge_id !== bridgeId) throw new ApiError(404, "not_found", "Dispatch not found");
  if (FINAL.includes(d.status) && !(d.status === "sent" && b.status !== "sent")) {
    throw new ApiError(409, "conflict", `This dispatch is already ${d.status}`);
  }
  const now = ctx.now().toISOString();
  // Keep the end: that's where the agent's reply or the error is.
  const detail = b.detail ? (b.detail.length > 2000 ? "…" + b.detail.slice(-1999) : b.detail) : d.detail;
  let originId = d.origin_id;
  let sessionId = d.session_id;
  if (b.session_id && !d.origin_id) {
    const bridge = await ctx.storage.first<BridgeRow>("SELECT machine FROM bridges WHERE id = ?", [bridgeId]);
    sessionId = b.session_id;
    originId = await upsertOrigin(
      ctx,
      {
        client: d.client,
        session_id: b.session_id,
        title: d.message.split("\n")[0]!.slice(0, 80),
        open_url: d.client === "t3_code" ? t3Url(b.session_id) : null,
        cwd: d.cwd,
        machine: d.machine ?? bridge?.machine ?? null,
      },
      null,
    );
  }
  await ctx.storage.run(
    "UPDATE dispatches SET status = ?, detail = ?, session_id = ?, origin_id = ?, updated_at = ? WHERE id = ?",
    [b.status, detail, sessionId, originId, now, id],
  );
  return dispatchJson((await ctx.storage.first<DispatchRow>("SELECT * FROM dispatches WHERE id = ?", [id]))!);
}

// ---------- phone side

export const dispatchCreateSchema = z
  .object({
    id: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/, "Use a UUID"),
    project_id: z.string().max(100).nullish(),
    message: z.string().min(1).max(16_000),
    origin_id: z.string().max(100).nullish(),
    new_session: z.object({ client: z.string().max(40), cwd: z.string().trim().min(1).max(1000) }).nullish(),
    machine: z.string().trim().max(200).nullish(),
    entry_id: z.string().max(100).nullish(),
    checklist_id: z.string().max(100).nullish(),
  })
  .refine((v) => !!v.origin_id !== !!v.new_session, { message: "Send exactly one of origin_id and new_session", path: ["origin_id"] });

/** T3 sessions are thread ids; older origins only carry the link. */
function sessionFrom(o: { client: string; session_id: string | null; open_url: string | null }) {
  if (o.session_id) return o.session_id;
  const m = o.client === "t3_code" ? /^t3-thread:\/\/v1\/([^/?#]+)/.exec(o.open_url ?? "") : null;
  return m ? decodeURIComponent(m[1]!) : null;
}

export async function createDispatch(ctx: Ctx, deviceId: string, actor: Actor, b: z.infer<typeof dispatchCreateSchema>) {
  const existing = await ctx.storage.first<DispatchRow>("SELECT * FROM dispatches WHERE id = ?", [b.id]);
  if (existing) {
    if (existing.device_id !== deviceId) throw new ApiError(409, "conflict", "This dispatch id is already used");
    return { dispatch: dispatchJson(existing), created: false };
  }
  let client: string;
  let sessionId: string | null = null;
  let cwd: string | null;
  let machine = b.machine || null;
  if (b.origin_id) {
    const o = await getOrigin(ctx, b.origin_id);
    if (!o) throw new ApiError(404, "not_found", "Session not found");
    client = o.client;
    sessionId = sessionFrom(o);
    if (!sessionId) throw new ApiError(422, "no_runner", "This session has no id the computer can resume. Copy the prompt instead.");
    cwd = o.cwd;
    machine ??= o.machine;
  } else {
    client = b.new_session!.client;
    cwd = b.new_session!.cwd;
  }
  const bridges = await listBridges(ctx);
  const online = bridges.filter((br) => br.online && br.runners.some((r) => r.client === client));
  const target = machine ? online.filter((br) => sameMachine(br.machine, machine)) : online;
  if (!(RUNNABLE_CLIENTS as readonly string[]).includes(client) || !target.length) {
    throw new ApiError(422, "no_runner", "No computer that's online can run this session right now.", { client });
  }
  // A session without a machine is unambiguous only when one bridge can run it.
  if (!machine && target.length === 1) machine = target[0]!.machine;
  await rateLimit(ctx, `dispatch:${deviceId}`, 30, 3600);
  const now = ctx.now();
  const iso = now.toISOString();
  await ctx.storage.run(
    `INSERT INTO dispatches (id, device_id, project_id, origin_id, client, session_id, cwd, machine, message, entry_id, checklist_id,
       status, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    [
      b.id, deviceId, b.project_id ?? null, b.origin_id ?? null, client, sessionId, cwd, machine, b.message,
      b.entry_id ?? null, b.checklist_id ?? null, iso, iso, new Date(now.getTime() + QUEUE_TTL_MS).toISOString(),
    ],
  );
  await logActivity(ctx, actor, "POST /api/dispatches", `Sent a prompt to ${client}${machine ? ` on ${machine}` : ""}`, b.origin_id ?? null);
  return { dispatch: dispatchJson((await ctx.storage.first<DispatchRow>("SELECT * FROM dispatches WHERE id = ?", [b.id]))!), created: true };
}

export async function getDispatch(ctx: Ctx, id: string) {
  await sweep(ctx);
  const d = await ctx.storage.first<DispatchRow>("SELECT * FROM dispatches WHERE id = ?", [id]);
  if (!d) throw new ApiError(404, "not_found", "Dispatch not found");
  return dispatchJson(d);
}

export async function listDispatches(ctx: Ctx, f: { project_id?: string | null; entry_id?: string | null; limit: number }) {
  await sweep(ctx);
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.project_id) where.push("project_id = ?"), params.push(f.project_id);
  if (f.entry_id) where.push("entry_id = ?"), params.push(f.entry_id);
  params.push(f.limit);
  const rows = await ctx.storage.all<DispatchRow>(
    `SELECT * FROM dispatches ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ?`,
    params,
  );
  return rows.map(dispatchJson);
}

/** Cancel a dispatch no computer has picked up yet. It is deleted, so it never runs. */
export async function cancelDispatch(ctx: Ctx, id: string) {
  const r = await ctx.storage.run("DELETE FROM dispatches WHERE id = ? AND status = 'queued'", [id]);
  if (r.changes === 1) return;
  const d = await ctx.storage.first<DispatchRow>("SELECT status FROM dispatches WHERE id = ?", [id]);
  if (!d) throw new ApiError(404, "not_found", "Dispatch not found");
  throw new ApiError(409, "conflict", `Too late to cancel: it's already ${d.status}`);
}

/** Daily: dispatches are kept 30 days. */
export async function purgeDispatches(ctx: Ctx) {
  await ctx.storage.run("DELETE FROM dispatches WHERE created_at < ?", [new Date(ctx.now().getTime() - KEEP_MS).toISOString()]);
  await ctx.storage.run("DELETE FROM bridge_codes WHERE expires_at < ?", [ctx.now().toISOString()]);
}
