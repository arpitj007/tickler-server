// Shared contract between the money adapters (src/providers, src/money) and the server core.

export type ProviderId =
  | "app_store"
  | "google_play"
  | "amazon_appstore"
  | "stripe"
  | "cloudflare"
  | "google_cloud"
  | "aws"
  | "anthropic"
  | "openai"
  | "github"
  | "manual";

export type Metric = "revenue" | "proceeds" | "units" | "cost" | "usage" | "forecast";

/** A snapshot before storage assigns id, rev and fetched_at. Idempotent on
 *  (provider, account, metric, label, period_start, period_end): re-syncs replace the value. */
export interface MetricSnapshotInput {
  provider: ProviderId;
  account: string;
  metric: Metric;
  unit: string; // ISO 4217 currency code, or "tokens", "requests", "minutes", "units"...
  value: number;
  label?: string | null; // e.g. model name, service name, product id
  period_start: string; // YYYY-MM-DD
  period_end: string; // YYYY-MM-DD (inclusive)
  source_latency?: string; // e.g. "~1 day"
  raw?: unknown; // trimmed provider JSON, pruned after 90 days
}

export type SalesEventType =
  | "purchase"
  | "trial_started"
  | "subscribed"
  | "renewed"
  | "refunded"
  | "cancelled"
  | "billing_issue";

export interface SalesEventInput {
  store: "app_store" | "google_play" | "amazon_appstore" | "stripe";
  /** Store's own id for the event, used to dedupe webhook retries. */
  external_id: string;
  type: SalesEventType;
  product_id: string | null;
  price: number | null;
  currency: string | null;
  country: string | null;
  occurred_at: string; // ISO UTC
  raw?: unknown;
}

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  multiline?: boolean; // e.g. .p8 keys, service account JSON
  optional?: boolean;
  help?: string;
}

export interface SyncContext {
  now: Date;
  fetch: typeof fetch;
  /** Last successful sync, if any, to allow incremental pulls. */
  lastSyncAt: Date | null;
  /** Base currency for the summary (TICKLER_CURRENCY, default USD). */
  currency: string;
}

export interface SyncResult {
  snapshots: MetricSnapshotInput[];
  salesEvents?: SalesEventInput[];
}

export type ProviderConfig = Record<string, string>;

export interface Provider {
  id: ProviderId;
  displayName: string;
  kind: "revenue" | "cost";
  /** Fields the setup page and the apps render for credentials. */
  fields: CredentialField[];
  /** Human readable, e.g. "hourly", "daily, ~1 day behind". */
  freshness: string;
  /** Minimum minutes between scheduled syncs (scheduler respects it). */
  syncEveryMinutes: number;
  needsPublicUrl?: boolean;
  /** Docs page slug, e.g. "providers/stripe". */
  guide: string;
  configured(cfg: ProviderConfig): boolean;
  test(cfg: ProviderConfig, ctx: SyncContext): Promise<{ ok: boolean; message: string }>;
  /** Must be idempotent. Throw an Error with a user readable message on failure. */
  sync(cfg: ProviderConfig, ctx: SyncContext): Promise<SyncResult>;
}

/** Webhook handler for a store, mounted by the core at POST /hooks/<store>. */
export interface WebhookHandler {
  store: SalesEventInput["store"];
  /** Verify signature/JWS/OIDC and parse. Throw on verification failure (core returns 401). */
  handle(req: {
    body: string;
    headers: Record<string, string>;
    url: string;
    cfg: ProviderConfig; // the store's provider config (shared secrets, expected audience...)
    fetch: typeof fetch;
    now: Date;
  }): Promise<{ events: SalesEventInput[]; response?: { status: number; body?: string } }>;
}
