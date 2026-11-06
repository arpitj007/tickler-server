// Small helpers shared by the provider adapters. Runtime neutral: fetch, WebCrypto,
// TextEncoder, CompressionStream only (Cloudflare Workers and Node 22).

import type { Metric, MetricSnapshotInput, ProviderId } from "./types";

// ---------- dates (always UTC) ----------

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseYmd(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function monthOf(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthEnd(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
}

export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return monthOf(d);
}

/** Every YYYY-MM-DD from start to end inclusive. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = parseYmd(start); ymd(d) <= end; d = addDays(d, 1)) out.push(ymd(d));
  return out;
}

/**
 * The window every pull-based provider re-syncs: the current month so far plus enough
 * earlier days that the 7 day run rate works on the 1st of a month. Re-syncing a window
 * (instead of "since last sync") keeps sync idempotent and picks up late corrections.
 * `end` is today (UTC, partial day), `lastComplete` is yesterday.
 */
export function syncWindow(now: Date): { start: string; end: string; lastComplete: string } {
  const today = startOfUtcDay(now);
  const first = monthStart(monthOf(today));
  const weekAgo = ymd(addDays(today, -8));
  return { start: weekAgo < first ? weekAgo : first, end: ymd(today), lastComplete: ymd(addDays(today, -1)) };
}

// ---------- snapshots ----------

export function snap(
  provider: ProviderId,
  account: string,
  metric: Metric,
  unit: string,
  value: number,
  start: string,
  end: string = start,
  extra: { label?: string | null; source_latency?: string; raw?: unknown } = {},
): MetricSnapshotInput {
  return {
    provider,
    account,
    metric,
    unit,
    value: round(value),
    label: extra.label ?? null,
    period_start: start,
    period_end: end,
    source_latency: extra.source_latency,
    raw: extra.raw === undefined ? undefined : trimRaw(extra.raw),
  };
}

/** Total snapshot label: null for the base currency, "currency:XXX" for others (see src/money/summary.ts). */
export function currencyLabel(cur: string, base: string): string | null {
  return cur === base ? null : `currency:${cur}`;
}

export function round(n: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Keep `raw` small: cut long strings and arrays, cap depth. */
export function trimRaw(v: unknown, depth = 0): unknown {
  if (v === null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 300 ? `${v.slice(0, 300)}...` : v;
  if (depth > 4) return "[...]";
  if (Array.isArray(v)) {
    const head = v.slice(0, 10).map((x) => trimRaw(x, depth + 1));
    return v.length > 10 ? [...head, `[+${v.length - 10} more]`] : head;
  }
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 40)) out[k] = trimRaw(x, depth + 1);
    return out;
  }
  return undefined;
}

/** Add `value` to map[key]. */
export function bump(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

// ---------- HTTP ----------

export class ProviderError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

/** fetch + readable errors. Never includes credentials in messages. */
export async function request(
  fetchFn: typeof fetch,
  name: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    throw new ProviderError(`${name}: network error (${(e as Error).message})`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderError(`${name}: HTTP ${res.status} ${errorDetail(text)}`.trim(), res.status);
  }
  return res;
}

export async function requestJson<T = any>(
  fetchFn: typeof fetch,
  name: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await request(fetchFn, name, url, init);
  return (await res.json()) as T;
}

/** Pull a human message out of the usual error JSON shapes. */
export function errorDetail(text: string): string {
  try {
    const j = JSON.parse(text);
    if (j.__type) return `${String(j.__type).split("#").pop()}: ${j.Message ?? j.message ?? ""}`.slice(0, 200);
    const e = j.error ?? j.errors ?? j;
    if (typeof e === "string") return e.slice(0, 200);
    if (Array.isArray(e)) return String(e[0]?.detail ?? e[0]?.message ?? e[0]?.title ?? "").slice(0, 200);
    return String(e.message ?? e.detail ?? e.error_description ?? e.Message ?? j.message ?? j.__type ?? "").slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

/** Wrap a test() body: success message, or the error message with ok=false. */
export async function testWith(fn: () => Promise<string>): Promise<{ ok: boolean; message: string }> {
  try {
    return { ok: true, message: await fn() };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export function required(cfg: Record<string, string>, ...keys: string[]): boolean {
  return keys.every((k) => typeof cfg[k] === "string" && cfg[k].trim() !== "");
}

// ---------- encoding and crypto ----------

const enc = new TextEncoder();

/** Copy into a plain ArrayBuffer (WebCrypto and Blob typings want ArrayBuffer, not SharedArrayBuffer). */
export function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

export function utf8(s: string): Uint8Array {
  return enc.encode(s);
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", ab(bytes)));
}

export async function hmac(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw",
    ab(typeof key === "string" ? utf8(key) : key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, ab(utf8(data))));
}

/** Constant time compare of two equal length strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- compression and tables ----------

async function inflate(data: Uint8Array, format: "gzip" | "deflate-raw"): Promise<Uint8Array> {
  const stream = new Blob([ab(data)]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function gunzip(data: Uint8Array): Promise<Uint8Array> {
  return inflate(data, "gzip");
}

/** Minimal ZIP reader (stored and deflate entries), enough for Play Console report zips. */
export async function unzip(data: Uint8Array): Promise<{ name: string; data: Uint8Array }[]> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files: { name: string; data: Uint8Array }[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("bad zip directory");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(data.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = view.getUint16(local + 26, true);
    const lExtraLen = view.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const body = data.subarray(start, start + compSize);
    if (!name.endsWith("/")) {
      if (method === 0) files.push({ name, data: body });
      else if (method === 8) files.push({ name, data: await inflate(body, "deflate-raw") });
      else throw new Error(`unsupported zip method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** Decode text, dropping a UTF-8 or UTF-16 BOM (Play reports are sometimes UTF-16LE). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  return new TextDecoder().decode(bytes).replace(/^﻿/, "");
}

/** Parse CSV/TSV with quotes into objects keyed by header. */
export function parseTable(text: string, sep = ","): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export function num(s: string | number | undefined | null): number {
  if (typeof s === "number") return s;
  if (!s) return 0;
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Parse a credential that may be pasted with literal "\n" sequences. */
export function pem(s: string): string {
  return s.includes("\\n") ? s.replace(/\\n/g, "\n") : s;
}

/** Case-insensitive header lookup. */
export function header(headers: Record<string, string>, name: string): string | undefined {
  const n = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === n) return v;
  return undefined;
}
