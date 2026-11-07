// Durable Object SQLite storage: one database per Tickler Cloud customer server.
// https://developers.cloudflare.com/durable-objects/api/sql-storage/ (checked 2026-11-08)
// The API is synchronous; the Storage interface is async so the same core code runs on D1, Node
// SQLite and here unchanged.
import type { Param, Row, Stmt, Storage } from "./types";

export function durableStorage(storage: DurableObjectStorage): Storage {
  const rows = (sql: string, params: Param[] = []) => storage.sql.exec(sql, ...params).toArray();
  return {
    async all<T = Row>(sql: string, params?: Param[]) {
      return rows(sql, params) as T[];
    },
    async first<T = Row>(sql: string, params?: Param[]) {
      return (rows(sql, params)[0] as T | undefined) ?? null;
    },
    async run(sql: string, params?: Param[]) {
      // rowsWritten also counts index updates, so ask SQLite for the number of changed rows.
      return storage.transactionSync(() => {
        rows(sql, params);
        return { changes: Number(rows("SELECT changes() AS n")[0]?.n ?? 0) };
      });
    },
    async batch(stmts: Stmt[]) {
      storage.transactionSync(() => {
        for (const s of stmts) rows(s.sql, s.params);
      });
    },
  };
}
