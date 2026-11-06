import { generateKeyPairSync } from "node:crypto";
import { exportJWK, importPKCS8, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { clearGoogleTokenCache, clearJwksCache } from "../../src/providers/google";
import { googlePlay, googlePlayWebhook, mapPlayNotification, parseDay } from "../../src/providers/google_play";
import { ctx, fixtureBytes, json, mockFetch, NOW } from "./helpers";

const pem = (k: any) => k.export({ type: "pkcs8", format: "pem" }) as string;
const sa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const google = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
const cfg = {
  service_account_json: JSON.stringify({ client_email: "play@example.iam.gserviceaccount.com", private_key: pem(sa.privateKey) }),
  bucket: "gs://pubsite_prod_rev_00000000000000000000",
  pubsub_audience: "https://tickler.example.com/hooks/google_play",
  pubsub_service_account: "push@example.iam.gserviceaccount.com",
};

async function jwks() {
  const jwk = await exportJWK(google.publicKey);
  return { keys: [{ ...jwk, kid: "g1", alg: "RS256", use: "sig" }] };
}

async function idToken(over: Record<string, unknown> = {}, key = google.privateKey, aud = cfg.pubsub_audience) {
  const k = await importPKCS8(pem(key), "RS256");
  return new SignJWT({ email: cfg.pubsub_service_account, email_verified: true, ...over })
    .setProtectedHeader({ alg: "RS256", kid: "g1" })
    .setIssuer("https://accounts.google.com")
    .setAudience(aud)
    .setIssuedAt(Math.floor(NOW.getTime() / 1000) - 10)
    .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 3000)
    .sign(k);
}

function push(n: object) {
  return JSON.stringify({ message: { data: Buffer.from(JSON.stringify(n)).toString("base64"), messageId: "136969346945", publishTime: "2026-11-06T11:59:59Z" }, subscription: "projects/p/subscriptions/s" });
}

const RENEWED = { version: "1.0", packageName: "com.example.app", eventTimeMillis: String(NOW.getTime() - 5000), subscriptionNotification: { version: "1.0", notificationType: 2, purchaseToken: "tok-1" } };

function routes() {
  return mockFetch([
    ["oauth2/v3/certs", async () => json(await jwks())],
    ["oauth2.googleapis.com/token", () => json({ access_token: "ya29.test", expires_in: 3600 })],
    ["subscriptionsv2/tokens/tok-1", () => json({ lineItems: [{ productId: "pro_monthly", offerPhase: {} }] })],
    [/\/o\?prefix=sales%2Fsalesreport_202611/, () => json({ items: [{ name: "sales/salesreport_202611.zip" }] })],
    [/\/o\?prefix=earnings%2Fearnings_202610/, () => json({ items: [{ name: "earnings/earnings_202610_0000-1.zip" }] })],
    [/\/o\?prefix=/, () => json({})],
    ["sales%2Fsalesreport_202611.zip?alt=media", () => new Response(fixtureBytes("google_play/salesreport_202611.zip"))],
    ["earnings%2Fearnings_202610_0000-1.zip?alt=media", () => new Response(fixtureBytes("google_play/earnings_202610_0000-1.zip"))],
  ]);
}

beforeEach(() => {
  clearGoogleTokenCache();
  clearJwksCache();
});

describe("google_play reports", () => {
  it("reads zipped CSVs from the bucket into daily revenue, units and monthly earnings", async () => {
    const m = routes();
    const { snapshots } = await googlePlay.sync(cfg, ctx(m.fetch));
    const get = (metric: string, date: string, label: string | null = null) =>
      snapshots.find((s) => s.metric === metric && s.period_start === date && (s.label ?? null) === label)?.value;
    expect(get("revenue", "2026-11-04")).toBe(2.99);
    expect(get("revenue", "2026-11-04", "currency:EUR")).toBe(2.99);
    expect(get("revenue", "2026-11-05")).toBeCloseTo(-49.99 + 0.99);
    expect(get("units", "2026-11-04")).toBe(2);
    expect(get("units", "2026-11-05")).toBe(1);
    expect(get("revenue", "2026-11-01")).toBe(0);
    expect(get("proceeds", "2026-10-01", "earnings:USD")).toBeCloseTo(2.54);
    expect(m.calls.some((c) => c.url.includes("/b/pubsite_prod_rev_00000000000000000000/o"))).toBe(true);
  });

  it("filters by package name", async () => {
    const { snapshots } = await googlePlay.sync({ ...cfg, package_name: "com.example.app" }, ctx(routes().fetch));
    expect(snapshots.find((s) => s.metric === "revenue" && s.period_start === "2026-11-05" && s.label == null)?.value).toBeCloseTo(-49.99);
  });

  it("parses both date styles", () => {
    expect(parseDay("2026-11-04")).toBe("2026-11-04");
    expect(parseDay("Nov 4, 2026")).toBe("2026-11-04");
  });
});

describe("google_play webhook (RTDN over Pub/Sub push)", () => {
  const req = (auth: string | undefined, body = push(RENEWED), over: Record<string, string> = {}) => ({
    body,
    headers: (auth ? { Authorization: `Bearer ${auth}` } : {}) as Record<string, string>,
    url: cfg.pubsub_audience,
    cfg: { ...cfg, ...over },
    fetch: routes().fetch,
    now: NOW,
  });

  it("accepts a valid OIDC token and looks up the product", async () => {
    const r = await googlePlayWebhook.handle(req(await idToken()));
    expect(r.events).toEqual([expect.objectContaining({ store: "google_play", external_id: "136969346945", type: "renewed", product_id: "pro_monthly" })]);
  });

  it("rejects missing, forged, wrong-audience and wrong-sender tokens", async () => {
    await expect(googlePlayWebhook.handle(req(undefined))).rejects.toThrow("bearer");
    await expect(googlePlayWebhook.handle(req(await idToken({}, attacker.privateKey)))).rejects.toThrow();
    await expect(googlePlayWebhook.handle(req(await idToken({}, google.privateKey, "https://other.example.com")))).rejects.toThrow();
    await expect(googlePlayWebhook.handle(req(await idToken({ email: "someone@else.com" })))).rejects.toThrow("service account");
    const t = await idToken();
    const [h, p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), email: "x@y.z" })).toString("base64url");
    await expect(googlePlayWebhook.handle(req(`${h}.${forged}.${s}`))).rejects.toThrow();
  });

  it("requires the audience to be configured", async () => {
    await expect(googlePlayWebhook.handle(req(await idToken(), push(RENEWED), { pubsub_audience: "" }))).rejects.toThrow("audience");
  });

  it("maps notification kinds", () => {
    expect(mapPlayNotification({ subscriptionNotification: { notificationType: 4 } })?.type).toBe("subscribed");
    expect(mapPlayNotification({ subscriptionNotification: { notificationType: 3 } })?.type).toBe("cancelled");
    expect(mapPlayNotification({ subscriptionNotification: { notificationType: 6 } })?.type).toBe("billing_issue");
    expect(mapPlayNotification({ subscriptionNotification: { notificationType: 13 } })).toBe(null);
    expect(mapPlayNotification({ oneTimeProductNotification: { notificationType: 1, sku: "coins" } })).toEqual({ type: "purchase", product: "coins", token: null });
    expect(mapPlayNotification({ voidedPurchaseNotification: { orderId: "GPA.1" } })?.type).toBe("refunded");
    expect(mapPlayNotification({ testNotification: { version: "1.0" } })).toBe(null);
  });
});
