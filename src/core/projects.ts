import { z } from "zod";
import { logActivity } from "./activity";
import { BUMP, REV, type Actor, type Ctx } from "./context";
import { ApiError, slugify, uuid } from "./util";

export interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  color: string;
  icon: string;
  archived: number;
  created_at: string;
  updated_at: string;
  rev: number;
}

const PALETTE = ["#5B5BD6", "#E5484D", "#30A46C", "#F5A524", "#0090FF", "#8E4EC6", "#D6409F", "#12A594"];

export const projectCreateSchema = z.object({
  id: z.string().uuid().optional(), // apps may create projects offline
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  icon: z.string().trim().min(1).max(60).optional(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/).optional(),
});
export const projectPatchSchema = projectCreateSchema.omit({ id: true }).partial().extend({ archived: z.boolean().optional() });

export function projectJson(r: ProjectRow) {
  return { ...r, archived: !!r.archived };
}

export async function getProject(ctx: Ctx, id: string): Promise<ProjectRow | null> {
  return ctx.storage.first<ProjectRow>("SELECT * FROM projects WHERE id = ?", [id]);
}

export async function listProjects(ctx: Ctx, includeArchived: boolean) {
  return ctx.storage.all<ProjectRow>(
    `SELECT * FROM projects ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY name COLLATE NOCASE`,
  );
}

/** Find by id, slug or (case-insensitive) name. */
export async function findProject(ctx: Ctx, ref: string): Promise<ProjectRow | null> {
  const r = ref.trim();
  return ctx.storage.first<ProjectRow>(
    "SELECT * FROM projects WHERE id = ? OR slug = ? OR name = ? COLLATE NOCASE ORDER BY archived LIMIT 1",
    [r, slugify(r) === r ? r : "\u0000", r],
  );
}

export async function createProject(ctx: Ctx, input: z.infer<typeof projectCreateSchema>, actor: Actor, action = "create_project") {
  if (input.id) {
    const existing = await getProject(ctx, input.id);
    if (existing) return existing; // retried offline create
  }
  const now = ctx.now().toISOString();
  let slug = input.slug ?? slugify(input.name);
  if (input.slug && (await ctx.storage.first("SELECT 1 FROM projects WHERE slug = ?", [slug]))) {
    throw new ApiError(409, "conflict", `Slug "${slug}" is taken`);
  }
  for (let i = 2; await ctx.storage.first("SELECT 1 FROM projects WHERE slug = ?", [slug]); i++) {
    slug = `${slugify(input.name).slice(0, 55)}-${i}`;
  }
  const count = (await ctx.storage.first<{ n: number }>("SELECT COUNT(*) AS n FROM projects"))?.n ?? 0;
  const id = input.id ?? uuid();
  await ctx.storage.batch([
    BUMP,
    {
      sql: `INSERT INTO projects (id, name, slug, color, icon, archived, created_at, updated_at, rev)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, ${REV})`,
      params: [id, input.name, slug, input.color ?? PALETTE[count % PALETTE.length]!, input.icon ?? "folder", now, now],
    },
  ]);
  await logActivity(ctx, actor, action, `Project "${input.name}"`);
  return (await getProject(ctx, id))!;
}

/** Resolve a project reference from an agent; create it if it doesn't exist. Archived projects are unarchived. */
export async function resolveOrCreateProject(ctx: Ctx, ref: string, actor: Actor): Promise<ProjectRow> {
  const found = await findProject(ctx, ref);
  if (found) {
    if (found.archived) return updateProject(ctx, found.id, { archived: false }, actor);
    return found;
  }
  return createProject(ctx, { name: ref.trim().slice(0, 80) }, actor);
}

export async function updateProject(ctx: Ctx, id: string, patch: z.infer<typeof projectPatchSchema>, actor: Actor, action = "update_project") {
  const cur = await getProject(ctx, id);
  if (!cur) throw new ApiError(404, "not_found", "Project not found");
  if (patch.slug && patch.slug !== cur.slug && (await ctx.storage.first("SELECT 1 FROM projects WHERE slug = ?", [patch.slug]))) {
    throw new ApiError(409, "conflict", `Slug "${patch.slug}" is taken`);
  }
  const next = {
    name: patch.name ?? cur.name,
    slug: patch.slug ?? cur.slug,
    color: patch.color ?? cur.color,
    icon: patch.icon ?? cur.icon,
    archived: patch.archived === undefined ? cur.archived : patch.archived ? 1 : 0,
  };
  await ctx.storage.batch([
    BUMP,
    {
      sql: `UPDATE projects SET name = ?, slug = ?, color = ?, icon = ?, archived = ?, updated_at = ?, rev = ${REV} WHERE id = ?`,
      params: [next.name, next.slug, next.color, next.icon, next.archived, ctx.now().toISOString(), id],
    },
  ]);
  await logActivity(ctx, actor, action, `Project "${next.name}"${patch.archived ? " archived" : ""}`);
  return (await getProject(ctx, id))!;
}
