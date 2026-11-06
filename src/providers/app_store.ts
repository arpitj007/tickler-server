// Apple App Store: App Store Connect API Sales and Trends (daily summary, proceeds and units) and
// Finance reports (monthly), plus App Store Server Notifications V2 at /hooks/app_store.
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/get-v1-salesreports
//       https://developer.apple.com/documentation/appstoreservernotifications

import { compactVerify, decodeProtectedHeader, importPKCS8, SignJWT } from "jose";
import { APPLE_ROOT_CA_G3 } from "./certs/apple";
import type { MetricSnapshotInput, Provider, ProviderConfig, SalesEventInput, SalesEventType, SyncContext, WebhookHandler } from "./types";
import { addDays, b64decode, bump, currencyLabel, dateRange, gunzip, monthOf, num, parseTable, pem, prevMonth, ProviderError, request, required, snap, syncWindow, testWith, ymd, decodeText, monthStart, monthEnd } from "./util";
import { parseCert, publicKey, sameBytes, validAt, verifySignedBy } from "./x509";

const API = "https://api.appstoreconnect.apple.com";
const LATENCY = "~1 day";

// Product types that are not a sale or a first download: updates, re-downloads, restores.
const NOT_UNITS = new Set(["7", "7F", "7T", "F7", "3", "3F", "F3", "IA3"]);

export async function appStoreToken(cfg: ProviderConfig, now: Date): Promise<string> {
  const key = await importPKCS8(pem(cfg.private_key.trim()), "ES256");
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: cfg.key_id.trim(), typ: "JWT" })
    .setIssuer(cfg.issuer_id.trim())
    .setIssuedAt(iat)
    .setExpirationTime(iat + 15 * 60)
    .setAudience("appstoreconnect-v1")
    .sign(key);
}

async function report(ctx: SyncContext, token: string, path: string, params: Record<string, string>): Promise<Record<string, string>[] | null> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  try {
    const res = await request(ctx.fetch, "App Store Connect", `${API}${path}?${qs}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/a-gzip" },
    });
    const text = decodeText(await gunzip(new Uint8Array(await res.arrayBuffer())));
    return parseTable(text, "\t");
  } catch (e) {
    if (e instanceof ProviderError && e.status === 404) return null; // no sales that day, or not ready yet
    throw e;
  }
}

/** Sum a Summary Sales Report into per-currency proceeds, units and per-product proceeds. */
export function summarizeSales(rows: Record<string, string>[]) {
  const proceeds = new Map<string, number>(); // currency -> amount
  const byProduct = new Map<string, number>(); // currency|title -> amount
  let units = 0;
  for (const r of rows) {
    const u = num(r["Units"]);
    const cur = (r["Currency of Proceeds"] || "").toUpperCase();
    if (!cur) continue;
    const amount = num(r["Developer Proceeds"] ?? r["Developer Proceeds (per unit)"]) * u; // refunds: negative units
    bump(proceeds, cur, amount);
    if (amount !== 0) bump(byProduct, `${cur}|${r["Title"] || r["SKU"] || "other"}`, amount);
    if (!NOT_UNITS.has(r["Product Type Identifier"])) units += u;
  }
  return { proceeds, byProduct, units };
}

export const appStore: Provider = {
  id: "app_store",
  displayName: "App Store",
  kind: "revenue",
  guide: "providers/app_store",
  freshness: "webhooks in seconds; reports every 6 hours, about 1 day behind",
  syncEveryMinutes: 360,
  needsPublicUrl: true,
  fields: [
    { key: "issuer_id", label: "Issuer ID", secret: false, help: "Users and Access > Integrations > App Store Connect API." },
    { key: "key_id", label: "Key ID", secret: false },
    { key: "private_key", label: "Private key (.p8 contents)", secret: true, multiline: true },
    { key: "vendor_number", label: "Vendor number", secret: false, help: "Payments and Financial Reports, top left." },
    { key: "bundle_id", label: "Bundle ID (webhooks)", secret: false, optional: true, help: "Only accept notifications for this app." },
    { key: "accept_sandbox", label: "Record sandbox notifications", secret: false, optional: true, help: '"true" to record sandbox events too (testing).' },
  ],

  configured: (cfg) => required(cfg, "issuer_id", "key_id", "private_key", "vendor_number"),

  test: (cfg, ctx) =>
    testWith(async () => {
      const token = await appStoreToken(cfg, ctx.now);
      // Any daily report; a 404 (no sales that day) still proves the key and vendor number work.
      await report(ctx, token, "/v1/salesReports", salesParams(cfg, ymd(addDays(ctx.now, -3))));
      return "Connected: the key can read Sales and Trends reports.";
    }),

  async sync(cfg, ctx) {
    const token = await appStoreToken(cfg, ctx.now);
    const { start, lastComplete } = syncWindow(ctx.now);
    const vendor = cfg.vendor_number.trim();
    const snapshots: MetricSnapshotInput[] = [];
    const o = { source_latency: LATENCY };
    // Reports are per Pacific day and appear the next morning PT; a missing report older than
    // 2 days means no sales that day.
    const settled = ymd(addDays(ctx.now, -3));
    for (const date of dateRange(start, lastComplete)) {
      const rows = await report(ctx, token, "/v1/salesReports", salesParams(cfg, date));
      if (!rows && date > settled) continue;
      const { proceeds, byProduct, units } = summarizeSales(rows ?? []);
      if (!proceeds.has(ctx.currency)) proceeds.set(ctx.currency, 0);
      for (const [cur, v] of proceeds) snapshots.push(snap("app_store", vendor, "proceeds", cur, v, date, date, { ...o, label: currencyLabel(cur, ctx.currency) }));
      for (const [key, v] of byProduct) {
        const [cur, title] = key.split("|");
        if (cur === ctx.currency) snapshots.push(snap("app_store", vendor, "proceeds", cur, v, date, date, { ...o, label: title }));
      }
      snapshots.push(snap("app_store", vendor, "units", "units", units, date, date, o));
    }

    // Finance report for last month (Apple fiscal month, published early in the next month).
    const month = prevMonth(monthOf(ctx.now));
    const rows = await report(ctx, token, "/v1/financeReports", {
      "filter[regionCode]": "ZZ",
      "filter[reportDate]": month,
      "filter[reportType]": "FINANCIAL",
      "filter[vendorNumber]": vendor,
    });
    if (rows) {
      const byCur = new Map<string, number>();
      for (const r of rows) {
        const cur = (r["Partner Share Currency"] || "").toUpperCase();
        if (!cur || !r["Extended Partner Share"]) continue; // summary rows at the end
        const sign = r["Sale or Return"] === "R" ? -1 : 1;
        bump(byCur, cur, sign * Math.abs(num(r["Extended Partner Share"])));
      }
      for (const [cur, v] of byCur) {
        snapshots.push(snap("app_store", vendor, "proceeds", cur, v, monthStart(month), monthEnd(month), { label: `finance:${cur}`, source_latency: "monthly" }));
      }
    }
    return { snapshots };
  },
};

function salesParams(cfg: ProviderConfig, date: string): Record<string, string> {
  return {
    "filter[frequency]": "DAILY",
    "filter[reportDate]": date,
    "filter[reportSubType]": "SUMMARY",
    "filter[reportType]": "SALES",
    "filter[vendorNumber]": cfg.vendor_number.trim(),
    "filter[version]": "1_0",
  };
}

// ---------- App Store Server Notifications V2 ----------

const OID_LEAF = "1.2.840.113635.100.6.11.1";
const OID_INTERMEDIATE = "1.2.840.113635.100.6.2.1";

/**
 * Verify an Apple-signed JWS (ES256 with an x5c chain) and return its payload.
 * Chain: leaf (OID 1.2.840.113635.100.6.11.1) <- intermediate (CA, OID 1.2.840.113635.100.6.2.1)
 * <- one of `roots` (Apple Root CA - G3 by default). Dates are checked at `now`.
 */
export async function verifyAppleJws(jws: string, opts: { roots?: string[]; now: Date }): Promise<any> {
  const header = decodeProtectedHeader(jws);
  if (header.alg !== "ES256") throw new Error("Apple JWS: unexpected alg");
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length < 2) throw new Error("Apple JWS: missing x5c chain");
  const leaf = parseCert(b64decode(x5c[0]));
  const intermediate = parseCert(b64decode(x5c[1]));
  const roots = (opts.roots ?? [APPLE_ROOT_CA_G3]).map((r) => parseCert(r));
  const root = roots.find((r) => sameBytes(r.subject, intermediate.issuer));
  if (!root) throw new Error("Apple JWS: chain does not end at a trusted root");
  if (x5c[2] && !sameBytes(parseCert(b64decode(x5c[2])).der, root.der)) throw new Error("Apple JWS: unexpected root certificate");
  if (!intermediate.isCA) throw new Error("Apple JWS: intermediate is not a CA");
  if (!intermediate.extensions.has(OID_INTERMEDIATE)) throw new Error("Apple JWS: intermediate is not an Apple WWDR certificate");
  if (!leaf.extensions.has(OID_LEAF)) throw new Error("Apple JWS: leaf is not an App Store signing certificate");
  if (!sameBytes(leaf.issuer, intermediate.subject)) throw new Error("Apple JWS: leaf not issued by intermediate");
  for (const c of [leaf, intermediate, root]) if (!validAt(c, opts.now)) throw new Error("Apple JWS: certificate expired or not yet valid");
  if (!(await verifySignedBy(intermediate, root))) throw new Error("Apple JWS: bad intermediate signature");
  if (!(await verifySignedBy(leaf, intermediate))) throw new Error("Apple JWS: bad leaf signature");
  const { payload } = await compactVerify(jws, await publicKey(leaf), { algorithms: ["ES256"] });
  return JSON.parse(new TextDecoder().decode(payload));
}

function decodeJwsPayload(jws: string | undefined): any {
  if (!jws) return {};
  return JSON.parse(new TextDecoder().decode(b64decode(jws.split(".")[1])));
}

export function mapAppleNotification(n: any): SalesEventType | null {
  const tx = decodeJwsPayload(n?.data?.signedTransactionInfo);
  switch (n?.notificationType) {
    case "SUBSCRIBED":
      return tx.offerDiscountType === "FREE_TRIAL" ? "trial_started" : "subscribed";
    case "DID_RENEW":
      return "renewed";
    case "ONE_TIME_CHARGE":
      return "purchase";
    case "REFUND":
      return "refunded";
    case "DID_CHANGE_RENEWAL_STATUS":
      return n.subtype === "AUTO_RENEW_DISABLED" ? "cancelled" : null;
    case "DID_FAIL_TO_RENEW":
      return "billing_issue";
    default:
      return null; // EXPIRED, OFFER_REDEEMED, TEST, ... are not shown in the feed
  }
}

export function createAppStoreWebhook(opts: { roots?: string[] } = {}): WebhookHandler {
  return {
    store: "app_store",
    async handle({ body, cfg, now }) {
      const signed = JSON.parse(body)?.signedPayload;
      if (typeof signed !== "string") throw new Error("Apple: missing signedPayload");
      const n = await verifyAppleJws(signed, { roots: opts.roots, now });
      const data = n.data ?? {};
      if (cfg.bundle_id && data.bundleId && data.bundleId !== cfg.bundle_id.trim()) return { events: [] };
      if (String(data.environment ?? "").toLowerCase() === "sandbox" && cfg.accept_sandbox !== "true") return { events: [] };
      const type = mapAppleNotification(n);
      if (!type) return { events: [] };
      const tx = decodeJwsPayload(data.signedTransactionInfo);
      const event: SalesEventInput = {
        store: "app_store",
        external_id: String(n.notificationUUID),
        type,
        product_id: tx.productId ?? null,
        price: typeof tx.price === "number" ? tx.price / 1000 : null,
        currency: tx.currency ?? null,
        country: tx.storefront ?? null, // ISO 3166-1 alpha-3, as Apple sends it
        occurred_at: new Date(n.signedDate ?? now.getTime()).toISOString(),
        raw: { notificationType: n.notificationType, subtype: n.subtype ?? null, environment: data.environment, transactionId: tx.transactionId },
      };
      return { events: [event] };
    },
  };
}

export const appStoreWebhook = createAppStoreWebhook();
