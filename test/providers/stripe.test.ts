import { describe, expect, it } from "vitest";
import { fromMinor, mapStripeEvent, monthlyAmount, stripe, stripeWebhook, verifyStripeSignature } from "../../src/providers/stripe";
import { ctx, fixture, json, mockFetch, NOW } from "./helpers";

const cfg = { api_key: "rk_live_test", webhook_secret: "whsec_test_secret" };

async function sign(body: string, secret: string, t: number) {
  const { createHmac } = await import("node:crypto");
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

describe("stripe sync", () => {
  it("turns balance transactions into daily revenue, proceeds and units, and MRR", async () => {
    const m = mockFetch([
      ["/balance_transactions", () => json(fixture("stripe/balance_transactions.json"))],
      ["/subscriptions", () => json(fixture("stripe/subscriptions.json"))],
    ]);
    const { snapshots } = await stripe.sync(cfg, ctx(m.fetch));
    const get = (metric: string, date: string, label: string | null = null) =>
      snapshots.find((s) => s.metric === metric && s.period_start === date && (s.label ?? null) === label)?.value;
    expect(get("revenue", "2026-11-05")).toBe(30);
    expect(get("proceeds", "2026-11-05")).toBeCloseTo(28.53); // payout excluded
    expect(get("units", "2026-11-05")).toBe(2);
    expect(get("proceeds", "2026-11-06")).toBe(-10);
    expect(get("revenue", "2026-11-06", "refunds")).toBe(-10);
    expect(get("proceeds", "2026-11-05", "currency:EUR")).toBe(4.7);
    expect(get("proceeds", "2026-11-01")).toBe(0);
    expect(get("revenue", "2026-11-06", "mrr")).toBeCloseTo(9.99 + 20);
    expect(m.calls[0].url).toContain(`created[gte]=${Date.UTC(2026, 9, 29) / 1000}`);
  });

  it("handles zero and three decimal currencies", () => {
    expect(fromMinor(500, "jpy")).toBe(500);
    expect(fromMinor(1234, "usd")).toBe(12.34);
    expect(fromMinor(1234, "KWD")).toBe(1.234);
    expect(monthlyAmount({ quantity: 1, price: { currency: "usd", unit_amount: 700, recurring: { interval: "week", interval_count: 1 } } })).toBeCloseTo((7 * 52) / 12);
  });

  it("test warns about full-access secret keys", async () => {
    const m = mockFetch([["/balance", () => json(fixture("stripe/balance.json"))]]);
    expect((await stripe.test({ api_key: "rk_live_x" }, ctx(m.fetch))).message).toBe("Connected (live mode).");
    expect((await stripe.test({ api_key: "sk_live_x" }, ctx(m.fetch))).message).toContain("restricted key");
  });
});

describe("stripe webhook", () => {
  const t = Math.floor(NOW.getTime() / 1000);
  const event = {
    id: "evt_1",
    type: "invoice.paid",
    created: t,
    livemode: true,
    data: { object: { id: "in_1", currency: "usd", amount_paid: 999, billing_reason: "subscription_cycle", lines: { data: [{ pricing: { type: "price_details", price_details: { price: "price_month" } } }] } } },
  };
  const body = JSON.stringify(event);

  it("accepts a valid signature and maps the event", async () => {
    const r = await stripeWebhook.handle({ body, headers: { "Stripe-Signature": await sign(body, cfg.webhook_secret, t) }, url: "/hooks/stripe", cfg, fetch, now: NOW });
    expect(r.events).toEqual([
      expect.objectContaining({ store: "stripe", external_id: "evt_1", type: "renewed", price: 9.99, currency: "USD", product_id: "price_month" }),
    ]);
  });

  it("accepts any of several v1 signatures (secret rolling)", async () => {
    const good = await sign(body, cfg.webhook_secret, t);
    const header = `t=${t},v1=${"0".repeat(64)},${good.split(",")[1]}`;
    await expect(verifyStripeSignature(body, header, cfg.webhook_secret, NOW)).resolves.toBeUndefined();
  });

  it("rejects a tampered body, a wrong secret and an old timestamp", async () => {
    const header = await sign(body, cfg.webhook_secret, t);
    await expect(verifyStripeSignature(body.replace("999", "1"), header, cfg.webhook_secret, NOW)).rejects.toThrow("mismatch");
    await expect(verifyStripeSignature(body, await sign(body, "whsec_other", t), cfg.webhook_secret, NOW)).rejects.toThrow("mismatch");
    await expect(verifyStripeSignature(body, await sign(body, cfg.webhook_secret, t - 301), cfg.webhook_secret, NOW)).rejects.toThrow("tolerance");
    await expect(verifyStripeSignature(body, undefined, cfg.webhook_secret, NOW)).rejects.toThrow("missing");
    await expect(verifyStripeSignature(body, `t=${t},v0=abc`, cfg.webhook_secret, NOW)).rejects.toThrow("malformed");
  });

  it("maps subscription lifecycle events", () => {
    const sub = (type: string, object: any, prev: any = {}) => mapStripeEvent({ id: "e", type, created: t, data: { object, previous_attributes: prev } })?.type ?? null;
    expect(sub("customer.subscription.created", { status: "trialing" })).toBe("trial_started");
    expect(sub("customer.subscription.created", { status: "active" })).toBe("subscribed");
    expect(sub("customer.subscription.updated", { status: "active" }, { status: "trialing" })).toBe("subscribed");
    expect(sub("customer.subscription.updated", { cancel_at_period_end: true }, { cancel_at_period_end: false })).toBe("cancelled");
    expect(sub("customer.subscription.deleted", { cancel_at_period_end: true })).toBe(null);
    expect(sub("invoice.payment_failed", { amount_due: 100, currency: "usd" })).toBe("billing_issue");
    expect(sub("charge.refunded", { amount_refunded: 100, currency: "usd" })).toBe("refunded");
    expect(sub("checkout.session.completed", { mode: "payment", amount_total: 100, currency: "usd" })).toBe("purchase");
    expect(sub("checkout.session.completed", { mode: "subscription" })).toBe(null);
  });
});
