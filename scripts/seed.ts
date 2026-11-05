// Demo data.
//   npm run seed -- generate              writes seed/demo-changes.json (deterministic)
//   npm run seed -- load [--db <file>]    loads it, placeholders resolved to now, into a SQLite DB
//                                         (default $TICKLER_DATA_DIR/tickler.sqlite, or ./data/tickler.sqlite)
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDemo, resolveDemo } from "./seed-data.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seedFile = join(root, "seed", "demo-changes.json");

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "generate") {
    mkdirSync(dirname(seedFile), { recursive: true });
    writeFileSync(seedFile, JSON.stringify(generateDemo(), null, 2) + "\n");
    console.log(`wrote ${seedFile}`);
    return;
  }
  if (cmd === "load") {
    const dbIdx = rest.indexOf("--db");
    const dataDir = process.env.TICKLER_DATA_DIR ?? join(root, "data");
    const dbPath = dbIdx >= 0 ? rest[dbIdx + 1]! : join(dataDir, "tickler.sqlite");
    mkdirSync(dirname(dbPath), { recursive: true });
    const { openSqliteStorage } = await import("../src/storage/sqlite.ts");
    const { migrate } = await import("../src/storage/migrate.ts");
    const { readMigrationsFromDir } = await import("../src/storage/migrationsFs.ts");
    const { loadDemo } = await import("../src/core/demo.ts");
    const storage = openSqliteStorage(dbPath);
    await migrate(storage, readMigrationsFromDir(join(root, "migrations")));
    const doc = resolveDemo(JSON.parse(readFileSync(seedFile, "utf8")));
    const counts = await loadDemo(storage, doc);
    console.log(`loaded demo data into ${dbPath}:`, counts);
    return;
  }
  console.log("usage: tsx scripts/seed.ts generate | load [--db <file>]");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
