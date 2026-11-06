import type { Migration, Storage } from "./types";

const CREATE = `CREATE TABLE IF NOT EXISTS d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`; // same table wrangler d1 migrations uses, so both runners agree

/** Split a migration file into statements: drop comment lines, split on ";" at end of line. */
export function splitSql(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Applies pending migrations in name order. Safe to call on every cold start. */
export async function migrate(storage: Storage, migrations: Migration[]): Promise<string[]> {
  await storage.run(CREATE);
  const applied = new Set((await storage.all<{ name: string }>("SELECT name FROM d1_migrations")).map((r) => r.name));
  const done: string[] = [];
  for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (applied.has(m.name)) continue;
    try {
      await storage.batch([
        ...splitSql(m.sql).map((sql) => ({ sql })),
        { sql: "INSERT INTO d1_migrations (name) VALUES (?)", params: [m.name] },
      ]);
      done.push(m.name);
    } catch (e) {
      // Another instance may have applied it concurrently.
      const again = await storage.first("SELECT name FROM d1_migrations WHERE name = ?", [m.name]);
      if (!again) throw e;
    }
  }
  return done;
}
