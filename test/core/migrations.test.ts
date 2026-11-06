import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate, splitSql } from "../../src/storage/migrate";
import { readMigrationsFromDir } from "../../src/storage/migrationsFs";
import { openSqliteStorage } from "../../src/storage/sqlite";
import { readFileSync } from "node:fs";

const dir = join(__dirname, "../../migrations");

describe("migrations", () => {
  it("apply once, record in d1_migrations like wrangler", async () => {
    const s = openSqliteStorage(":memory:");
    const m = readMigrationsFromDir(dir);
    expect(await migrate(s, m)).toEqual(m.map((x) => x.name));
    expect(await migrate(s, m)).toEqual([]);
    const rows = await s.all<{ name: string }>("SELECT name FROM d1_migrations ORDER BY id");
    expect(rows.map((r) => r.name)).toEqual(m.map((x) => x.name));
    expect(splitSql("-- c\nCREATE TABLE a (x INT);\nCREATE TABLE b (y INT);\n")).toHaveLength(2);
  });

  it("the Worker bundles every migration file", () => {
    const src = readFileSync(join(__dirname, "../../src/worker.ts"), "utf8");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql"))) expect(src).toContain(`name: "${f}"`);
  });
});
