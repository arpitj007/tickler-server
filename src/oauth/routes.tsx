/** @jsxImportSource hono/jsx */
// OAuth 2.1 authorization server for MCP clients that need it (Claude apps' custom connectors,
// ChatGPT). Authorization code + PKCE (S256 only), refresh token rotation, dynamic client
// registration (RFC 7591), client ID metadata documents, RFC 8414 / RFC 9728 metadata, RFC 9207 iss.
// Spec: https://modelcontextprotocol.io/specification/draft/basic/authorization (checked 2026-11-06).
//
// Why not @cloudflare/workers-oauth-provider: it wraps the whole Worker and stores state in KV, so
// it can't share a code path with the Docker build. This is the small subset MCP needs, tested in
// test/oauth.test.ts.
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { logActivity } from "../core/activity";
import { listPasskeys, SESSION_COOKIE, validSession } from "../core/admin";
import { sameResource } from "../core/auth";
import type { Ctx } from "../core/context";
import { rateLimit } from "../core/rateLimit";
import { ApiError, randomToken, sha256b64url, sha256hex, timingSafeEqual, uuid } from "../core/util";
import { clientIp, type C, type Env } from "../routes/http";
import { Flash, Layout } from "../setup/layout";
import { LoginForm } from "../setup/routes";

export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 30 * 24 * 3600;
export const CODE_TTL_MS = 10 * 60_000;
export const SCOPE = "mcp";

export interface OAuthClientRow {
  id: string;
  name: string;
  redirect_uris: string;
  client_secret_hash: string | null;
  token_endpoint_auth_method: string;
  metadata: string;
  created_at: string;
  last_used_at: string | null;
}

export const oauth = new Hono<Env>();
export const wellKnown = new Hono<Env>();

// ---------- metadata

export function authServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    service_documentation: "https://github.com/arpitj007/tickler-server",
  };
}

export function protectedResourceMetadata(base: string) {
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Tickler",
    resource_documentation: "https://github.com/arpitj007/tickler-server",
  };
}

wellKnown.get("/oauth-authorization-server", (c) => c.json(authServerMetadata(c.get("baseUrl"))));
wellKnown.get("/oauth-authorization-server/*", (c) => c.json(authServerMetadata(c.get("baseUrl"))));
wellKnown.get("/oauth-protected-resource", (c) => c.json(protectedResourceMetadata(c.get("baseUrl"))));
wellKnown.get("/oauth-protected-resource/*", (c) => c.json(protectedResourceMetadata(c.get("baseUrl"))));

export function wwwAuthenticate(base: string, error?: string) {
  return `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"${error ? `, error="${error}"` : ""}`;
}

// ---------- helpers

class OAuthError extends Error {
  constructor(
    public error: string,
    public description: string,
    public status = 400,
  ) {
    super(description);
  }
}

function oauthJson(c: C, e: OAuthError) {
  c.header("cache-control", "no-store");
  if (e.status === 401) c.header("www-authenticate", 'Basic realm="tickler"');
  return c.json({ error: e.error, error_description: e.description }, e.status as 400);
}

/** https anywhere, http only on loopback, or a private-use scheme (cursor://, claude://...). */
export function validRedirectUri(u: string): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !["javascript:", "data:", "file:", "vbscript:", "blob:"].includes(url.protocol);
}

/** Exact match, except loopback redirect URIs may use any port (RFC 8252 7.3). */
function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return false;
    return registered.some((r) => {
      const x = new URL(r);
      return x.protocol === u.protocol && x.hostname === u.hostname && x.pathname === u.pathname && x.search === u.search;
    });
  } catch {
    return false;
  }
}

async function getClient(ctx: Ctx, clientId: string): Promise<OAuthClientRow | null> {
  const row = await ctx.storage.first<OAuthClientRow>("SELECT * FROM oauth_clients WHERE id = ?", [clientId]);
  if (row || !clientId.startsWith("https://")) return row;
  return fetchMetadataDocument(ctx, clientId);
}

/** Client ID metadata document: client_id is an https URL serving the client's metadata. */
async function fetchMetadataDocument(ctx: Ctx, url: string): Promise<OAuthClientRow | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.pathname === "/" || u.hash) return null;
    const res = await ctx.fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 5 * 1024) return null;
    const doc = JSON.parse(text) as { client_id?: string; client_name?: string; redirect_uris?: string[]; token_endpoint_auth_method?: string };
    if (doc.client_id !== url || !Array.isArray(doc.redirect_uris) || !doc.redirect_uris.every(validRedirectUri)) return null;
    if (doc.token_endpoint_auth_method && doc.token_endpoint_auth_method !== "none") return null;
    const now = ctx.now().toISOString();
    await ctx.storage.run(
      `INSERT INTO oauth_clients (id, name, redirect_uris, token_endpoint_auth_method, metadata, created_at) VALUES (?, ?, ?, 'none', ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, redirect_uris = excluded.redirect_uris, metadata = excluded.metadata`,
      [url, String(doc.client_name ?? u.hostname).slice(0, 100), JSON.stringify(doc.redirect_uris), text, now],
    );
    return ctx.storage.first<OAuthClientRow>("SELECT * FROM oauth_clients WHERE id = ?", [url]);
  } catch {
    return null;
  }
}

function checkResource(base: string, resource: string | undefined | null) {
  if (!resource) return;
  if (!sameResource(resource, `${base}/mcp`)) throw new OAuthError("invalid_target", "Unknown resource; use this server's /mcp URL");
}

// ---------- registration (RFC 7591)

oauth.post("/register", async (c) => {
  const ctx = c.get("ctx");
  try {
    await rateLimit(ctx, `oauth-register:${clientIp(c)}`, 20, 3600);
    let b: Record<string, unknown>;
    try {
      b = (await c.req.json()) as Record<string, unknown>;
    } catch {
      throw new OAuthError("invalid_client_metadata", "Body must be JSON");
    }
    const uris = b.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((u) => typeof u === "string" && validRedirectUri(u))) {
      throw new OAuthError("invalid_redirect_uri", "redirect_uris must be https, loopback http, or an app scheme");
    }
    const method = (b.token_endpoint_auth_method as string | undefined) ?? "none";
    if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
      throw new OAuthError("invalid_client_metadata", "Unsupported token_endpoint_auth_method");
    }
    const grants = (b.grant_types as string[] | undefined) ?? ["authorization_code", "refresh_token"];
    if (!Array.isArray(grants) || grants.some((g) => !["authorization_code", "refresh_token"].includes(g))) {
      throw new OAuthError("invalid_client_metadata", "Only authorization_code and refresh_token are supported");
    }
    const id = uuid();
    const secret = method === "none" ? null : randomToken("tkc_");
    const name = String(b.client_name ?? "MCP client").slice(0, 100);
    const now = ctx.now();
    await ctx.storage.run(
      `INSERT INTO oauth_clients (id, name, redirect_uris, client_secret_hash, token_endpoint_auth_method, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, JSON.stringify(uris), secret ? await sha256hex(secret) : null, method, JSON.stringify(b).slice(0, 5000), now.toISOString()],
    );
    await logActivity(ctx, { type: "oauth_client", id, name }, "oauth_register", `OAuth client "${name}" registered`);
    c.header("cache-control", "no-store");
    return c.json(
      {
        client_id: id,
        client_id_issued_at: Math.floor(now.getTime() / 1000),
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_name: name,
        redirect_uris: uris,
        grant_types: grants,
        response_types: ["code"],
        token_endpoint_auth_method: method,
        scope: SCOPE,
      },
      201,
    );
  } catch (e) {
    if (e instanceof OAuthError) return oauthJson(c, e);
    throw e;
  }
});

// ---------- authorization endpoint

interface AuthParams {
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  resource: string | null;
  scope: string;
}

/** Validate an authorization request. Errors before the redirect URI is trusted render a page. */
async function readAuthRequest(c: C, q: Record<string, string | undefined>) {
  const ctx = c.get("ctx");
  const client = q.client_id ? await getClient(ctx, q.client_id) : null;
  if (!client) return { page: "Unknown app. Remove the connector and add it again." };
  const registered = JSON.parse(client.redirect_uris) as string[];
  const redirect = q.redirect_uri ?? (registered.length === 1 ? registered[0] : undefined);
  if (!redirect || !redirectMatches(registered, redirect)) return { page: "This app's redirect address doesn't match its registration." };
  const base = c.get("baseUrl");
  const fail = (error: string, desc: string) => {
    const u = new URL(redirect);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", desc);
    if (q.state) u.searchParams.set("state", q.state);
    u.searchParams.set("iss", base);
    return { redirect: u.toString() };
  };
  if (q.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
  if (!q.code_challenge || q.code_challenge_method !== "S256") return fail("invalid_request", "PKCE with S256 is required");
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) return fail("invalid_request", "Bad code_challenge");
  try {
    checkResource(base, q.resource);
  } catch (e) {
    return fail("invalid_target", (e as Error).message);
  }
  const params: AuthParams = {
    client_id: client.id,
    redirect_uri: redirect,
    state: q.state ?? null,
    code_challenge: q.code_challenge,
    resource: q.resource ?? null,
    scope: SCOPE,
  };
  return { client, params };
}

function oauthPage(c: C, title: string, body: unknown) {
  return c.html(
    <Layout title={title} serverName={c.get("ctx").config.serverName}>
      {body as never}
    </Layout>,
  );
}

oauth.get("/authorize", async (c) => {
  const ctx = c.get("ctx");
  await rateLimit(ctx, `oauth:${clientIp(c)}`, 60, 60);
  const r = await readAuthRequest(c, c.req.query());
  if ("page" in r) return oauthPage(c, "Can't connect", <div class="card"><Flash error={r.page} /></div>);
  if ("redirect" in r) return c.redirect(r.redirect!);
  if (!(await validSession(ctx, getCookie(c, SESSION_COOKIE)))) {
    const next = c.req.url.slice(new URL(c.req.url).origin.length);
    return oauthPage(
      c,
      "Sign in",
      <>
        <p class="muted">Sign in to let {r.client.name} use your Tickler.</p>
        <LoginForm next={next} hasPasskeys={(await listPasskeys(ctx)).length > 0} />
      </>,
    );
  }
  const p = r.params;
  return oauthPage(
    c,
    "Allow access",
    <div class="card">
      <h1>Allow {r.client.name}?</h1>
      <p>
        {r.client.name} will be able to read and add entries, projects and agent sessions on this Tickler server, and read your money
        summary.
      </p>
      <p class="muted">It will come back to {new URL(p.redirect_uri).host || p.redirect_uri}. You can revoke it any time on /setup.</p>
      <form method="post" action="/oauth/authorize" class="row">
        <input type="hidden" name="client_id" value={p.client_id} />
        <input type="hidden" name="redirect_uri" value={p.redirect_uri} />
        <input type="hidden" name="state" value={p.state ?? ""} />
        <input type="hidden" name="code_challenge" value={p.code_challenge} />
        <input type="hidden" name="code_challenge_method" value="S256" />
        <input type="hidden" name="response_type" value="code" />
        <input type="hidden" name="resource" value={p.resource ?? ""} />
        <button type="submit" name="decision" value="allow">
          Allow
        </button>
        <button type="submit" name="decision" value="deny" class="secondary">
          Deny
        </button>
      </form>
    </div>,
  );
});

oauth.post("/authorize", async (c) => {
  const ctx = c.get("ctx");
  if (!(await validSession(ctx, getCookie(c, SESSION_COOKIE)))) throw new ApiError(401, "unauthorized", "Sign in again");
  const f = await c.req.parseBody();
  const q: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(f)) if (typeof v === "string" && v !== "") q[k] = v;
  const r = await readAuthRequest(c, q);
  if ("page" in r) return oauthPage(c, "Can't connect", <div class="card"><Flash error={r.page} /></div>);
  if ("redirect" in r) return c.redirect(r.redirect!);
  const p = r.params;
  const u = new URL(p.redirect_uri);
  if (p.state) u.searchParams.set("state", p.state);
  u.searchParams.set("iss", c.get("baseUrl"));
  if (q.decision !== "allow") {
    u.searchParams.set("error", "access_denied");
    return c.redirect(u.toString());
  }
  const code = randomToken("tka_");
  await ctx.storage.run(
    `INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [await sha256hex(code), p.client_id, p.redirect_uri, p.code_challenge, p.scope, p.resource, new Date(ctx.now().getTime() + CODE_TTL_MS).toISOString()],
  );
  await logActivity(ctx, { type: "admin", id: "admin", name: "Admin" }, "oauth_authorize", `Allowed "${r.client.name}"`);
  u.searchParams.set("code", code);
  return c.redirect(u.toString());
});

// ---------- token endpoint

async function authenticateClient(c: C, f: Record<string, string>): Promise<OAuthClientRow> {
  const ctx = c.get("ctx");
  let id = f.client_id;
  let secret = f.client_secret;
  const basic = /^Basic\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
  if (basic) {
    const [u, p] = atob(basic[1]!).split(":");
    id = decodeURIComponent(u ?? "");
    secret = decodeURIComponent(p ?? "");
  }
  if (!id) throw new OAuthError("invalid_client", "client_id is required", 401);
  const client = await getClient(ctx, id);
  if (!client) throw new OAuthError("invalid_client", "Unknown client", 401);
  if (client.client_secret_hash) {
    if (!secret || !timingSafeEqual(await sha256hex(secret), client.client_secret_hash)) {
      throw new OAuthError("invalid_client", "Bad client credentials", 401);
    }
  }
  return client;
}

async function issueTokens(ctx: Ctx, clientId: string, resource: string | null) {
  const now = ctx.now();
  const access = randomToken("tko_");
  const refresh = randomToken("tkr_");
  const ins = "INSERT INTO oauth_tokens (token_hash, kind, client_id, scope, resource, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)";
  await ctx.storage.batch([
    { sql: ins, params: [await sha256hex(access), "access", clientId, SCOPE, resource, now.toISOString(), new Date(now.getTime() + ACCESS_TTL_S * 1000).toISOString()] },
    { sql: ins, params: [await sha256hex(refresh), "refresh", clientId, SCOPE, resource, now.toISOString(), new Date(now.getTime() + REFRESH_TTL_S * 1000).toISOString()] },
    { sql: "UPDATE oauth_clients SET last_used_at = ? WHERE id = ?", params: [now.toISOString(), clientId] },
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE };
}

oauth.post("/token", async (c) => {
  const ctx = c.get("ctx");
  try {
    await rateLimit(ctx, `oauth-token:${clientIp(c)}`, 60, 60);
    const body = await c.req.parseBody();
    const f: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") f[k] = v;
    const client = await authenticateClient(c, f);
    const now = ctx.now();
    const base = c.get("baseUrl");
    checkResource(base, f.resource);

    if (f.grant_type === "authorization_code") {
      if (!f.code || !f.code_verifier) throw new OAuthError("invalid_request", "code and code_verifier are required");
      const hash = await sha256hex(f.code);
      const row = await ctx.storage.first<{ client_id: string; redirect_uri: string; code_challenge: string; resource: string | null; expires_at: string; used_at: string | null }>(
        "SELECT * FROM oauth_codes WHERE code_hash = ?",
        [hash],
      );
      if (!row || row.client_id !== client.id || row.used_at || Date.parse(row.expires_at) <= now.getTime()) {
        throw new OAuthError("invalid_grant", "Code is invalid, used or expired");
      }
      if (f.redirect_uri && f.redirect_uri !== row.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri mismatch");
      if ((await sha256b64url(f.code_verifier)) !== row.code_challenge) throw new OAuthError("invalid_grant", "PKCE verification failed");
      if (f.resource && row.resource && !sameResource(f.resource, row.resource)) throw new OAuthError("invalid_target", "resource mismatch");
      const claim = await ctx.storage.run("UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL", [now.toISOString(), hash]);
      if (claim.changes !== 1) throw new OAuthError("invalid_grant", "Code already used");
      c.header("cache-control", "no-store");
      return c.json(await issueTokens(ctx, client.id, f.resource || row.resource || `${base}/mcp`));
    }

    if (f.grant_type === "refresh_token") {
      if (!f.refresh_token) throw new OAuthError("invalid_request", "refresh_token is required");
      const hash = await sha256hex(f.refresh_token);
      const row = await ctx.storage.first<{ client_id: string; resource: string | null; expires_at: string; revoked_at: string | null }>(
        "SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'",
        [hash],
      );
      if (!row || row.client_id !== client.id || row.revoked_at || Date.parse(row.expires_at) <= now.getTime()) {
        throw new OAuthError("invalid_grant", "Refresh token is invalid or expired");
      }
      const claim = await ctx.storage.run("UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL", [now.toISOString(), hash]);
      if (claim.changes !== 1) throw new OAuthError("invalid_grant", "Refresh token already used");
      c.header("cache-control", "no-store");
      return c.json(await issueTokens(ctx, client.id, row.resource));
    }

    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  } catch (e) {
    if (e instanceof OAuthError) return oauthJson(c, e);
    if (e instanceof ApiError && e.status === 429) return oauthJson(c, new OAuthError("slow_down", e.message, 429));
    throw e;
  }
});

// ---------- revocation (RFC 7009)

oauth.post("/revoke", async (c) => {
  const ctx = c.get("ctx");
  try {
    const body = await c.req.parseBody();
    const f: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") f[k] = v;
    const client = await authenticateClient(c, f);
    if (f.token) {
      await ctx.storage.run("UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ? AND client_id = ? AND revoked_at IS NULL", [
        ctx.now().toISOString(),
        await sha256hex(f.token),
        client.id,
      ]);
    }
    return c.body(null, 200);
  } catch (e) {
    if (e instanceof OAuthError) return oauthJson(c, e);
    throw e;
  }
});
