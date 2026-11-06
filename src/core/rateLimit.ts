import type { Ctx } from "./context";
import { ApiError } from "./util";

/** Fixed-window counter in storage. Throws 429 rate_limited when over `max` in the window. */
export async function rateLimit(ctx: Ctx, key: string, max: number, windowSeconds: number): Promise<void> {
  const nowS = Math.floor(ctx.now().getTime() / 1000);
  const window = nowS - (nowS % windowSeconds); // window start, epoch seconds
  const row = await ctx.storage.first<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count`,
    [key, window],
  );
  if ((row?.count ?? 0) > max) {
    throw new ApiError(429, "rate_limited", `Too many requests. Try again in ${windowSeconds} seconds.`, {
      retry_after: windowSeconds,
    });
  }
}
