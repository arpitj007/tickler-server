import { logActivity } from "./activity";
import type { Actor, Ctx } from "./context";
import type { DeviceRow, McpTokenRow } from "./auth";
import { ApiError, pairingCode, randomToken, sha256hex, uuid } from "./util";

export const PAIRING_TTL_MS = 10 * 60_000;

export async function createPairingCode(ctx: Ctx, actor: Actor) {
  const now = ctx.now();
  const code = pairingCode();
  const expires = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
  await ctx.storage.run("DELETE FROM pairing_codes WHERE expires_at < ?", [now.toISOString()]);
  await ctx.storage.run("INSERT INTO pairing_codes (code, created_at, expires_at) VALUES (?, ?, ?)", [code, now.toISOString(), expires]);
  await logActivity(ctx, actor, "create_pairing_code", "Pairing code created");
  return { code, expires_at: expires };
}

/** Exchange a one-time pairing code for a device token. */
export async function pairDevice(ctx: Ctx, rawCode: string, name: string, platform: string) {
  const code = rawCode.trim().toUpperCase().replace(/[\s-]/g, "");
  const row = await ctx.storage.first<{ code: string; expires_at: string; used_at: string | null }>(
    "SELECT * FROM pairing_codes WHERE code = ?",
    [code],
  );
  if (!row) throw new ApiError(404, "not_found", "Unknown pairing code");
  const now = ctx.now();
  if (row.used_at || Date.parse(row.expires_at) <= now.getTime()) {
    throw new ApiError(400, "pairing_expired", "This pairing code has expired or was already used. Create a new one on /setup.");
  }
  // Single use, even under concurrent requests.
  const claim = await ctx.storage.run("UPDATE pairing_codes SET used_at = ? WHERE code = ? AND used_at IS NULL", [now.toISOString(), code]);
  if (claim.changes !== 1) throw new ApiError(400, "pairing_expired", "This pairing code was already used.");
  const token = randomToken("tkd_");
  const id = uuid();
  const plat = ["ios", "android"].includes(platform) ? platform : "other";
  await ctx.storage.run(
    "INSERT INTO devices (id, name, platform, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, name.trim().slice(0, 80) || "Phone", plat, await sha256hex(token), now.toISOString(), now.toISOString()],
  );
  await logActivity(ctx, { type: "device", id, name }, "POST /api/pair", `Paired "${name}" (${plat})`);
  return { device_id: id, token };
}

export function deviceJson(d: DeviceRow, currentId?: string | null) {
  return { id: d.id, name: d.name, platform: d.platform, created_at: d.created_at, last_seen_at: d.last_seen_at, current: d.id === currentId };
}

export async function listDevices(ctx: Ctx) {
  return ctx.storage.all<DeviceRow>("SELECT * FROM devices ORDER BY created_at DESC");
}

export async function revokeDevice(ctx: Ctx, id: string, actor: Actor) {
  const d = await ctx.storage.first<DeviceRow>("SELECT * FROM devices WHERE id = ?", [id]);
  if (!d) throw new ApiError(404, "not_found", "Device not found");
  await ctx.storage.run("DELETE FROM devices WHERE id = ?", [id]);
  await ctx.storage.run("DELETE FROM idempotency_keys WHERE actor_id = ?", [id]);
  await logActivity(ctx, actor, "revoke_device", `Revoked device "${d.name}"`);
}

export function tokenJson(t: McpTokenRow) {
  return { id: t.id, name: t.name, scopes: JSON.parse(t.scopes) as string[], created_at: t.created_at, last_used_at: t.last_used_at };
}

export async function listTokens(ctx: Ctx) {
  return ctx.storage.all<McpTokenRow>("SELECT * FROM mcp_tokens ORDER BY created_at DESC");
}

export async function createToken(ctx: Ctx, name: string, actor: Actor) {
  const secret = randomToken("tkm_");
  const id = uuid();
  const now = ctx.now().toISOString();
  const clean = name.trim().slice(0, 80) || "MCP client";
  await ctx.storage.run(
    "INSERT INTO mcp_tokens (id, name, token_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, clean, await sha256hex(secret), JSON.stringify(["mcp"]), now],
  );
  await logActivity(ctx, actor, "create_token", `MCP token "${clean}" created`);
  const row = (await ctx.storage.first<McpTokenRow>("SELECT * FROM mcp_tokens WHERE id = ?", [id]))!;
  return { token: tokenJson(row), secret };
}

export async function revokeToken(ctx: Ctx, id: string, actor: Actor) {
  const t = await ctx.storage.first<McpTokenRow>("SELECT * FROM mcp_tokens WHERE id = ?", [id]);
  if (!t) throw new ApiError(404, "not_found", "Token not found");
  await ctx.storage.run("DELETE FROM mcp_tokens WHERE id = ?", [id]);
  await logActivity(ctx, actor, "revoke_token", `Revoked MCP token "${t.name}"`);
}

export async function listOAuthClients(ctx: Ctx) {
  return ctx.storage.all<{ id: string; name: string; created_at: string; last_used_at: string | null }>(
    "SELECT id, name, created_at, last_used_at FROM oauth_clients ORDER BY created_at DESC",
  );
}

export async function revokeOAuthClient(ctx: Ctx, id: string, actor: Actor) {
  const c = await ctx.storage.first<{ name: string }>("SELECT name FROM oauth_clients WHERE id = ?", [id]);
  if (!c) throw new ApiError(404, "not_found", "OAuth client not found");
  await ctx.storage.batch([
    { sql: "DELETE FROM oauth_tokens WHERE client_id = ?", params: [id] },
    { sql: "DELETE FROM oauth_codes WHERE client_id = ?", params: [id] },
    { sql: "DELETE FROM oauth_clients WHERE id = ?", params: [id] },
  ]);
  await logActivity(ctx, actor, "revoke_oauth_client", `Revoked OAuth client "${c.name}"`);
}

/** Records the latest MCP call for the app's "Test" button. */
export async function recordMcpCall(ctx: Ctx, client: string | null, tokenName: string | null) {
  const v = JSON.stringify({ at: ctx.now().toISOString(), client, token_name: tokenName });
  await ctx.storage.run("INSERT INTO settings (key, value) VALUES ('last_mcp_call', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [v]);
}

export async function lastMcpCall(ctx: Ctx, since: string | null) {
  const row = await ctx.storage.first<{ value: string }>("SELECT value FROM settings WHERE key = 'last_mcp_call'");
  const v = row ? (JSON.parse(row.value) as { at: string; client: string | null; token_name: string | null }) : null;
  if (!v || (since && v.at < since)) return { at: null };
  return v;
}
