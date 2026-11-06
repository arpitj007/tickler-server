import type { Ctx } from "./context";
import { getChanges } from "./changes";
import { listActivity } from "./activity";
import { VERSION } from "./util";

/** Everything as one JSON document, no secrets (no token hashes, no provider credentials). */
export async function exportAll(ctx: Ctx) {
  const data = await getChanges(ctx, 0, 1_000_000);
  delete (data as { cursor?: string }).cursor;
  delete (data as { has_more?: boolean }).has_more;
  return {
    exported_at: ctx.now().toISOString(),
    server: { name: ctx.config.serverName, version: VERSION },
    ...data,
    activity: await listActivity(ctx, null, 10_000),
  };
}
