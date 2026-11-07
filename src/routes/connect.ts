// /c/:code: the "connect this computer" script (GET) and its one-time token exchange (POST). See core/connectCli.ts.
import { Hono } from "hono";
import { connectScript, EXPIRED_SCRIPT, isConnectCode, redeemConnectCode } from "../core/connectCli";
import { rateLimit } from "../core/rateLimit";
import { clientIp, type Env } from "./http";

export const connect = new Hono<Env>();

connect.use("*", async (c, next) => {
  await rateLimit(c.get("ctx"), `connect:${clientIp(c)}`, 30, 600);
  await next();
});

connect.get("/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const script = isConnectCode(code) ? await connectScript(c.get("ctx"), c.get("baseUrl"), code) : null;
  c.header("cache-control", "no-store");
  // Always a script, so `| sh` prints a useful line instead of nothing.
  return c.text(script ?? EXPIRED_SCRIPT, 200, { "content-type": "text/x-shellscript; charset=utf-8" });
});

connect.post("/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const f = await c.req.parseBody();
  const clients = String(f.clients ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const tokens = await redeemConnectCode(c.get("ctx"), isConnectCode(code) ? code : "", clients, String(f.computer ?? ""));
  c.header("cache-control", "no-store");
  return c.text(tokens.map(([id, secret]) => `${id} ${secret}`).join("\n") + "\n");
});
