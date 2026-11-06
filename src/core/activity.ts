import type { Actor, Ctx } from "./context";
import { truncate, uuid } from "./util";

export async function logActivity(ctx: Ctx, actor: Actor, action: string, summary: string, originId: string | null = null) {
  await ctx.storage.run(
    "INSERT INTO activity (id, at, actor_type, actor_id, actor_name, origin_id, action, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [uuid(), ctx.now().toISOString(), actor.type, actor.id, actor.name, originId, action, truncate(summary, 300)],
  );
}

export async function listActivity(ctx: Ctx, before: string | null, limit: number) {
  return ctx.storage.all(
    `SELECT id, at, actor_type, actor_id, actor_name, origin_id, action, summary FROM activity
     WHERE (? IS NULL OR at < ?) ORDER BY at DESC LIMIT ?`,
    [before, before, limit],
  );
}
