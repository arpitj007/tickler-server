import Database from "better-sqlite3";
import type { Param, Row, Stmt, Storage } from "./types";

export function sqliteStorage(db: Database.Database): Storage {
  const cache = new Map<string, Database.Statement>();
  const prep = (sql: string) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  const tx = db.transaction((stmts: Stmt[]) => {
    for (const s of stmts) prep(s.sql).run(...(s.params ?? []));
  });
  return {
    async all<T = Row>(sql: string, params: Param[] = []) {
      return prep(sql).all(...params) as T[];
    },
    async first<T = Row>(sql: string, params: Param[] = []) {
      const s = prep(sql);
      return ((s.reader ? s.get(...params) : (s.run(...params), undefined)) as T | undefined) ?? null;
    },
    async run(sql: string, params: Param[] = []) {
      const s = prep(sql);
      if (s.reader) {
        s.all(...params); // e.g. UPDATE ... RETURNING
        return { changes: (prep("SELECT changes() AS c").get() as { c: number }).c };
      }
      return { changes: s.run(...params).changes };
    },
    async batch(stmts: Stmt[]) {
      tx(stmts);
    },
  };
}

export function openSqliteStorage(file: string): Storage {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  return sqliteStorage(db);
}
