import { CompactSign, decodeProtectedHeader, importPKCS8 } from "jose";
import { describe, expect, it } from "vitest";
import { appStore, appStoreToken, createAppStoreWebhook, mapAppleNotification, summarizeSales, verifyAppleJws } from "../../src/providers/app_store";
import { APPLE_ROOT_CA_G3 } from "../../src/providers/certs/apple";
import { parseCert, verifySignedBy } from "../../src/providers/x509";
import { parseTable, gunzip, decodeText } from "../../src/providers/util";
import { ctx, fixture, fixtureBytes, json, mockFetch, NOW } from "./helpers";

const cfg = { issuer_id: "00000000-0000-0000-0000-000000000000", key_id: "ABC123DEFG", private_key: fixture("app_store/test-asc.p8"), vendor_number: "80000000" };
const ROOT = fixture("app_store/test-root.pem");
const INTER = fixture("app_store/test-intermediate.pem");
const LEAF = fixture("app_store/test-leaf.pem");
const b64 = (pem: string) => pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");

async function appleSign(payload: unknown, chain = [LEAF, INTER, ROOT]): Promise<string> {
  const key = await importPKCS8(fixture("app_store/test-leaf.key.pem"), "ES256");
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader({ alg: "ES256", x5c: chain.map(b64) }).sign(key);
}

async function notification(type: string, subtype?: string, tx: Record<string, unknown> = {}) {
  const signedTransactionInfo = await appleSign({ transactionId: "2000000000000001", productId: "com.example.pro.monthly", price: 2990, currency: "USD", storefront: "USA", ...tx });
  return appleSign({
    notificationType: type,
    subtype,
    notificationUUID: "11111111-2222-3333-4444-555555555555",
    version: "2.0",
    signedDate: NOW.getTime() - 1000,
    data: { bundleId: "com.example.app", environment: "Production", signedTransactionInfo },
  });
}

describe("app_store reports", () => {
  it("signs an App Store Connect JWT", async () => {
    const jwt = await appStoreToken(cfg, NOW);
    expect(decodeProtectedHeader(jwt)).toEqual({ alg: "ES256", kid: "ABC123DEFG", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(claims).toMatchObject({ iss: cfg.issuer_id, aud: "appstoreconnect-v1" });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(20 * 60);
  });

  it("sums proceeds per currency (per-unit proceeds x units) and units without updates", async () => {
    const rows = parseTable(decodeText(await gunzip(fixtureBytes("app_store/sales_2026-11-04.txt.gz"))), "\t");
    const s = summarizeSales(rows);
    expect(s.proceeds.get("USD")).toBeCloseTo(3 * 2.09 - 34.99);
    expect(s.proceeds.get("EUR")).toBeCloseTo(3.98);
    expect(s.units).toBe(14);
  });

  it("syncs daily reports, treating old 404s as no sales and recent 404s as not ready", async () => {
    const m = mockFetch([
      ["reportDate%5D=2026-11-04", () => new Response(fixtureBytes("app_store/sales_2026-11-04.txt.gz"), { headers: { "content-type": "application/a-gzip" } })],
      ["/v1/financeReports", (url) => (url.includes("2026-10") ? new Response(fixtureBytes("app_store/finance_2026-10.txt.gz")) : json({}, 404))],
      ["/v1/salesReports", () => json({ errors: [{ code: "NOT_FOUND", detail: "There were no sales for the date specified." }] }, 404)],
    ]);
    const { snapshots } = await appStore.sync(cfg, ctx(m.fetch));
    const get = (metric: string, date: string, label: string | null = null) =>
      snapshots.find((s) => s.metric === metric && s.period_start === date && s.period_end === date && (s.label ?? null) === label)?.value;
    expect(get("proceeds", "2026-11-04")).toBeCloseTo(-28.72);
    expect(get("proceeds", "2026-11-04", "currency:EUR")).toBeCloseTo(3.98);
    expect(get("proceeds", "2026-11-04", "Pro Monthly")).toBeCloseTo(6.27);
    expect(get("units", "2026-11-04")).toBe(14);
    expect(get("proceeds", "2026-11-02")).toBe(0); // settled: no sales
    expect(get("proceeds", "2026-11-05")).toBeUndefined(); // not ready yet
    const fin = snapshots.find((s) => s.label === "finance:USD")!;
    expect(fin).toMatchObject({ period_start: "2026-10-01", period_end: "2026-10-31" });
    expect(fin.value).toBeCloseTo(83.6 - 34.99);
    expect(m.calls[0].url).toContain("filter%5Bversion%5D=1_0");
    expect((m.calls[0].init.headers as any).authorization).toMatch(/^Bearer ey/);
  });

  it("test explains a 401", async () => {
    const m = mockFetch([["/v1/salesReports", () => json({ errors: [{ status: "401", code: "NOT_AUTHORIZED", title: "Authentication credentials are missing or invalid." }] }, 401)]]);
    const r = await appStore.test(cfg, ctx(m.fetch));
    expect(r).toEqual({ ok: false, message: "App Store Connect: HTTP 401 Authentication credentials are missing or invalid." });
  });
});

describe("app_store certificates", () => {
  it("verifies the real Apple WWDR G6 intermediate against the embedded Apple Root CA G3", async () => {
    const root = parseCert(APPLE_ROOT_CA_G3);
    const g6 = parseCert(fixture("app_store/apple-wwdr-g6.pem"));
    expect(root.isCA).toBe(true);
    expect(g6.isCA).toBe(true);
    expect(g6.extensions.has("1.2.840.113635.100.6.2.1")).toBe(true);
    expect(await verifySignedBy(g6, root)).toBe(true);
    expect(await verifySignedBy(root, g6)).toBe(false);
  });
});

describe("app_store webhook (Server Notifications V2)", () => {
  const hook = createAppStoreWebhook({ roots: [ROOT] });
  const req = (signedPayload: string, cfgOver: Record<string, string> = {}, now = NOW) => ({
    body: JSON.stringify({ signedPayload }),
    headers: {},
    url: "https://example.com/hooks/app_store",
    cfg: { ...cfg, ...cfgOver },
    fetch,
    now,
  });

  it("accepts a valid chain and maps SUBSCRIBED", async () => {
    const r = await hook.handle(req(await notification("SUBSCRIBED", "INITIAL_BUY")));
    expect(r.events).toEqual([
      expect.objectContaining({ store: "app_store", external_id: "11111111-2222-3333-4444-555555555555", type: "subscribed", product_id: "com.example.pro.monthly", price: 2.99, currency: "USD", country: "USA" }),
    ]);
  });

  it("rejects a tampered payload", async () => {
    const jws = await notification("DID_RENEW");
    const [h, , s] = jws.split(".");
    const forged = Buffer.from(JSON.stringify({ notificationType: "REFUND", notificationUUID: "x", data: {} })).toString("base64url");
    await expect(hook.handle(req(`${h}.${forged}.${s}`))).rejects.toThrow();
  });

  it("rejects a chain that does not end at the trusted root", async () => {
    await expect(createAppStoreWebhook().handle(req(await notification("DID_RENEW")))).rejects.toThrow("trusted root");
  });

  it("rejects a leaf that the intermediate did not issue", async () => {
    const jws = await appleSign({ notificationType: "TEST" }, [LEAF, fixture("app_store/apple-wwdr-g6.pem"), ROOT]);
    await expect(hook.handle(req(jws))).rejects.toThrow();
  });

  it("rejects expired certificates", async () => {
    await expect(hook.handle(req(await notification("DID_RENEW"), {}, new Date("2060-01-01T00:00:00Z")))).rejects.toThrow("expired");
  });

  it("ignores sandbox and other apps unless allowed", async () => {
    const jws = await notification("DID_RENEW");
    expect((await hook.handle(req(jws, { bundle_id: "com.other.app" }))).events).toEqual([]);
  });

  it("maps notification types", async () => {
    const tx = (o: object) => `x.${Buffer.from(JSON.stringify(o)).toString("base64url")}.y`;
    expect(mapAppleNotification({ notificationType: "SUBSCRIBED", subtype: "INITIAL_BUY", data: { signedTransactionInfo: tx({ offerDiscountType: "FREE_TRIAL" }) } })).toBe("trial_started");
    expect(mapAppleNotification({ notificationType: "DID_RENEW" })).toBe("renewed");
    expect(mapAppleNotification({ notificationType: "ONE_TIME_CHARGE" })).toBe("purchase");
    expect(mapAppleNotification({ notificationType: "REFUND" })).toBe("refunded");
    expect(mapAppleNotification({ notificationType: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_DISABLED" })).toBe("cancelled");
    expect(mapAppleNotification({ notificationType: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_ENABLED" })).toBe(null);
    expect(mapAppleNotification({ notificationType: "DID_FAIL_TO_RENEW" })).toBe("billing_issue");
    expect(mapAppleNotification({ notificationType: "TEST" })).toBe(null);
  });

  it("verifyAppleJws returns the payload", async () => {
    const p = await verifyAppleJws(await appleSign({ hello: "world" }), { roots: [ROOT], now: NOW });
    expect(p).toEqual({ hello: "world" });
  });
});
