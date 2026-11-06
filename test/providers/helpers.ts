import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SyncContext } from "../../src/providers/types";

export const NOW = new Date("2026-11-06T12:00:00Z");
const FIXTURES = join(__dirname, "..", "fixtures", "providers");

export function fixture(path: string): string {
  return readFileSync(join(FIXTURES, path), "utf8");
}

export function fixtureBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, path)));
}

export function json(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export type Route = [RegExp | string, (url: string, init: RequestInit) => Response | Promise<Response>];

/** A fetch that answers from routes (first match wins) and records every call. */
export function mockFetch(routes: Route[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    for (const [m, h] of routes) {
      if (typeof m === "string" ? url.includes(m) : m.test(url)) return h(url, init);
    }
    return json({ error: { message: `no route for ${url}` } }, 404);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export function ctx(fetchFn: typeof fetch, now = NOW): SyncContext {
  return { now, fetch: fetchFn, lastSyncAt: null, currency: "USD" };
}

export function headerOf(init: RequestInit, name: string): string | undefined {
  const h = init.headers as Record<string, string> | undefined;
  if (!h) return undefined;
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === name.toLowerCase()) return v;
  return undefined;
}
