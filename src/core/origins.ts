import { z } from "zod";
import { BUMP, REV, type Ctx } from "./context";
import { uuid } from "./util";

export const CLIENTS = [
  "claude_code", "claude_code_web", "claude_app", "cursor", "chatgpt", "codex",
  "gemini_cli", "t3_code", "scheduled_task", "other",
] as const;
export type Client = (typeof CLIENTS)[number];

const s = (n: number) => z.string().trim().max(n).nullish();
export const originInputSchema = z.object({
  client: z.string().trim().max(40).describe(`One of: ${CLIENTS.join(", ")}`),
  session_id: s(200).describe("Your own session, chat or thread id, if you know it"),
  title: s(200).describe("Chat title, or the first 80 characters of the user's request"),
  open_url: s(2000).describe("A link that opens this chat or session, if you have one"),
  resume_command: s(1000).describe("Shell command that resumes a local session"),
  machine: s(200),
  cwd: s(1000),
  repo: s(500),
  branch: s(200),
  transcript_path: s(1000),
  parent_session_id: s(200).describe("Session id of the parent agent, for subagents and scheduled runs"),
});
export type OriginInput = z.infer<typeof originInputSchema>;

export interface OriginRow {
  id: string;
  client: string;
  session_id: string | null;
  title: string | null;
  open_url: string | null;
  resume_command: string | null;
  machine: string | null;
  cwd: string | null;
  repo: string | null;
  branch: string | null;
  transcript_path: string | null;
  parent_origin_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  rev: number;
}

export const ORIGIN_COLS =
  "id, client, session_id, title, open_url, resume_command, machine, cwd, repo, branch, transcript_path, parent_origin_id, first_seen_at, last_seen_at, rev";

export function normalizeClient(c: string | null | undefined): Client {
  const v = (c ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (CLIENTS as readonly string[]).includes(v) ? (v as Client) : "other";
}

const FIELDS = ["title", "open_url", "resume_command", "machine", "cwd", "repo", "branch", "transcript_path"] as const;

/**
 * Upsert on (client, session_id). Without a session id, one row per (client, title, token, UTC day)
 * so repeated calls from the same chat don't create a row each. Values already stored are kept
 * when the new call leaves them empty.
 */
export async function upsertOrigin(ctx: Ctx, input: OriginInput, tokenId: string | null): Promise<string> {
  const client = normalizeClient(input.client);
  const now = ctx.now().toISOString();
  const sid = input.session_id?.trim() || null;
  const key = sid ? `${client}:s:${sid}` : `${client}:t:${tokenId ?? "-"}:${now.slice(0, 10)}:${input.title ?? ""}`;
  let parentId: string | null = null;
  if (input.parent_session_id) {
    const p = await ctx.storage.first<{ id: string }>(
      "SELECT id FROM origins WHERE session_id = ? ORDER BY (client = ?) DESC, last_seen_at DESC LIMIT 1",
      [input.parent_session_id, client],
    );
    parentId = p?.id ?? (await upsertOrigin(ctx, { client, session_id: input.parent_session_id }, tokenId));
  }
  const vals = FIELDS.map((f) => (input[f] ? String(input[f]) : null));
  await ctx.storage.batch([
    BUMP,
    {
      sql: `INSERT INTO origins (id, origin_key, client, session_id, ${FIELDS.join(", ")}, parent_origin_id, first_seen_at, last_seen_at, rev)
            VALUES (?, ?, ?, ?, ${FIELDS.map(() => "?").join(", ")}, ?, ?, ?, ${REV})
            ON CONFLICT (origin_key) DO UPDATE SET
              ${FIELDS.map((f) => `${f} = COALESCE(excluded.${f}, ${f})`).join(", ")},
              parent_origin_id = COALESCE(excluded.parent_origin_id, parent_origin_id),
              last_seen_at = excluded.last_seen_at, rev = excluded.rev`,
      params: [uuid(), key, client, sid, ...vals, parentId, now, now],
    },
  ]);
  return (await ctx.storage.first<{ id: string }>("SELECT id FROM origins WHERE origin_key = ?", [key]))!.id;
}

export async function getOrigin(ctx: Ctx, id: string | null): Promise<OriginRow | null> {
  if (!id) return null;
  return ctx.storage.first<OriginRow>(`SELECT ${ORIGIN_COLS} FROM origins WHERE id = ?`, [id]);
}

export async function listOrigins(ctx: Ctx, f: { client?: string | null; project_id?: string | null; limit?: number }) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.client) where.push("client = ?"), params.push(f.client);
  if (f.project_id) {
    where.push("id IN (SELECT origin_id FROM entries WHERE project_id = ? UNION SELECT last_origin_id FROM entries WHERE project_id = ?)");
    params.push(f.project_id, f.project_id);
  }
  params.push(f.limit ?? 500);
  return ctx.storage.all<OriginRow>(
    `SELECT ${ORIGIN_COLS} FROM origins ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY last_seen_at DESC LIMIT ?`,
    params,
  );
}
