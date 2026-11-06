// Admin account (one per server), browser sessions and passkeys.
import { logActivity } from "./activity";
import type { Actor, Ctx } from "./context";
import { hashPassphrase, verifyPassphrase } from "./crypto";
import { b64url, randomBytes, randomToken, sha256hex, uuid } from "./util";

export const ADMIN: Actor = { type: "admin", id: "admin", name: "Admin" };
export const SESSION_COOKIE = "tickler_session";
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const MIN_PASSPHRASE = 10;

export interface AdminRow {
  id: number;
  passphrase_hash: string;
  webauthn_user_id: string;
  created_at: string;
  updated_at: string;
}

export async function getAdmin(ctx: Ctx): Promise<AdminRow | null> {
  return ctx.storage.first<AdminRow>("SELECT * FROM admin WHERE id = 1");
}

export async function createAdmin(ctx: Ctx, passphrase: string): Promise<boolean> {
  const now = ctx.now().toISOString();
  const hash = await hashPassphrase(passphrase);
  // id = 1 constraint: only the first claim wins.
  const r = await ctx.storage.run(
    "INSERT INTO admin (id, passphrase_hash, webauthn_user_id, created_at, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
    [hash, b64url(randomBytes(16)), now, now],
  );
  if (r.changes === 1) await logActivity(ctx, ADMIN, "create_admin", "Admin account created");
  return r.changes === 1;
}

export async function checkPassphrase(ctx: Ctx, passphrase: string): Promise<boolean> {
  const a = await getAdmin(ctx);
  return !!a && (await verifyPassphrase(passphrase, a.passphrase_hash));
}

export async function changePassphrase(ctx: Ctx, passphrase: string) {
  await ctx.storage.run("UPDATE admin SET passphrase_hash = ?, updated_at = ? WHERE id = 1", [await hashPassphrase(passphrase), ctx.now().toISOString()]);
  await ctx.storage.run("DELETE FROM sessions");
  await logActivity(ctx, ADMIN, "change_passphrase", "Passphrase changed; all sessions signed out");
}

export async function createSession(ctx: Ctx): Promise<string> {
  const token = randomToken("tks_");
  const now = ctx.now();
  await ctx.storage.run("INSERT INTO sessions (id_hash, created_at, expires_at) VALUES (?, ?, ?)", [
    await sha256hex(token),
    now.toISOString(),
    new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  ]);
  return token;
}

export async function validSession(ctx: Ctx, token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const row = await ctx.storage.first<{ expires_at: string }>("SELECT expires_at FROM sessions WHERE id_hash = ?", [await sha256hex(token)]);
  return !!row && Date.parse(row.expires_at) > ctx.now().getTime();
}

export async function destroySession(ctx: Ctx, token: string | undefined | null) {
  if (token) await ctx.storage.run("DELETE FROM sessions WHERE id_hash = ?", [await sha256hex(token)]);
}

// ---------- WebAuthn challenges (stored server side, 5 minutes)

export async function saveChallenge(ctx: Ctx, challenge: string, purpose: "register" | "login"): Promise<string> {
  const id = uuid();
  await ctx.storage.run("INSERT INTO challenges (id, challenge, purpose, expires_at) VALUES (?, ?, ?, ?)", [
    id,
    challenge,
    purpose,
    new Date(ctx.now().getTime() + 5 * 60_000).toISOString(),
  ]);
  return id;
}

export async function takeChallenge(ctx: Ctx, id: string | undefined, purpose: "register" | "login"): Promise<string | null> {
  if (!id) return null;
  const row = await ctx.storage.first<{ challenge: string; expires_at: string; purpose: string }>("SELECT * FROM challenges WHERE id = ?", [id]);
  await ctx.storage.run("DELETE FROM challenges WHERE id = ?", [id]);
  if (!row || row.purpose !== purpose || Date.parse(row.expires_at) <= ctx.now().getTime()) return null;
  return row.challenge;
}

export interface PasskeyRow {
  id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export async function listPasskeys(ctx: Ctx) {
  return ctx.storage.all<PasskeyRow>("SELECT * FROM passkeys ORDER BY created_at");
}
