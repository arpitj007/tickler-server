import type { Actor, Ctx } from "./context";
import { sha256hex } from "./util";

export interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string | null;
}
export interface McpTokenRow {
  id: string;
  name: string;
  token_hash: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
}

export interface Principal {
  actor: Actor;
  /** For devices: the device row. */
  device?: DeviceRow;
  scopes: string[];
}

export function bearer(header: string | undefined | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1]! : null;
}

const TOUCH_MS = 5 * 60_000;
const stale = (at: string | null, now: Date) => !at || now.getTime() - Date.parse(at) > TOUCH_MS;

/** Resolve a bearer token of any kind. `resource` is the canonical MCP URL for OAuth audience checks. */
export async function authenticate(ctx: Ctx, token: string | null, resource?: string): Promise<Principal | null> {
  if (!token) return null;
  const now = ctx.now();
  const hash = await sha256hex(token);
  if (token.startsWith("tkd_")) {
    const d = await ctx.storage.first<DeviceRow>("SELECT * FROM devices WHERE token_hash = ?", [hash]);
    if (!d) return null;
    if (stale(d.last_seen_at, now)) await ctx.storage.run("UPDATE devices SET last_seen_at = ? WHERE id = ?", [now.toISOString(), d.id]);
    return { actor: { type: "device", id: d.id, name: d.name }, device: d, scopes: ["api", "mcp"] };
  }
  if (token.startsWith("tkm_")) {
    const t = await ctx.storage.first<McpTokenRow>("SELECT * FROM mcp_tokens WHERE token_hash = ?", [hash]);
    if (!t) return null;
    if (stale(t.last_used_at, now)) await ctx.storage.run("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?", [now.toISOString(), t.id]);
    return { actor: { type: "mcp_token", id: t.id, name: t.name }, scopes: JSON.parse(t.scopes) as string[] };
  }
  if (token.startsWith("tko_")) {
    const t = await ctx.storage.first<{ client_id: string; scope: string; resource: string | null; expires_at: string; name: string; last_used_at: string | null }>(
      `SELECT t.client_id, t.scope, t.resource, t.expires_at, c.name, c.last_used_at FROM oauth_tokens t
       JOIN oauth_clients c ON c.id = t.client_id
       WHERE t.token_hash = ? AND t.kind = 'access' AND t.revoked_at IS NULL`,
      [hash],
    );
    if (!t || Date.parse(t.expires_at) <= now.getTime()) return null;
    if (resource && t.resource && !sameResource(t.resource, resource)) return null;
    if (stale(t.last_used_at, now)) await ctx.storage.run("UPDATE oauth_clients SET last_used_at = ? WHERE id = ?", [now.toISOString(), t.client_id]);
    return { actor: { type: "oauth_client", id: t.client_id, name: t.name }, scopes: t.scope.split(" ") };
  }
  return null;
}

/** Tokens issued for https://host or https://host/mcp are both accepted at /mcp. */
export function sameResource(tokenResource: string, mcpUrl: string): boolean {
  const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();
  const a = norm(tokenResource);
  const b = norm(mcpUrl);
  return a === b || a === b.replace(/\/mcp$/, "");
}
