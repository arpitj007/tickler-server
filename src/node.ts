// Docker / Node runtime: SQLite file in $TICKLER_DATA_DIR (default /data), node-cron, port 8787.
import { serve, type HttpBindings } from "@hono/node-server";
import cron from "node-cron";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { b64url, randomBytes } from "./core/util";
import { readMigrationsFromDir } from "./storage/migrationsFs";
import { openSqliteStorage } from "./storage/sqlite";
import { migrate } from "./storage/migrate";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.TICKLER_DATA_DIR ?? "/data";
mkdirSync(dataDir, { recursive: true });

/** TICKLER_SECRET from the environment, or generated once and kept in the data dir. */
function secret(): string {
  if (process.env.TICKLER_SECRET?.trim()) return process.env.TICKLER_SECRET.trim();
  const file = join(dataDir, "secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const s = b64url(randomBytes(32));
  writeFileSync(file, s + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  console.warn(
    `\nTICKLER_SECRET was not set, so one was generated and saved to ${file}.\n` +
      `You need it once, to claim this server on /setup:\n\n    ${s}\n\n` +
      `Keep the data volume (losing the secret makes stored provider keys unreadable).\n`,
  );
  return s;
}

const migrationsDir = process.env.TICKLER_MIGRATIONS_DIR ?? [resolve(here, "../migrations"), resolve(here, "../../migrations")].find(existsSync)!;
const storage = openSqliteStorage(join(dataDir, "tickler.sqlite"));

// `node dist/node.js reset-admin` (or `npm run reset-admin`): forget the admin passphrase and
// passkeys, so /setup can be claimed again with TICKLER_SECRET. Data and devices stay.
if (process.argv[2] === "reset-admin") {
  await migrate(storage, readMigrationsFromDir(migrationsDir));
  await storage.batch([{ sql: "DELETE FROM admin" }, { sql: "DELETE FROM passkeys" }, { sql: "DELETE FROM sessions" }]);
  console.log("Admin reset. Open /setup and claim the server again with your TICKLER_SECRET.");
  process.exit(0);
}

const { app, scheduled } = createApp({
  storage,
  env: { ...process.env, TICKLER_SECRET: secret() },
  migrations: readMigrationsFromDir(migrationsDir),
  getIp: (_req, env) => (env as HttpBindings | undefined)?.incoming?.socket?.remoteAddress,
});

const run = (kind: "tick" | "daily") => () =>
  scheduled(kind)
    .then((r) => {
      if (r && Object.keys(r).length) console.log(`[${kind}]`, JSON.stringify(r));
    })
    .catch((e) => console.error(`[${kind}] failed`, e));
cron.schedule("*/15 * * * *", run("tick"), { timezone: "UTC" });
cron.schedule("0 6 * * *", run("daily"), { timezone: "UTC" });
setTimeout(run("tick"), 5_000); // first sync shortly after start

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "0.0.0.0" }, (i) =>
  console.log(`Tickler listening on http://localhost:${i.port} (data: ${dataDir}). Open /setup to start.`),
);

const stop = () => {
  server.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
