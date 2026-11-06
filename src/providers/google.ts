// Google service account auth (JWT bearer grant, RS256) and Pub/Sub push OIDC verification.
// Docs: https://developers.google.com/identity/protocols/oauth2/service-account
//       https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions

import { createLocalJWKSet, importPKCS8, jwtVerify, SignJWT, type JSONWebKeySet } from "jose";
import { requestJson } from "./util";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  project_id?: string;
}

export function parseServiceAccount(json: string): ServiceAccount {
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(json);
  } catch {
    throw new Error("The service account key is not valid JSON. Paste the whole downloaded .json file.");
  }
  if (!sa.client_email || !sa.private_key) throw new Error("The service account JSON has no client_email or private_key.");
  return sa;
}

const tokens = new Map<string, { token: string; exp: number }>();

/** OAuth access token for the service account, cached until 5 minutes before expiry. */
export async function googleToken(fetchFn: typeof fetch, sa: ServiceAccount, scopes: string[], now: Date): Promise<string> {
  const cacheKey = `${sa.client_email}|${scopes.join(" ")}`;
  const hit = tokens.get(cacheKey);
  const t = Math.floor(now.getTime() / 1000);
  if (hit && hit.exp - 300 > t) return hit.token;
  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope: scopes.join(" ") })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(t)
    .setExpirationTime(t + 3600)
    .sign(key);
  const r: any = await requestJson(fetchFn, "Google OAuth", "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${assertion}`,
  });
  tokens.set(cacheKey, { token: r.access_token, exp: t + (r.expires_in ?? 3600) });
  return r.access_token;
}

export function clearGoogleTokenCache(): void {
  tokens.clear();
}

const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";
let jwksCache: { jwks: JSONWebKeySet; until: number } | null = null;

/**
 * Verify a Pub/Sub push OIDC token: Google signature, issuer, audience, expiry, and (if given)
 * the push service account email. Throws on failure.
 */
export async function verifyGoogleOidc(
  authorization: string | undefined,
  opts: { audience: string; email?: string; fetch: typeof fetch; now: Date },
): Promise<void> {
  const m = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (!m) throw new Error("missing bearer token");
  const nowMs = opts.now.getTime();
  if (!jwksCache || jwksCache.until < nowMs) {
    const jwks = await requestJson<JSONWebKeySet>(opts.fetch, "Google JWKS", GOOGLE_JWKS);
    jwksCache = { jwks, until: nowMs + 3600_000 };
  }
  const { payload } = await jwtVerify(m[1], createLocalJWKSet(jwksCache.jwks), {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: opts.audience,
    algorithms: ["RS256"],
    currentDate: opts.now,
  });
  if (opts.email) {
    if (payload.email !== opts.email || payload.email_verified !== true) throw new Error("token is not from the expected service account");
  }
}

export function clearJwksCache(): void {
  jwksCache = null;
}
