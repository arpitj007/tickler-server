// Cloudflare Workers Paid plan prices used to turn usage into cost.
// Prices as of 2026-11-06, from:
//   https://developers.cloudflare.com/workers/platform/pricing/
//   https://developers.cloudflare.com/d1/platform/pricing/
//   https://developers.cloudflare.com/r2/pricing/
//   https://developers.cloudflare.com/kv/platform/pricing/
// Update the table and the date together when Cloudflare changes prices.

export const PRICES_AS_OF = "2026-11-06";
export const CURRENCY = "USD";

/** Workers Paid plan base fee per month. */
export const BASE_FEE = 5;

export interface PriceLine {
  metric: string; // internal usage key
  product: "Workers" | "D1" | "R2" | "KV";
  label: string;
  unit: string; // unit of the usage value
  /** Included per month on Workers Paid (R2 free tier applies on any plan). */
  included: number;
  /** USD per `per` units beyond the included amount. */
  price: number;
  per: number;
  /** counter: summed over the month. gauge: a level (storage), billed per month on the average. */
  kind: "counter" | "gauge";
}

export const PRICES: PriceLine[] = [
  { metric: "workers_requests", product: "Workers", label: "Workers requests", unit: "requests", included: 10_000_000, price: 0.3, per: 1_000_000, kind: "counter" },
  { metric: "workers_cpu_ms", product: "Workers", label: "Workers CPU time", unit: "cpu_ms", included: 30_000_000, price: 0.02, per: 1_000_000, kind: "counter" },
  { metric: "d1_rows_read", product: "D1", label: "D1 rows read", unit: "rows", included: 25_000_000_000, price: 0.001, per: 1_000_000, kind: "counter" },
  { metric: "d1_rows_written", product: "D1", label: "D1 rows written", unit: "rows", included: 50_000_000, price: 1.0, per: 1_000_000, kind: "counter" },
  { metric: "d1_storage_gb", product: "D1", label: "D1 storage", unit: "GB", included: 5, price: 0.75, per: 1, kind: "gauge" },
  { metric: "r2_class_a", product: "R2", label: "R2 Class A operations", unit: "requests", included: 1_000_000, price: 4.5, per: 1_000_000, kind: "counter" },
  { metric: "r2_class_b", product: "R2", label: "R2 Class B operations", unit: "requests", included: 10_000_000, price: 0.36, per: 1_000_000, kind: "counter" },
  { metric: "r2_storage_gb", product: "R2", label: "R2 storage (Standard)", unit: "GB", included: 10, price: 0.015, per: 1, kind: "gauge" },
  { metric: "kv_reads", product: "KV", label: "KV reads", unit: "requests", included: 10_000_000, price: 0.5, per: 1_000_000, kind: "counter" },
  { metric: "kv_writes", product: "KV", label: "KV writes, deletes and lists", unit: "requests", included: 1_000_000, price: 5.0, per: 1_000_000, kind: "counter" },
];

// R2 operation classes (https://developers.cloudflare.com/r2/pricing/). Deletes and aborts are free.
export const R2_CLASS_B = new Set(["HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration"]);
export const R2_FREE = new Set(["DeleteObject", "DeleteObjects", "DeleteBucket", "AbortMultipartUpload"]);
// Everything else counts as Class A (the more expensive class, so budgets err on the safe side).

/** Cost of one month's usage of one line (no base fee). */
export function lineCost(line: PriceLine, monthlyUsage: number): number {
  return (Math.max(0, monthlyUsage - line.included) / line.per) * line.price;
}
