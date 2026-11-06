// POST /hooks/:store: store webhooks (App Store Server Notifications, Google Play RTDN, Amazon
// SNS, Stripe). Verification and parsing live in the store's WebhookHandler (src/providers).
import { Hono } from "hono";
import { logActivity } from "../core/activity";
import { SYSTEM } from "../core/context";
import { insertSalesEvents, readProviderConfig } from "../core/moneyStore";
import { rateLimit } from "../core/rateLimit";
import { clientIp, type Env } from "./http";

export const hooks = new Hono<Env>();

hooks.post("/:store", async (c) => {
  const ctx = c.get("ctx");
  const store = c.req.param("store");
  const handler = ctx.webhookHandlers.find((h) => h.store === store);
  if (!handler) return c.json({ error: { code: "not_found", message: "No webhook handler for this store" } }, 404);
  await rateLimit(ctx, `hooks:${store}:${clientIp(c)}`, 300, 60);
  const body = await c.req.text();
  if (body.length > 1_000_000) return c.json({ error: { code: "bad_request", message: "Body too large" } }, 413);
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  const cfg = (await readProviderConfig(ctx, store).catch(() => null)) ?? {};
  let result;
  try {
    result = await handler.handle({ body, headers, url: c.req.url, cfg, fetch: ctx.fetch, now: ctx.now() });
  } catch (e) {
    console.warn(`webhook ${store} rejected:`, e instanceof Error ? e.message : e);
    return c.json({ error: { code: "unauthorized", message: "Webhook verification failed" } }, 401);
  }
  const added = await insertSalesEvents(ctx, result.events);
  if (added) await logActivity(ctx, { ...SYSTEM, name: store }, `POST /hooks/${store}`, `${added} sales event(s): ${result.events.map((e) => e.type).join(", ")}`);
  if (result.notice) await logActivity(ctx, { ...SYSTEM, name: store }, `POST /hooks/${store}`, result.notice);
  if (result.response) return c.body(result.response.body ?? null, result.response.status as 200);
  return c.json({ ok: true, received: result.events.length, added });
});
