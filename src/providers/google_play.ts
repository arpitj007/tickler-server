// Google Play: estimated sales (daily, buyer currencies) and earnings (monthly, your payout
// currency) from the Play Console Cloud Storage bucket, and real-time developer notifications
// (Pub/Sub push with OIDC) at /hooks/google_play. The Android Publisher API is used to look up
// the product of a subscription notification.
// Docs: https://support.google.com/googleplay/android-developer/answer/6135870
//       https://developer.android.com/google/play/billing/rtdn-reference

import { googleToken, parseServiceAccount, verifyGoogleOidc } from "./google";
import type { MetricSnapshotInput, Provider, ProviderConfig, SalesEventInput, SalesEventType, SyncContext, WebhookHandler } from "./types";
import { b64decode, bump, currencyLabel, decodeText, header, monthEnd, monthOf, monthStart, num, parseTable, parseYmd, prevMonth, request, requestJson, required, snap, syncWindow, testWith, unzip, ymd } from "./util";

const STORAGE = "https://storage.googleapis.com/storage/v1";
const PUBLISHER = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const SCOPES = ["https://www.googleapis.com/auth/devstorage.read_only", "https://www.googleapis.com/auth/androidpublisher"];
const LATENCY = "~1 day";

export function bucketName(cfg: ProviderConfig): string {
  return cfg.bucket.trim().replace(/^gs:\/\//, "").replace(/\/.*$/, "");
}

/** Column lookup tolerant of the header variations Google has used. */
export function col(row: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    if (n in row) return row[n];
    const k = Object.keys(row).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k) return row[k];
  }
  return "";
}

export function parseDay(s: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(`${s} UTC`);
  return Number.isNaN(t) ? null : ymd(new Date(t));
}

async function token(ctx: SyncContext, cfg: ProviderConfig): Promise<string> {
  return googleToken(ctx.fetch, parseServiceAccount(cfg.service_account_json), SCOPES, ctx.now);
}

async function csvFiles(ctx: SyncContext, cfg: ProviderConfig, tok: string, prefix: string): Promise<Record<string, string>[]> {
  const auth = { headers: { authorization: `Bearer ${tok}` } };
  const bucket = encodeURIComponent(bucketName(cfg));
  const list: any = await requestJson(ctx.fetch, "Google Cloud Storage", `${STORAGE}/b/${bucket}/o?prefix=${encodeURIComponent(prefix)}`, auth);
  const rows: Record<string, string>[] = [];
  for (const item of list.items ?? []) {
    const res = await request(ctx.fetch, "Google Cloud Storage", `${STORAGE}/b/${bucket}/o/${encodeURIComponent(item.name)}?alt=media`, auth);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const files = item.name.endsWith(".zip") ? await unzip(bytes) : [{ name: item.name, data: bytes }];
    for (const f of files) if (f.name.endsWith(".csv")) rows.push(...parseTable(decodeText(f.data)));
  }
  return rows;
}

/** Estimated sales report rows -> per day: revenue per currency (item price, no tax), units. */
export function summarizePlaySales(rows: Record<string, string>[], packageName?: string) {
  const revenue = new Map<string, number>(); // date|currency -> amount
  const units = new Map<string, number>(); // date -> count
  for (const r of rows) {
    if (packageName && col(r, "Package ID", "Product id") !== packageName) continue;
    const date = parseDay(col(r, "Order Charged Date"));
    const cur = col(r, "Currency of Sale").toUpperCase();
    if (!date || !cur) continue;
    const refund = /refund/i.test(col(r, "Financial Status"));
    const price = Math.abs(num(col(r, "Item Price")));
    bump(revenue, `${date}|${cur}`, refund ? -price : price);
    if (!refund) bump(units, date, 1);
  }
  return { revenue, units };
}

export const googlePlay: Provider = {
  id: "google_play",
  displayName: "Google Play",
  kind: "revenue",
  guide: "providers/google_play",
  freshness: "notifications in seconds; reports every 6 hours, about 1 day behind",
  syncEveryMinutes: 360,
  needsPublicUrl: true,
  fields: [
    { key: "service_account_json", label: "Service account key (JSON)", secret: true, multiline: true },
    { key: "bucket", label: "Cloud Storage URI", secret: false, help: "gs://pubsite_prod_rev_... from Play Console > Download reports > Financial." },
    { key: "package_name", label: "Package name", secret: false, optional: true, help: "Only count this app (default: all apps in the account)." },
    { key: "pubsub_audience", label: "Push audience", secret: false, optional: true, help: "The audience set on the Pub/Sub push subscription (needed for notifications)." },
    { key: "pubsub_service_account", label: "Push service account email", secret: false, optional: true },
  ],

  configured: (cfg) => required(cfg, "service_account_json", "bucket"),

  test: (cfg, ctx) =>
    testWith(async () => {
      const tok = await token(ctx, cfg);
      await requestJson(ctx.fetch, "Google Cloud Storage", `${STORAGE}/b/${encodeURIComponent(bucketName(cfg))}/o?prefix=sales%2F&maxResults=1`, {
        headers: { authorization: `Bearer ${tok}` },
      });
      return "Connected: the service account can read your Play reports bucket.";
    }),

  async sync(cfg, ctx) {
    const tok = await token(ctx, cfg);
    const { start, end } = syncWindow(ctx.now);
    const pkg = cfg.package_name?.trim() || undefined;
    const account = pkg ?? bucketName(cfg);
    const months = [...new Set([monthOf(parseYmd(start)), monthOf(parseYmd(end))])];
    const rows: Record<string, string>[] = [];
    for (const m of months) rows.push(...(await csvFiles(ctx, cfg, tok, `sales/salesreport_${m.replace("-", "")}`)));
    const { revenue, units } = summarizePlaySales(rows, pkg);

    const snapshots: MetricSnapshotInput[] = [];
    const o = { source_latency: LATENCY };
    const lastDay = [...units.keys(), ...[...revenue.keys()].map((k) => k.split("|")[0])].sort().pop();
    for (let d = parseYmd(start); lastDay && ymd(d) <= lastDay; d = new Date(d.getTime() + 86_400_000)) {
      const date = ymd(d);
      if (!revenue.has(`${date}|${ctx.currency}`)) revenue.set(`${date}|${ctx.currency}`, 0);
      snapshots.push(snap("google_play", account, "units", "units", units.get(date) ?? 0, date, date, o));
    }
    for (const [key, v] of revenue) {
      const [date, cur] = key.split("|");
      if (date < start || date > end) continue;
      snapshots.push(snap("google_play", account, "revenue", cur, v, date, date, { ...o, label: currencyLabel(cur, ctx.currency) }));
    }

    // Last month's earnings (after Google's fees, in your payout currency), usually by the 5th.
    const last = prevMonth(monthOf(ctx.now));
    const earnings = await csvFiles(ctx, cfg, tok, `earnings/earnings_${last.replace("-", "")}`);
    const byCur = new Map<string, number>();
    for (const r of earnings) {
      if (pkg && col(r, "Package ID", "Product id") !== pkg) continue;
      const cur = col(r, "Merchant Currency").toUpperCase();
      if (cur) bump(byCur, cur, num(col(r, "Amount (Merchant Currency)")));
    }
    for (const [cur, v] of byCur) {
      snapshots.push(snap("google_play", account, "proceeds", cur, v, monthStart(last), monthEnd(last), { label: `earnings:${cur}`, source_latency: "monthly" }));
    }
    return { snapshots };
  },
};

// ---------- Real-time developer notifications ----------

const SUBSCRIPTION_TYPES: Record<number, SalesEventType | null> = {
  1: "renewed", // RECOVERED from account hold
  2: "renewed",
  3: "cancelled",
  4: "subscribed",
  5: "billing_issue", // ON_HOLD
  6: "billing_issue", // IN_GRACE_PERIOD
  12: "refunded", // REVOKED
};

export function mapPlayNotification(n: any): { type: SalesEventType; product: string | null; token: string | null } | null {
  if (n.subscriptionNotification) {
    const type = SUBSCRIPTION_TYPES[Number(n.subscriptionNotification.notificationType)] ?? null;
    return type ? { type, product: n.subscriptionNotification.subscriptionId ?? null, token: n.subscriptionNotification.purchaseToken ?? null } : null;
  }
  if (n.oneTimeProductNotification) {
    return Number(n.oneTimeProductNotification.notificationType) === 1 ? { type: "purchase", product: n.oneTimeProductNotification.sku ?? null, token: null } : null;
  }
  if (n.voidedPurchaseNotification) return { type: "refunded", product: null, token: null };
  return null; // testNotification, pendingRefundReviewNotification, unknown
}

export const googlePlayWebhook: WebhookHandler = {
  store: "google_play",
  async handle({ body, headers, cfg, fetch, now }) {
    if (!cfg.pubsub_audience) throw new Error("Google Play: push audience not configured");
    await verifyGoogleOidc(header(headers, "authorization"), {
      audience: cfg.pubsub_audience.trim(),
      email: cfg.pubsub_service_account?.trim() || undefined,
      fetch,
      now,
    });
    const msg = JSON.parse(body)?.message;
    if (!msg?.data) return { events: [] };
    const n = JSON.parse(new TextDecoder().decode(b64decode(msg.data)));
    if (cfg.package_name && n.packageName !== cfg.package_name.trim()) return { events: [] };
    const mapped = mapPlayNotification(n);
    if (!mapped) return { events: [] };
    let type = mapped.type;
    let product = mapped.product;
    // Subscription notifications no longer carry the product id: ask the Publisher API.
    if (mapped.token && cfg.service_account_json) {
      try {
        const tok = await googleToken(fetch, parseServiceAccount(cfg.service_account_json), SCOPES, now);
        const s: any = await requestJson(fetch, "Android Publisher", `${PUBLISHER}/applications/${encodeURIComponent(n.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(mapped.token)}`, {
          headers: { authorization: `Bearer ${tok}` },
        });
        const item = s.lineItems?.[0];
        product = item?.productId ?? product;
        if (type === "subscribed" && item?.offerPhase?.freeTrial) type = "trial_started";
      } catch {
        // Keep the event without the product; the notification itself is verified.
      }
    }
    const event: SalesEventInput = {
      store: "google_play",
      external_id: String(msg.messageId ?? msg.message_id),
      type,
      product_id: product,
      price: null,
      currency: null,
      country: null,
      occurred_at: new Date(Number(n.eventTimeMillis) || now.getTime()).toISOString(),
      raw: { packageName: n.packageName, kind: Object.keys(n).find((k) => k.endsWith("Notification")), notificationType: n.subscriptionNotification?.notificationType ?? n.oneTimeProductNotification?.notificationType ?? null },
    };
    return { events: [event] };
  },
};
