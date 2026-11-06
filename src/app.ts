// Builds the Hono app shared by the Cloudflare Worker (src/worker.ts) and Node (src/node.ts).
import { Hono } from "hono";
import { authenticate, bearer } from "./core/auth";
import { configFromEnv, type Config, type Ctx } from "./core/context";
import { recordMcpCall } from "./core/devices";
import { runDaily, runDueSyncs } from "./core/moneyService";
import { providers as defaultProviders, webhookHandlers as defaultHooks } from "./core/providerRegistry";
import { rateLimit } from "./core/rateLimit";
import { ApiError } from "./core/util";
import { handleMcp, inferClient } from "./mcp/server";
import { oauth, wellKnown, wwwAuthenticate } from "./oauth/routes";
import type { Provider, WebhookHandler } from "./providers/types";
import { api } from "./routes/api";
import { hooks } from "./routes/hooks";
import { errorResponse, zodFields, type Env } from "./routes/http";
import { setup } from "./setup/routes";
import { migrate } from "./storage/migrate";
import type { Migration, Storage } from "./storage/types";
import { z } from "zod";

export interface AppDeps {
  storage: Storage;
  env: Record<string, unknown>;
  migrations: Migration[];
  providers?: Provider[];
  webhookHandlers?: WebhookHandler[];
  fetch?: typeof fetch;
  now?: () => Date;
}

export function makeCtx(deps: AppDeps, config: Config = configFromEnv(deps.env)): Ctx {
  return {
    storage: deps.storage,
    config,
    now: deps.now ?? (() => new Date()),
    providers: deps.providers ?? defaultProviders,
    webhookHandlers: deps.webhookHandlers ?? defaultHooks,
    fetch: deps.fetch ?? ((...a) => fetch(...a)),
  };
}

/** Migrations run once per process/isolate, before the first request or scheduled run. */
export function migrator(deps: AppDeps) {
  let p: Promise<unknown> | null = null;
  return () => (p ??= migrate(deps.storage, deps.migrations).catch((e) => {
    p = null;
    throw e;
  }));
}

export function baseUrlFor(config: Config, req: Request): string {
  if (config.publicUrl) return config.publicUrl;
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto === "https" || proto === "http") u.protocol = `${proto}:`;
  return u.origin;
}

export function createApp(deps: AppDeps) {
  const ctx = makeCtx(deps);
  const ensureMigrated = migrator(deps);
  const app = new Hono<Env>({ strict: false });

  app.use("*", async (c, next) => {
    await ensureMigrated();
    c.set("ctx", ctx);
    const base = baseUrlFor(ctx.config, c.req.raw);
    c.set("baseUrl", base);
    // CORS is locked: no Access-Control headers are ever sent, and state-changing requests
    // carrying a foreign Origin are refused (CSRF and DNS rebinding protection).
    const origin = c.req.header("origin");
    if (origin && c.req.method !== "GET" && c.req.method !== "HEAD" && !c.req.path.startsWith("/hooks/")) {
      if (origin !== new URL(base).origin && origin !== new URL(c.req.url).origin) {
        throw new ApiError(403, "forbidden", "Cross-origin requests are not allowed");
      }
    }
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "same-origin");
    c.header("x-frame-options", "DENY");
    if (c.res.headers.get("content-type")?.startsWith("text/html")) {
      c.header("content-security-policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
      c.header("cache-control", "no-store");
    }
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      if (err.status === 429 && err.extra.retry_after) c.header("retry-after", String(err.extra.retry_after));
      return c.json(errorResponse(err), err.status as 400);
    }
    if (err instanceof z.ZodError) {
      return c.json(errorResponse(new ApiError(422, "validation_failed", "Invalid input", { fields: zodFields(err) })), 422);
    }
    console.error("unhandled error", err);
    return c.json(errorResponse(new ApiError(500, "internal", "Something went wrong")), 500);
  });

  app.notFound((c) => c.json(errorResponse(new ApiError(404, "not_found", "No such endpoint")), 404));

  app.get("/", (c) => c.redirect("/setup"));
  app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));
  app.route("/api", api);
  app.route("/setup", setup);
  app.route("/oauth", oauth);
  app.route("/.well-known", wellKnown);
  app.route("/hooks", hooks);

  app.on(["GET", "DELETE"], "/mcp", (c) => {
    c.header("allow", "POST");
    return c.json(errorResponse(new ApiError(405, "bad_request", "This MCP server is stateless: POST JSON-RPC to /mcp")), 405);
  });

  app.post("/mcp", async (c) => {
    const base = c.get("baseUrl");
    const p = await authenticate(ctx, bearer(c.req.header("authorization")), `${base}/mcp`);
    if (!p || (p.actor.type !== "mcp_token" && p.actor.type !== "oauth_client") || !p.scopes.includes("mcp")) {
      c.header("www-authenticate", wwwAuthenticate(base, c.req.header("authorization") ? "invalid_token" : undefined));
      return c.json(errorResponse(new ApiError(401, "unauthorized", "Missing or invalid token")), 401);
    }
    await rateLimit(ctx, `mcp:${p.actor.type}:${p.actor.id}`, 300, 60);
    const ua = c.req.header("user-agent") ?? null;
    await recordMcpCall(ctx, inferClient(p.actor.name, ua), p.actor.name);
    return handleMcp(ctx, c.req.raw, { principal: p, userAgent: ua });
  });

  return {
    app,
    ctx,
    /** Cron entry points: "tick" every 15 minutes, "daily" at 06:00 UTC. */
    async scheduled(kind: "tick" | "daily") {
      await ensureMigrated();
      if (kind === "daily") return runDaily(ctx);
      return runDueSyncs(ctx);
    },
  };
}
