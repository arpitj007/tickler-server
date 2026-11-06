// Stripe: balance transactions (revenue, refunds, fees, net per day), active subscriptions (MRR)
// and the webhook (Stripe-Signature HMAC). Docs: https://docs.stripe.com/api/balance_transactions/list

import type { MetricSnapshotInput, Provider, ProviderConfig, SalesEventInput, SalesEventType, SyncContext, WebhookHandler } from "./types";
import { bump, currencyLabel, header, hmac, num, parseYmd, requestJson, required, safeEqual, snap, syncWindow, testWith, toHex, ymd } from "./util";

const API = "https://api.stripe.com/v1";
const LATENCY = "~15 minutes";
export const STRIPE_TOLERANCE_SECONDS = 300;

// Currencies Stripe sends without minor units (ISK and UGX are sent as two-decimal).
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

export function fromMinor(amount: number, currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return amount;
  if (THREE_DECIMAL.has(c)) return amount / 1000;
  return amount / 100;
}

// reporting_category values that are business income or its deductions (not payouts or transfers).
const PROCEEDS_CATEGORIES = new Set([
  "charge",
  "refund",
  "fee",
  "dispute",
  "dispute_reversal",
  "refund_failure",
  "partial_capture_reversal",
  "platform_earning",
  "platform_earning_refund",
  "other_adjustment",
  "tax",
]);

function get(ctx: SyncContext, cfg: ProviderConfig, path: string) {
  return requestJson(ctx.fetch, "Stripe", `${API}${path}`, { headers: { authorization: `Bearer ${cfg.api_key.trim()}` } });
}

async function list(ctx: SyncContext, cfg: ProviderConfig, path: string, maxPages = 50): Promise<any[]> {
  const out: any[] = [];
  let after = "";
  for (let i = 0; i < maxPages; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const r: any = await get(ctx, cfg, `${path}${sep}limit=100${after ? `&starting_after=${after}` : ""}`);
    out.push(...(r.data ?? []));
    if (!r.has_more || !r.data?.length) break;
    after = r.data[r.data.length - 1].id;
  }
  return out;
}

/** Normalised monthly amount of one subscription item, or 0 for metered/tiered prices. */
export function monthlyAmount(item: any): number {
  const p = item.price ?? item.plan;
  const rec = p?.recurring ?? (p?.interval ? { interval: p.interval, interval_count: p.interval_count } : null);
  if (!p || !rec || p.unit_amount == null || rec.usage_type === "metered") return 0;
  const n = rec.interval_count || 1;
  const perMonth = { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 }[rec.interval as string] ?? 0;
  return (fromMinor(p.unit_amount, p.currency) * (item.quantity ?? 1) * perMonth) / n;
}

export const stripe: Provider = {
  id: "stripe",
  displayName: "Stripe",
  kind: "revenue",
  guide: "providers/stripe",
  freshness: "every 15 minutes, webhooks in seconds",
  syncEveryMinutes: 15,
  needsPublicUrl: true,
  fields: [
    { key: "api_key", label: "Restricted key", secret: true, help: "rk_live_... with Read on Balance and Subscriptions only." },
    { key: "webhook_secret", label: "Webhook signing secret", secret: true, optional: true, help: "whsec_... from the webhook destination." },
  ],

  configured: (cfg) => required(cfg, "api_key"),

  test: (cfg, ctx) =>
    testWith(async () => {
      const r: any = await get(ctx, cfg, "/balance");
      const warn = cfg.api_key.trim().startsWith("sk_") ? " Warning: this is a secret key with full access; use a restricted key." : "";
      return `Connected (${r.livemode ? "live" : "test"} mode).${warn}`;
    }),

  async sync(cfg, ctx) {
    const { start } = syncWindow(ctx.now);
    const since = Math.floor(parseYmd(start).getTime() / 1000);
    const txns = await list(ctx, cfg, `/balance_transactions?created[gte]=${since}`);
    const gross = new Map<string, number>();
    const refunds = new Map<string, number>();
    const fees = new Map<string, number>();
    const net = new Map<string, number>();
    const charges = new Map<string, number>();
    const currencies = new Set<string>([ctx.currency]);
    for (const t of txns) {
      const cur = String(t.currency).toUpperCase();
      currencies.add(cur);
      const key = `${ymd(new Date(t.created * 1000))}|${cur}`;
      const cat = t.reporting_category ?? t.type;
      if (!PROCEEDS_CATEGORIES.has(cat)) continue;
      bump(net, key, fromMinor(t.net, cur));
      bump(fees, key, fromMinor(t.fee, cur));
      if (cat === "charge") {
        bump(gross, key, fromMinor(t.amount, cur));
        bump(charges, key, 1);
      }
      if (cat === "refund") bump(refunds, key, -fromMinor(t.amount, cur));
    }

    const snapshots: MetricSnapshotInput[] = [];
    const { end } = syncWindow(ctx.now);
    for (let d = parseYmd(start); ymd(d) <= end; d = new Date(d.getTime() + 86_400_000)) {
      const date = ymd(d);
      for (const cur of currencies) {
        const key = `${date}|${cur}`;
        const base = cur === ctx.currency;
        if (!base && !net.has(key)) continue;
        const label = currencyLabel(cur, ctx.currency);
        const o = { label, source_latency: LATENCY };
        snapshots.push(snap("stripe", "default", "proceeds", cur, net.get(key) ?? 0, date, date, o));
        snapshots.push(snap("stripe", "default", "revenue", cur, gross.get(key) ?? 0, date, date, o));
        if (base) {
          snapshots.push(snap("stripe", "default", "units", "charges", charges.get(key) ?? 0, date, date, { source_latency: LATENCY }));
          if (refunds.has(key)) snapshots.push(snap("stripe", "default", "revenue", cur, -refunds.get(key)!, date, date, { label: "refunds", source_latency: LATENCY }));
          if (fees.has(key)) snapshots.push(snap("stripe", "default", "proceeds", cur, -fees.get(key)!, date, date, { label: "fees", source_latency: LATENCY }));
        }
      }
    }

    // MRR from active subscriptions (list prices; coupons are not subtracted).
    const subs = await list(ctx, cfg, "/subscriptions?status=active", 20);
    const mrr = new Map<string, number>();
    for (const s of subs) for (const it of s.items?.data ?? []) bump(mrr, String(it.price?.currency ?? it.plan?.currency ?? ctx.currency).toUpperCase(), monthlyAmount(it));
    const today = ymd(ctx.now);
    for (const [cur, v] of mrr) {
      snapshots.push(snap("stripe", "default", "revenue", cur, v, today, today, { label: cur === ctx.currency ? "mrr" : `mrr:${cur}`, raw: { active_subscriptions: subs.length } }));
    }
    return { snapshots };
  },
};

// ---------- webhook ----------

/** Verify a Stripe-Signature header. Throws on failure. */
export async function verifyStripeSignature(body: string, header: string | undefined, secret: string, now: Date, tolerance = STRIPE_TOLERANCE_SECONDS): Promise<void> {
  if (!header) throw new Error("missing Stripe-Signature header");
  let t = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((x) => x.trim());
    if (k === "t") t = v;
    if (k === "v1" && v) v1.push(v);
  }
  if (!t || !v1.length) throw new Error("malformed Stripe-Signature header");
  if (Math.abs(now.getTime() / 1000 - Number(t)) > tolerance) throw new Error("Stripe signature timestamp outside tolerance");
  const expected = toHex(await hmac(secret, `${t}.${body}`));
  if (!v1.some((s) => safeEqual(s, expected))) throw new Error("Stripe signature mismatch");
}

function priceId(obj: any): string | null {
  const item = obj?.items?.data?.[0];
  if (item) return item.price?.id ?? item.plan?.id ?? null;
  const line = obj?.lines?.data?.[0];
  return line?.pricing?.price_details?.price ?? line?.price?.id ?? null;
}

/** Map a Stripe event to a sales event, or null when it is not one we show. */
export function mapStripeEvent(e: any): SalesEventInput | null {
  const o = e?.data?.object ?? {};
  const prev = e?.data?.previous_attributes ?? {};
  let type: SalesEventType | null = null;
  let amount: number | null = null;
  let currency: string | null = o.currency ? String(o.currency).toUpperCase() : null;
  let country: string | null = null;
  switch (e?.type) {
    case "checkout.session.completed":
      if (o.mode === "payment") {
        type = "purchase";
        amount = o.amount_total;
        country = o.customer_details?.address?.country ?? null;
      }
      break;
    case "customer.subscription.created":
      type = o.status === "trialing" ? "trial_started" : o.status === "active" ? "subscribed" : null;
      break;
    case "customer.subscription.updated":
      if (prev.status === "trialing" && o.status === "active") type = "subscribed";
      else if (prev.cancel_at_period_end === false && o.cancel_at_period_end === true) type = "cancelled";
      break;
    case "customer.subscription.deleted":
      if (!o.cancel_at_period_end) type = "cancelled"; // otherwise counted when it was scheduled
      break;
    case "invoice.paid":
      if (o.billing_reason === "subscription_cycle") {
        type = "renewed";
        amount = o.amount_paid;
      }
      break;
    case "invoice.payment_failed":
      type = "billing_issue";
      amount = o.amount_due;
      break;
    case "charge.refunded":
      type = "refunded";
      amount = o.amount_refunded;
      country = o.billing_details?.address?.country ?? null;
      break;
  }
  if (!type) return null;
  return {
    store: "stripe",
    external_id: String(e.id),
    type,
    product_id: priceId(o),
    price: amount != null && currency ? fromMinor(amount, currency) : null,
    currency,
    country,
    occurred_at: new Date((e.created ?? 0) * 1000).toISOString(),
    raw: { id: e.id, type: e.type, object: o.id, livemode: e.livemode },
  };
}

export const stripeWebhook: WebhookHandler = {
  store: "stripe",
  async handle({ body, headers, cfg, now }) {
    if (!cfg.webhook_secret) throw new Error("Stripe webhook secret not configured");
    const sig = header(headers, "stripe-signature");
    await verifyStripeSignature(body, sig, cfg.webhook_secret.trim(), now);
    const ev = mapStripeEvent(JSON.parse(body));
    return { events: ev ? [ev] : [] };
  },
};
