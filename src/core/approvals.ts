// Approve an OAuth connector (Claude apps, ChatGPT, `codex mcp login`) from the paired phone instead of
// signing in on the server. The waiting browser page holds a secret only it knows; the phone sees the
// request and a two-digit number to match against the page, then allows or denies it.
import { logActivity } from "./activity";
import type { Actor, Ctx } from "./context";
import { ApiError, randomToken, sha256hex, uuid } from "./util";

export const APPROVAL_TTL_MS = 10 * 60_000;

interface ApprovalRow {
  id: string;
  browser_hash: string;
  client_id: string;
  params: string;
  status: "pending" | "allowed" | "denied" | "used";
  created_at: string;
  expires_at: string;
}

export interface ApprovalParams {
  auth: Record<string, unknown> & { redirect_uri: string };
  client_name: string;
  match: string;
}

export async function createApproval(ctx: Ctx, clientId: string, params: ApprovalParams) {
  const now = ctx.now();
  const id = uuid();
  const secret = randomToken("tkb_");
  await ctx.storage.run("DELETE FROM oauth_approvals WHERE expires_at < ?", [now.toISOString()]);
  await ctx.storage.run(
    "INSERT INTO oauth_approvals (id, browser_hash, client_id, params, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, await sha256hex(secret), clientId, JSON.stringify(params), now.toISOString(), new Date(now.getTime() + APPROVAL_TTL_MS).toISOString()],
  );
  return { id, secret };
}

const expired = (ctx: Ctx, r: ApprovalRow) => Date.parse(r.expires_at) <= ctx.now().getTime();

/** For the waiting browser: only with its secret. */
export async function approvalForBrowser(ctx: Ctx, id: string, secret: string) {
  const r = await ctx.storage.first<ApprovalRow>("SELECT * FROM oauth_approvals WHERE id = ?", [id]);
  if (!r || r.browser_hash !== (await sha256hex(secret))) return null;
  const status = r.status === "pending" && expired(ctx, r) ? "expired" : r.status;
  return { status, clientId: r.client_id, params: JSON.parse(r.params) as ApprovalParams };
}

/** Single use: flips allowed to used, so one approval yields one authorization code. */
export async function useApproval(ctx: Ctx, id: string) {
  const r = await ctx.storage.run("UPDATE oauth_approvals SET status = 'used' WHERE id = ? AND status = 'allowed'", [id]);
  return r.changes === 1;
}

export async function pendingApprovals(ctx: Ctx) {
  const rows = await ctx.storage.all<ApprovalRow>(
    "SELECT * FROM oauth_approvals WHERE status = 'pending' AND expires_at > ? ORDER BY created_at DESC",
    [ctx.now().toISOString()],
  );
  return rows.map((r) => {
    const p = JSON.parse(r.params) as ApprovalParams;
    let host = p.auth.redirect_uri;
    try {
      host = new URL(p.auth.redirect_uri).host || host;
    } catch {}
    return { id: r.id, client_name: p.client_name, redirect_host: host, match: p.match, created_at: r.created_at, expires_at: r.expires_at };
  });
}

export async function decideApproval(ctx: Ctx, id: string, allow: boolean, actor: Actor) {
  const r = await ctx.storage.first<ApprovalRow>("SELECT * FROM oauth_approvals WHERE id = ?", [id]);
  if (!r || r.status !== "pending" || expired(ctx, r)) throw new ApiError(404, "not_found", "This request expired. Try connecting again.");
  await ctx.storage.run("UPDATE oauth_approvals SET status = ? WHERE id = ? AND status = 'pending'", [allow ? "allowed" : "denied", id]);
  const name = (JSON.parse(r.params) as ApprovalParams).client_name;
  await logActivity(ctx, actor, allow ? "oauth_approve" : "oauth_deny", `${allow ? "Allowed" : "Denied"} "${name}" from the phone`);
}
