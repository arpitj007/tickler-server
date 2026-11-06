// Cloudflare Workers runtime: D1 storage, Cron Triggers for the scheduler.
// https://developers.cloudflare.com/workers/configuration/cron-triggers/ (checked 2026-11-06)
import { createApp } from "./app";
import { d1Storage } from "./storage/d1";
import m0001 from "../migrations/0001_init.sql";
import m0002 from "../migrations/0002_provider_message.sql";

/** Keep in sync with migrations/ (test/migrations.test.ts checks it). */
export const MIGRATIONS = [
  { name: "0001_init.sql", sql: m0001 },
  { name: "0002_provider_message.sql", sql: m0002 },
];

export interface WorkerEnv {
  DB: D1Database;
  TICKLER_SECRET?: string;
  TICKLER_SERVER_NAME?: string;
  TICKLER_PUBLIC_URL?: string;
  TICKLER_CURRENCY?: string;
}

let built: ReturnType<typeof createApp> | null = null;
function get(env: WorkerEnv) {
  built ??= createApp({
    storage: d1Storage(env.DB),
    env: env as unknown as Record<string, unknown>,
    migrations: MIGRATIONS,
    getIp: (req) => req.headers.get("cf-connecting-ip") ?? undefined,
  });
  return built;
}

export default {
  fetch(req: Request, env: WorkerEnv, ctx: ExecutionContext) {
    return get(env).app.fetch(req, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext) {
    ctx.waitUntil(get(env).scheduled(controller.cron === "0 6 * * *" ? "daily" : "tick"));
  },
} satisfies ExportedHandler<WorkerEnv>;
