import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Migration } from "./types";

export function readMigrationsFromDir(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}
