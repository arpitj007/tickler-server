// SQLite file storage for the Node runtime.
//
// Default driver: node:sqlite (built into Node 22.13+; no native addon to compile, so the Docker
// image stays small). better-sqlite3 is supported with TICKLER_SQLITE_DRIVER=better-sqlite3.
// Note: better-sqlite3 13.0.3 segfaulted on the owner's macOS (Darwin 27) even when built from
// source on 2026-11-06, which is why node:sqlite is the default.
import { createRequire } from "node:module";
import type { Param, Row, Stmt, Storage } from "./types";

interface AnyStatement {
  all(...p: Param[]): unknown[];
  run(...p: Param[]): { changes: number | bigint };
  reader?: boolean;
}
interface AnyDb {
  prepare(sql: string): AnyStatement;
  exec(sql: string): unknown;
}

export function sqliteStorage(db: AnyDb): Storage {
  const cache = new Map<string, AnyStatement>();
  const prep = (sql: string) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = db.prepare(sql)));
    return s;
  };
  const changes = () => Number((prep("SELECT changes() AS c").all()[0] as { c: number }).c);
  const run = (sql: string, params: Param[] = []) => {
    const s = prep(sql);
    if (s.reader) {
      s.all(...params); // better-sqlite3 refuses run() on statements that return rows
      return { changes: changes() };
    }
    return { changes: Number(s.run(...params).changes) };
  };
  return {
    async all<T = Row>(sql: string, params: Param[] = []) {
      return prep(sql).all(...params) as T[];
    },
    async first<T = Row>(sql: string, params: Param[] = []) {
      return ((prep(sql).all(...params)[0] as T | undefined) ?? null) as T | null;
    },
    async run(sql: string, params?: Param[]) {
      return run(sql, params);
    },
    async batch(stmts: Stmt[]) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const s of stmts) run(s.sql, s.params);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

const require = createRequire(import.meta.url);

export function openSqliteDb(file: string, driver = process.env.TICKLER_SQLITE_DRIVER ?? "node"): AnyDb {
  let db: AnyDb;
  if (driver === "better-sqlite3") {
    const Database = require("better-sqlite3") as new (f: string) => AnyDb;
    db = new Database(file);
  } else {
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (f: string) => AnyDb };
    db = new DatabaseSync(file);
  }
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function openSqliteStorage(file: string): Storage {
  return sqliteStorage(openSqliteDb(file));
}
