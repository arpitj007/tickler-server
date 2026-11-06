import { z } from "zod";
import { logActivity } from "./activity";
import { BUMP, REV, type Actor, type Ctx } from "./context";
import { getProject } from "./projects";
import { isValidTimeZone, nextLocalMidnight, parseTimeInput, rruleError } from "./time";
import { ApiError, jsonParse, truncate, uuid } from "./util";

export const KINDS = ["task", "event", "deadline", "reminder", "scheduled_run", "follow_up", "launch", "renewal"] as const;
export const STATUSES = ["planned", "done", "skipped", "cancelled"] as const;
export const IMPORTANCES = ["normal", "important", "critical"] as const;
export const SOURCES = ["agent", "manual", "system"] as const;
export type Kind = (typeof KINDS)[number];
export type Status = (typeof STATUSES)[number];

export const MAX_FUTURE_MS = 2 * 366 * 24 * 3600_000; // "reject over 2 years out"

const link = z.object({ title: z.string().trim().max(200), url: z.string().trim().url().max(2000) });

/** Fields a writer may set. Times are strings here and normalized by normalizeTimes(). */
export const entryFieldsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  notes: z.string().max(20_000).nullish(),
  kind: z.enum(KINDS),
  start_at: z.string().max(40).nullish(),
  end_at: z.string().max(40).nullish(),
  all_day: z.boolean(),
  timezone: z.string().max(64),
  recurrence: z.string().max(500).nullish(),
  status: z.enum(STATUSES),
  importance: z.enum(IMPORTANCES),
  external_key: z.string().trim().min(1).max(200).nullish(),
  links: z.array(link).max(20),
  tags: z.array(z.string().trim().min(1).max(50)).max(20),
  source_ref: z.string().trim().max(2000).nullish(),
});
export type EntryFields = z.infer<typeof entryFieldsSchema>;
export type EntryPatch = Partial<EntryFields>;

export interface EntryRow {
  id: string;
  project_id: string;
  title: string;
  notes: string | null;
  kind: Kind;
  start_at: string | null;
  end_at: string | null;
  all_day: number;
  timezone: string;
  recurrence: string | null;
  status: Status;
  importance: string;
  source: string;
  origin_id: string | null;
  last_origin_id: string | null;
  origin_flagged: number;
  external_key: string | null;
  links: string;
  tags: string;
  source_ref: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  rev: number;
}

export function entryJson(r: EntryRow) {
  return {
    ...r,
    all_day: !!r.all_day,
    origin_flagged: !!r.origin_flagged,
    links: jsonParse<{ title: string; url: string }[]>(r.links, []),
    tags: jsonParse<string[]>(r.tags, []),
  };
}
export type Entry = ReturnType<typeof entryJson>;

export async function getEntry(ctx: Ctx, id: string): Promise<EntryRow | null> {
  return ctx.storage.first<EntryRow>("SELECT * FROM entries WHERE id = ?", [id]);
}

export async function getEntryByKey(ctx: Ctx, projectId: string, key: string): Promise<EntryRow | null> {
  return ctx.storage.first<EntryRow>("SELECT * FROM entries WHERE project_id = ? AND external_key = ?", [projectId, key]);
}

function invalid(fields: Record<string, string>): never {
  throw new ApiError(422, "validation_failed", Object.values(fields).join(" "), { fields });
}

/**
 * Merge `patch` over `cur` and validate the result: times parsed (UTC, offsets, wall time in the
 * entry's time zone, or dates for all day), not over 2 years out, end after start, undated only
 * for tasks, valid IANA zone and RRULE.
 */
export function mergeEntry(cur: EntryFields, patch: EntryPatch, now: Date): EntryFields {
  const next: EntryFields = { ...cur, ...stripUndefined(patch) };
  const errors: Record<string, string> = {};
  if (!isValidTimeZone(next.timezone)) errors.timezone = `Unknown time zone "${next.timezone}" (use an IANA name like Europe/Berlin).`;
  const tz = errors.timezone ? "UTC" : next.timezone;

  if (patch.start_at !== undefined && patch.start_at !== null) {
    const p = parseTimeInput(patch.start_at, tz);
    if (!p) errors.start_at = "start_at must be ISO 8601 (2026-11-06T09:00:00Z), a local time, or a date (YYYY-MM-DD).";
    else {
      next.start_at = p.at.toISOString();
      if (p.dateOnly) {
        next.all_day = true;
        if (patch.end_at === undefined && cur.end_at === null) next.end_at = null;
      }
    }
  }
  if (patch.end_at !== undefined && patch.end_at !== null) {
    const p = parseTimeInput(patch.end_at, tz);
    if (!p) errors.end_at = "end_at must be ISO 8601, a local time, or a date.";
    else next.end_at = (p.dateOnly && p.date ? nextLocalMidnight(p.date, tz) : p.at).toISOString();
  }
  if (next.start_at === null && next.kind !== "task") {
    errors.start_at = `start_at is required for kind "${next.kind}"; only tasks may be undated.`;
  }
  if (next.start_at === null) next.end_at = null;
  if (next.start_at && !errors.start_at) {
    const t = Date.parse(next.start_at);
    if (t - now.getTime() > MAX_FUTURE_MS) errors.start_at = "start_at is more than 2 years out.";
    if (next.end_at && Date.parse(next.end_at) < t) errors.end_at = "end_at is before start_at.";
  }
  if (next.recurrence) {
    next.recurrence = next.recurrence.trim().replace(/^RRULE:/i, "");
    const e = rruleError(next.recurrence);
    if (e) errors.recurrence = e;
    if (!next.start_at) errors.recurrence = "A recurring entry needs start_at.";
  }
  if (Object.keys(errors).length) invalid(errors);
  return next;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const DEFAULTS: EntryFields = {
  title: "",
  notes: null,
  kind: "task",
  start_at: null,
  end_at: null,
  all_day: false,
  timezone: "UTC",
  recurrence: null,
  status: "planned",
  importance: "normal",
  external_key: null,
  links: [],
  tags: [],
  source_ref: null,
};

export function rowToFields(r: EntryRow): EntryFields {
  const e = entryJson(r);
  return {
    title: e.title,
    notes: e.notes,
    kind: e.kind,
    start_at: e.start_at,
    end_at: e.end_at,
    all_day: e.all_day,
    timezone: e.timezone,
    recurrence: e.recurrence,
    status: e.status,
    importance: e.importance as EntryFields["importance"],
    external_key: e.external_key,
    links: e.links,
    tags: e.tags,
    source_ref: e.source_ref,
  };
}

export interface WriteMeta {
  actor: Actor;
  action: string;
  originId?: string | null;
  originFlagged?: boolean;
  source?: (typeof SOURCES)[number];
}

const COLS = [
  "title", "notes", "kind", "start_at", "end_at", "all_day", "timezone", "recurrence", "status",
  "importance", "external_key", "links", "tags", "source_ref",
] as const;

function colValues(f: EntryFields) {
  return [
    f.title, f.notes ?? null, f.kind, f.start_at ?? null, f.end_at ?? null, f.all_day ? 1 : 0, f.timezone,
    f.recurrence ?? null, f.status, f.importance, f.external_key ?? null, JSON.stringify(f.links ?? []),
    JSON.stringify(f.tags ?? []), f.source_ref ?? null,
  ];
}

/**
 * Create an entry, or update the existing one when (project, external_key) matches.
 * `id` lets the apps create ids offline; a repeated id returns the stored entry.
 */
export async function createEntry(
  ctx: Ctx,
  projectId: string,
  input: EntryPatch & { title: string },
  meta: WriteMeta,
  id?: string,
): Promise<{ entry: EntryRow; created: boolean }> {
  if (!(await getProject(ctx, projectId))) invalid({ project_id: "Unknown project." });
  if (id) {
    const existing = await getEntry(ctx, id);
    if (existing) return { entry: existing, created: false };
  }
  if (input.external_key) {
    const existing = await getEntryByKey(ctx, projectId, input.external_key);
    if (existing) {
      const { status: _s, ...rest } = input; // a re-run never reopens or completes
      const entry = await updateEntry(ctx, existing.id, rest, { ...meta, action: meta.action });
      return { entry, created: false };
    }
  }
  const now = ctx.now();
  const f = mergeEntry({ ...DEFAULTS, timezone: input.timezone ?? "UTC" }, input, now);
  const newId = id ?? uuid();
  const nowIso = now.toISOString();
  await ctx.storage.batch([
    BUMP,
    {
      sql: `INSERT INTO entries (id, project_id, ${COLS.join(", ")}, source, origin_id, last_origin_id, origin_flagged,
              completed_at, created_at, updated_at, rev)
            VALUES (?, ?, ${COLS.map(() => "?").join(", ")}, ?, ?, ?, ?, ?, ?, ?, ${REV})`,
      params: [
        newId, projectId, ...colValues(f), meta.source ?? "manual", meta.originId ?? null, meta.originId ?? null,
        meta.originFlagged ? 1 : 0, f.status === "done" ? nowIso : null, nowIso, nowIso,
      ],
    },
  ]);
  const entry = (await getEntry(ctx, newId))!;
  await logActivity(ctx, meta.actor, meta.action, `Created "${entry.title}"${f.start_at ? ` at ${f.start_at}` : ""}`, meta.originId ?? null);
  return { entry, created: true };
}

/** Partial update. Conflict rule: see checkConflict. */
export async function updateEntry(
  ctx: Ctx,
  id: string,
  patch: EntryPatch & { project_id?: string; base_updated_at?: string | null },
  meta: WriteMeta,
): Promise<EntryRow> {
  const cur = await getEntry(ctx, id);
  if (!cur) throw new ApiError(404, "not_found", "Entry not found");
  checkConflict(cur, patch.status, patch.base_updated_at);
  const { project_id, base_updated_at: _b, ...fieldsPatch } = patch;
  if (project_id && project_id !== cur.project_id && !(await getProject(ctx, project_id))) invalid({ project_id: "Unknown project." });
  const projectId = project_id ?? cur.project_id;
  if (fieldsPatch.external_key && fieldsPatch.external_key !== cur.external_key) {
    const clash = await getEntryByKey(ctx, projectId, fieldsPatch.external_key);
    if (clash && clash.id !== id) throw new ApiError(409, "conflict", "Another entry in this project has that external_key", { current: entryJson(clash) });
  }
  const now = ctx.now();
  const f = mergeEntry(rowToFields(cur), fieldsPatch, now);
  const completedAt = f.status === "done" ? (cur.status === "done" ? cur.completed_at : now.toISOString()) : null;
  const flagged = meta.originId ? 0 : meta.originFlagged ? 1 : cur.origin_flagged;
  await ctx.storage.batch([
    BUMP,
    {
      sql: `UPDATE entries SET project_id = ?, ${COLS.map((c) => `${c} = ?`).join(", ")},
              last_origin_id = COALESCE(?, last_origin_id), origin_flagged = ?, completed_at = ?, updated_at = ?, rev = ${REV}
            WHERE id = ?`,
      params: [projectId, ...colValues(f), meta.originId ?? null, flagged, completedAt, now.toISOString(), id],
    },
  ]);
  const entry = (await getEntry(ctx, id))!;
  await logActivity(ctx, meta.actor, meta.action, `Updated "${entry.title}": ${Object.keys(fieldsPatch).join(", ") || "no fields"}`, meta.originId ?? null);
  return entry;
}

/**
 * Last write wins, except a done entry is never set back to planned by a write whose
 * base_updated_at is older than the entry's completed_at (409 conflict with the current entry).
 */
export function checkConflict(cur: EntryRow, newStatus: string | undefined, base: string | null | undefined) {
  if (cur.status !== "done" || newStatus !== "planned" || !base || !cur.completed_at) return;
  if (Date.parse(base) < Date.parse(cur.completed_at)) {
    throw new ApiError(409, "conflict", "This entry was completed after your copy was loaded.", { current: entryJson(cur) });
  }
}

export async function completeEntry(
  ctx: Ctx,
  id: string,
  input: { status: Status; note?: string | null; base_updated_at?: string | null },
  meta: WriteMeta,
) {
  const cur = await getEntry(ctx, id);
  if (!cur) throw new ApiError(404, "not_found", "Entry not found");
  const notes = input.note ? truncate([cur.notes, `Note (${input.status}): ${input.note}`].filter(Boolean).join("\n\n"), 20_000) : undefined;
  return updateEntry(ctx, id, { status: input.status, notes, base_updated_at: input.base_updated_at }, meta);
}

export async function snoozeEntry(ctx: Ctx, id: string, startAt: string, meta: WriteMeta) {
  const cur = await getEntry(ctx, id);
  if (!cur) throw new ApiError(404, "not_found", "Entry not found");
  const p = parseTimeInput(startAt, cur.timezone);
  if (!p) invalid({ start_at: "start_at must be ISO 8601." });
  let end: string | null | undefined = undefined;
  if (cur.end_at && cur.start_at) end = new Date(p.at.getTime() + Date.parse(cur.end_at) - Date.parse(cur.start_at)).toISOString();
  return updateEntry(ctx, id, { start_at: p.at.toISOString(), end_at: end, status: cur.status === "done" ? undefined : "planned" }, meta);
}

export async function deleteEntry(ctx: Ctx, id: string, meta: WriteMeta) {
  const cur = await getEntry(ctx, id);
  if (!cur) throw new ApiError(404, "not_found", "Entry not found");
  if (cur.deleted_at) return cur;
  const now = ctx.now().toISOString();
  await ctx.storage.batch([
    BUMP,
    {
      sql: `UPDATE entries SET deleted_at = ?, updated_at = ?, last_origin_id = COALESCE(?, last_origin_id), rev = ${REV} WHERE id = ?`,
      params: [now, now, meta.originId ?? null, id],
    },
  ]);
  await logActivity(ctx, meta.actor, meta.action, `Deleted "${cur.title}"`, meta.originId ?? null);
  return (await getEntry(ctx, id))!;
}

export interface EntryFilter {
  from?: string | null;
  to?: string | null;
  project_id?: string | null;
  status?: string | null;
  importance?: string | null;
  q?: string | null;
  origin_id?: string | null;
  include_deleted?: boolean;
  limit: number;
}

/**
 * Entries overlapping [from, to) by start/end (recurrence not expanded; recurring entries that
 * started before `to` are included). Undated tasks are included when no range is given.
 */
export async function listEntries(ctx: Ctx, f: EntryFilter): Promise<EntryRow[]> {
  const where: string[] = [];
  const p: (string | number)[] = [];
  if (!f.include_deleted) where.push("deleted_at IS NULL");
  if (f.from) {
    where.push("(start_at IS NOT NULL AND (COALESCE(end_at, start_at) >= ? OR recurrence IS NOT NULL))");
    p.push(f.from);
  }
  if (f.to) {
    where.push("start_at IS NOT NULL AND start_at < ?");
    p.push(f.to);
  }
  if (f.project_id) where.push("project_id = ?"), p.push(f.project_id);
  if (f.status) {
    const st = f.status.split(",").filter(Boolean);
    where.push(`status IN (${st.map(() => "?").join(",")})`), p.push(...st);
  }
  if (f.importance) {
    const im = f.importance.split(",").filter(Boolean);
    where.push(`importance IN (${im.map(() => "?").join(",")})`), p.push(...im);
  }
  if (f.origin_id) where.push("(origin_id = ? OR last_origin_id = ?)"), p.push(f.origin_id, f.origin_id);
  if (f.q) {
    where.push("(title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR external_key = ?)");
    const like = `%${f.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    p.push(like, like, f.q);
  }
  p.push(f.limit);
  return ctx.storage.all<EntryRow>(
    `SELECT * FROM entries ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY start_at IS NULL, start_at, created_at LIMIT ?`,
    p,
  );
}
