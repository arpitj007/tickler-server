// Amazon Appstore (Fire TV, Fire tablets): monthly-to-date sales report from the Reporting API
// (daily figures, marketplace currencies) and Real-Time Notifications via Amazon SNS at
// /hooks/amazon_appstore. Docs: https://developer.amazon.com/docs/reports-promo/reporting-API.html
//       https://developer.amazon.com/docs/in-app-purchasing/real-time-notifications.html

import type { MetricSnapshotInput, Provider, ProviderConfig, SalesEventInput, SalesEventType, SyncContext, WebhookHandler } from "./types";
import { ab, b64decode, bump, currencyLabel, decodeText, monthOf, num, parseTable, parseYmd, ProviderError, request, requestJson, required, snap, syncWindow, testWith, unzip, utf8 } from "./util";
import { parseCert, publicKey } from "./x509";

const LATENCY = "1 to 2 days";
const SCOPE = "adx_reporting::appstore:marketer";

async function accessToken(ctx: SyncContext, cfg: ProviderConfig): Promise<string> {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.client_id.trim(), client_secret: cfg.client_secret.trim(), scope: SCOPE });
  const r: any = await requestJson(ctx.fetch, "Amazon login", "https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return r.access_token;
}

/** Download one month's sales report; null when Amazon has none yet. */
async function salesReport(ctx: SyncContext, tok: string, month: string): Promise<Record<string, string>[] | null> {
  const [y, m] = month.split("-");
  let url: string;
  try {
    const res = await request(ctx.fetch, "Amazon Reporting API", `https://developer.amazon.com/api/appstore/download/report/sales/${y}/${m}`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    url = (await res.text()).trim().replace(/^"|"$/g, "");
  } catch (e) {
    if (e instanceof ProviderError && e.status === 404) return null;
    throw e;
  }
  const file = await ctx.fetch(url);
  if (file.status === 403 || file.status === 404) return null; // "Report Not Available"
  if (!file.ok) throw new ProviderError(`Amazon report download: HTTP ${file.status}`, file.status);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const files = bytes[0] === 0x50 && bytes[1] === 0x4b ? await unzip(bytes) : [{ name: "report.csv", data: bytes }];
  return files.filter((f) => f.name.endsWith(".csv")).flatMap((f) => parseTable(decodeText(f.data)));
}

/** "MM/DD/YY HH:MM:SS PST" -> YYYY-MM-DD (the marketplace's local date, as Amazon reports it). */
export function amazonDay(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s.trim());
  if (!m) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export function summarizeAmazonSales(rows: Record<string, string>[]) {
  const proceeds = new Map<string, number>(); // date|currency, Estimated Earnings
  const revenue = new Map<string, number>(); // date|currency, Sales Price
  const units = new Map<string, number>();
  for (const r of rows) {
    const date = amazonDay(r["Transaction Time"] ?? "");
    const cur = (r["Marketplace Currency"] ?? "").toUpperCase();
    if (!date || !cur) continue;
    bump(proceeds, `${date}|${cur}`, num(r["Estimated Earnings"]));
    bump(revenue, `${date}|${cur}`, num(r["Sales Price"]));
    if ((r["Transaction Type"] ?? "").toLowerCase() === "charge") bump(units, date, num(r["Units"]) || 1);
  }
  return { proceeds, revenue, units };
}

export const amazonAppstore: Provider = {
  id: "amazon_appstore",
  displayName: "Amazon Appstore",
  kind: "revenue",
  guide: "providers/amazon_appstore",
  freshness: "notifications in seconds; reports every 6 hours, 1 to 2 days behind",
  syncEveryMinutes: 360,
  needsPublicUrl: true,
  fields: [
    { key: "client_id", label: "Client ID", secret: false, help: "From the security profile attached to the Reporting API." },
    { key: "client_secret", label: "Client secret", secret: true },
    { key: "app_package", label: "App package name (notifications)", secret: false, optional: true, help: "Only accept notifications for this app." },
    { key: "sns_topic_arn", label: "SNS topic ARN (notifications)", secret: false, optional: true, help: "Shown in the first notification; pins notifications to this topic." },
  ],

  configured: (cfg) => required(cfg, "client_id", "client_secret"),

  test: (cfg, ctx) =>
    testWith(async () => {
      await accessToken(ctx, cfg);
      return "Connected: Amazon issued a Reporting API token.";
    }),

  async sync(cfg, ctx) {
    const tok = await accessToken(ctx, cfg);
    const { start, end } = syncWindow(ctx.now);
    const months = [...new Set([monthOf(parseYmd(start)), monthOf(parseYmd(end))])];
    const rows: Record<string, string>[] = [];
    for (const m of months) rows.push(...((await salesReport(ctx, tok, m)) ?? []));
    const { proceeds, revenue, units } = summarizeAmazonSales(rows);
    const snapshots: MetricSnapshotInput[] = [];
    const o = { source_latency: LATENCY };
    for (const [key, v] of proceeds) {
      const [date, cur] = key.split("|");
      if (date < start || date > end) continue;
      const label = currencyLabel(cur, ctx.currency);
      snapshots.push(snap("amazon_appstore", "default", "proceeds", cur, v, date, date, { ...o, label }));
      snapshots.push(snap("amazon_appstore", "default", "revenue", cur, revenue.get(key) ?? 0, date, date, { ...o, label }));
    }
    for (const [date, v] of units) if (date >= start && date <= end) snapshots.push(snap("amazon_appstore", "default", "units", "units", v, date, date, o));
    return { snapshots };
  },
};

// ---------- SNS signature verification ----------

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const certCache = new Map<string, string>();

export function snsStringToSign(m: Record<string, string>): string {
  const keys =
    m.Type === "Notification"
      ? ["Message", "MessageId", ...(m.Subject != null ? ["Subject"] : []), "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return keys.map((k) => `${k}\n${m[k]}\n`).join("");
}

function checkAwsUrl(u: string, what: string): URL {
  const url = new URL(u);
  if (url.protocol !== "https:" || !SNS_HOST.test(url.hostname)) throw new Error(`SNS: ${what} is not an Amazon SNS URL`);
  return url;
}

/** Verify an SNS message (SignatureVersion 1 = SHA1, 2 = SHA256). Throws on failure. */
export async function verifySnsMessage(m: Record<string, string>, fetchFn: typeof fetch, at: Date = new Date()): Promise<void> {
  if (!["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"].includes(m.Type)) throw new Error("SNS: unknown message type");
  const hash = m.SignatureVersion === "1" ? "SHA-1" : m.SignatureVersion === "2" ? "SHA-256" : null;
  if (!hash) throw new Error("SNS: unsupported SignatureVersion");
  const certUrl = checkAwsUrl(m.SigningCertURL ?? m.SigningCertUrl ?? "", "SigningCertURL").toString();
  let pemText = certCache.get(certUrl);
  if (!pemText) {
    const res = await fetchFn(certUrl);
    if (!res.ok) throw new Error(`SNS: could not fetch signing certificate (HTTP ${res.status})`);
    pemText = await res.text();
    certCache.set(certUrl, pemText);
  }
  const cert = parseCert(pemText);
  const now = at.getTime();
  if (cert.notAfter.getTime() < now || cert.notBefore.getTime() > now) throw new Error("SNS: signing certificate expired");
  const key = await publicKey(cert, hash);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, ab(b64decode(m.Signature ?? "")), ab(utf8(snsStringToSign(m))));
  if (!ok) throw new Error("SNS: signature mismatch");
}

export function clearSnsCertCache(): void {
  certCache.clear();
}

const RTN_TYPES: Record<string, SalesEventType> = {
  CONSUMABLE_PURCHASED: "purchase",
  ENTITLEMENT_PURCHASED: "purchase",
  CONSUMABLE_CANCELLED: "refunded",
  ENTITLEMENT_CANCELLED: "refunded",
  SUBSCRIPTION_PURCHASED: "subscribed",
  SUBSCRIPTION_RENEWED: "renewed",
  SUBSCRIPTION_CONVERTED_FREE_TRIAL_TO_PAID: "renewed",
  SUBSCRIPTION_CANCELLED: "cancelled",
  SUBSCRIPTION_AUTO_RENEWAL_OFF: "cancelled",
  SUBSCRIPTION_IN_GRACE_PERIOD: "billing_issue",
};

export function parseLenientJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); // Amazon's examples have trailing commas
  }
}

export const amazonWebhook: WebhookHandler = {
  store: "amazon_appstore",
  async handle({ body, cfg, fetch, now }) {
    const m = JSON.parse(body) as Record<string, string>;
    await verifySnsMessage(m, fetch, now);
    if (cfg.sns_topic_arn && m.TopicArn !== cfg.sns_topic_arn.trim()) throw new Error("SNS: unexpected topic");
    if (m.Type === "SubscriptionConfirmation") {
      // Amazon's console asks for this token; confirming through SubscribeURL as well is harmless.
      const res = await fetch(checkAwsUrl(m.SubscribeURL, "SubscribeURL").toString()).catch(() => null);
      return {
        events: [],
        notice: `Amazon SNS confirmation token: ${m.Token} (topic ${m.TopicArn}). Paste it in the Amazon Developer Console if it asks for it.${res?.ok ? " Subscription confirmed through SubscribeURL." : ""}`,
        response: { status: 200, body: "confirmation received" },
      };
    }
    if (m.Type !== "Notification") return { events: [] };
    const n = parseLenientJson(m.Message);
    if (cfg.app_package && n.appPackageName !== cfg.app_package.trim()) return { events: [] };
    const type = RTN_TYPES[n.notificationType];
    if (!type || n.betaProductTransaction === true) return { events: [] };
    const event: SalesEventInput = {
      store: "amazon_appstore",
      external_id: m.MessageId,
      type,
      product_id: null, // RTN carries the receipt id, not the SKU
      price: null,
      currency: null,
      country: null,
      occurred_at: new Date(Number(n.timestamp) || Date.parse(m.Timestamp)).toISOString(),
      raw: { notificationType: n.notificationType, appPackageName: n.appPackageName, receiptId: n.receiptId },
    };
    return { events: [event] };
  },
};
