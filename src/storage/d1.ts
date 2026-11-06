import type { Param, Row, Stmt, Storage } from "./types";

export function d1Storage(db: D1Database): Storage {
  const prep = (sql: string, params: Param[] = []) => db.prepare(sql).bind(...params);
  return {
    async all<T = Row>(sql: string, params?: Param[]) {
      const r = await prep(sql, params).all<T>();
      return r.results ?? [];
    },
    async first<T = Row>(sql: string, params?: Param[]) {
      return (await prep(sql, params).first<T>()) ?? null;
    },
    async run(sql: string, params?: Param[]) {
      const r = await prep(sql, params).run();
      return { changes: r.meta?.changes ?? 0 };
    },
    async batch(stmts: Stmt[]) {
      if (stmts.length) await db.batch(stmts.map((s) => prep(s.sql, s.params)));
    },
  };
}
