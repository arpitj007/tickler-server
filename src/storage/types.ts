// Storage is a thin async SQL interface. Both runtimes speak the same SQLite dialect, so the
// queries live in src/core and run unchanged on D1 and better-sqlite3.

export type Param = string | number | null;
export type Row = Record<string, unknown>;
export interface Stmt {
  sql: string;
  params?: Param[];
}

export interface Storage {
  all<T = Row>(sql: string, params?: Param[]): Promise<T[]>;
  first<T = Row>(sql: string, params?: Param[]): Promise<T | null>;
  run(sql: string, params?: Param[]): Promise<{ changes: number }>;
  /** Runs all statements atomically (D1 batch / SQLite transaction). */
  batch(stmts: Stmt[]): Promise<void>;
}

export interface Migration {
  name: string; // file name, e.g. "0001_init.sql"
  sql: string;
}
