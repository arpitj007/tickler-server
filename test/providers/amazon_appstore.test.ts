import { createSign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { amazonAppstore, amazonDay, amazonWebhook, clearSnsCertCache, snsStringToSign, verifySnsMessage } from "../../src/providers/amazon_appstore";
import { ctx, fixture, fixtureBytes, json, mockFetch, NOW } from "./helpers";

const CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0000000000000000000000.pem";
const KEY = fixture("amazon_appstore/test-sns.key.pem");

function signed(m: Record<string, string>, version: "1" | "2" = "2") {
  const msg = { ...m, SignatureVersion: version, SigningCertURL: m.SigningCertURL ?? CERT_URL };
  const s = createSign(version === "1" ? "RSA-SHA1" : "RSA-SHA256");
  s.update(snsStringToSign(msg));
  return { ...msg, Signature: s.sign(KEY, "base64") };
}

const NOTIFICATION = {
  Type: "Notification",
  MessageId: "22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324",
  TopicArn: "arn:aws:sns:us-east-1:000000000000:appstore-rtn",
  Message: JSON.stringify({ appPackageName: "com.example.app", notificationType: "SUBSCRIPTION_RENEWED", receiptId: "q1YqVrJSSs7P1UvMTazKz9PLTEnVS8", timestamp: NOW.getTime() - 1000, betaProductTransaction: false }),
  Timestamp: "2026-11-06T11:59:59.000Z",
};

function routes() {
  return mockFetch([
    [CERT_URL, () => new Response(fixture("amazon_appstore/test-sns-cert.pem"))],
    ["sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription", () => new Response("<ConfirmSubscriptionResponse/>")],
    ["auth/o2/token", () => json({ access_token: "Atc|test", token_type: "bearer", expires_in: 3600 })],
    ["/download/report/sales/2026/11", () => new Response("https://s3.amazonaws.com/reports/sales-2026-11.zip?X-Amz-Signature=x")],
    ["/download/report/sales/2026/10", () => json({ Message: "Report Not Available" }, 404)],
    ["s3.amazonaws.com/reports/sales-2026-11.zip", () => new Response(fixtureBytes("amazon_appstore/sales-2026-11.zip"))],
  ]);
}

const req = (m: object, cfg: Record<string, string> = {}) => ({ body: JSON.stringify(m), headers: {}, url: "/hooks/amazon_appstore", cfg: { client_id: "c", client_secret: "s", ...cfg }, fetch: routes().fetch, now: NOW });

beforeEach(() => clearSnsCertCache());

describe("amazon_appstore reports", () => {
  it("downloads the sales report through the pre-signed URL", async () => {
    const m = routes();
    const { snapshots } = await amazonAppstore.sync({ client_id: "c", client_secret: "s" }, ctx(m.fetch));
    const get = (metric: string, date: string, label: string | null = null) =>
      snapshots.find((s) => s.metric === metric && s.period_start === date && (s.label ?? null) === label)?.value;
    expect(get("proceeds", "2026-11-04")).toBe(2.09);
    expect(get("proceeds", "2026-11-04", "currency:EUR")).toBe(2.09);
    expect(get("revenue", "2026-11-05")).toBe(-0.99);
    expect(get("units", "2026-11-04")).toBe(2);
    const tokenCall = m.calls.find((c) => c.url.includes("auth/o2/token"))!;
    expect(String(tokenCall.init.body)).toContain("scope=adx_reporting%3A%3Aappstore%3Amarketer");
  });

  it("reads Amazon's date format", () => {
    expect(amazonDay("11/04/26 10:00:00 PST")).toBe("2026-11-04");
  });
});

describe("amazon_appstore webhook (SNS)", () => {
  it("accepts a valid SignatureVersion 2 and 1 notification", async () => {
    for (const v of ["2", "1"] as const) {
      clearSnsCertCache();
      const r = await amazonWebhook.handle(req(signed(NOTIFICATION, v)));
      expect(r.events).toEqual([expect.objectContaining({ store: "amazon_appstore", external_id: NOTIFICATION.MessageId, type: "renewed" })]);
    }
  });

  it("rejects a tampered message", async () => {
    const m = signed(NOTIFICATION);
    await expect(amazonWebhook.handle(req({ ...m, Message: m.Message.replace("RENEWED", "PURCHASED") }))).rejects.toThrow("signature mismatch");
  });

  it("only fetches certificates from Amazon SNS hosts", async () => {
    for (const url of ["https://evil.example.com/cert.pem", "http://sns.us-east-1.amazonaws.com/c.pem", "https://sns.us-east-1.amazonaws.com.evil.com/c.pem"]) {
      await expect(amazonWebhook.handle(req(signed({ ...NOTIFICATION, SigningCertURL: url })))).rejects.toThrow("not an Amazon SNS URL");
    }
  });

  it("rejects unknown signature versions and pinned topic mismatches", async () => {
    await expect(verifySnsMessage({ ...signed(NOTIFICATION), SignatureVersion: "3" }, routes().fetch, NOW)).rejects.toThrow("SignatureVersion");
    await expect(amazonWebhook.handle(req(signed(NOTIFICATION), { sns_topic_arn: "arn:aws:sns:us-east-1:1:other" }))).rejects.toThrow("topic");
  });

  it("handles SubscriptionConfirmation and surfaces the token", async () => {
    const m = signed({
      Type: "SubscriptionConfirmation",
      MessageId: "165545c9-2a5c-472c-8df2-7ff2be2b3b1b",
      Token: "2336412f37fb687f5d51e6e241d09c805a5a57b30d712f794cc5f6a988666d92768dd60a747ba6f3beb71854e285d6ad02428b09ceece29417f1f02d609c582afbacc99c583a916b9981dd2728f4ae6fdb82efd087cc3b7849e05798d2d2785c03b0879594eeac82c01f235d0e717736",
      TopicArn: NOTIFICATION.TopicArn,
      Message: "You have chosen to subscribe to the topic arn:aws:sns:us-east-1:000000000000:appstore-rtn.",
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:us-east-1:000000000000:appstore-rtn&Token=2336",
      Timestamp: "2026-11-06T11:00:00.000Z",
    });
    const r = await amazonWebhook.handle(req(m));
    expect(r.events).toEqual([]);
    expect(r.notice).toContain(m.Token);
    expect(r.response?.status).toBe(200);
  });

  it("skips Live App Testing transactions", async () => {
    const m = signed({ ...NOTIFICATION, Message: JSON.stringify({ ...JSON.parse(NOTIFICATION.Message), betaProductTransaction: true }) });
    expect((await amazonWebhook.handle(req(m))).events).toEqual([]);
  });
});
