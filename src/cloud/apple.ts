// Apple pieces of Tickler Cloud: Sign in with Apple and StoreKit 2 signed transactions.
// Docs checked 2026-11-08:
// - https://developer.apple.com/documentation/sign_in_with_apple/verifying-a-user
// - https://developer.apple.com/documentation/sign_in_with_apple/generate-and-validate-tokens
// - https://developer.apple.com/documentation/sign_in_with_apple/revoke-tokens
// - https://developer.apple.com/documentation/appstoreserverapi/jwstransactiondecodedpayload
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify, type JWTVerifyGetKey } from "jose";
import { verifyAppleJws } from "../providers/app_store";
import { sha256hex } from "../core/util";

const APPLE_ISSUER = "https://appleid.apple.com";
let appleKeys: JWTVerifyGetKey | null = null;

export interface AppleConfig {
  bundleId: string;
  acceptSandbox: boolean;
  /** Sign in with Apple key, for exchanging the authorization code and revoking on account deletion. */
  teamId: string | null;
  siwaKeyId: string | null;
  siwaPrivateKey: string | null;
}

/** Verify a Sign in with Apple identity token. The app passes SHA-256(raw nonce) to Apple. */
export async function verifyIdentityToken(token: string, rawNonce: string, cfg: AppleConfig, keys?: JWTVerifyGetKey) {
  appleKeys ??= createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));
  const { payload } = await jwtVerify(token, keys ?? appleKeys, { issuer: APPLE_ISSUER, audience: cfg.bundleId });
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("identity token has no subject");
  if (payload.nonce !== (await sha256hex(rawNonce))) throw new Error("identity token nonce mismatch");
  return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
}

function siwaConfigured(cfg: AppleConfig) {
  return !!(cfg.teamId && cfg.siwaKeyId && cfg.siwaPrivateKey);
}

async function clientSecret(cfg: AppleConfig, now: Date) {
  const key = await importPKCS8(cfg.siwaPrivateKey!.replace(/\\n/g, "\n"), "ES256");
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: cfg.siwaKeyId! })
    .setIssuer(cfg.teamId!)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .setAudience(APPLE_ISSUER)
    .setSubject(cfg.bundleId)
    .sign(key);
}

/** Exchange the authorization code for a refresh token. Null when no Sign in with Apple key is set up. */
export async function exchangeAuthorizationCode(code: string, cfg: AppleConfig, now: Date, f: typeof fetch = fetch): Promise<string | null> {
  if (!siwaConfigured(cfg) || !code) return null;
  const res = await f(`${APPLE_ISSUER}/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.bundleId, client_secret: await clientSecret(cfg, now), code, grant_type: "authorization_code" }),
  });
  if (!res.ok) throw new Error(`Apple token exchange failed: HTTP ${res.status}`);
  const j = (await res.json()) as { refresh_token?: string };
  return j.refresh_token ?? null;
}

/** Revoke the user's Sign in with Apple token (account deletion). Best effort. */
export async function revokeAppleToken(refreshToken: string, cfg: AppleConfig, now: Date, f: typeof fetch = fetch): Promise<boolean> {
  if (!siwaConfigured(cfg)) return false;
  const res = await f(`${APPLE_ISSUER}/auth/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.bundleId, client_secret: await clientSecret(cfg, now), token: refreshToken, token_type_hint: "refresh_token" }),
  });
  return res.ok;
}

export interface CloudTransaction {
  productId: string;
  appAccountToken: string | null;
  originalTransactionId: string;
  expiresAt: Date | null;
  revoked: boolean;
  environment: string;
}

/** Verify a StoreKit 2 / App Store Server signed transaction (JWS with Apple's x5c chain). */
export async function verifyTransaction(jws: string, cfg: AppleConfig, now: Date, roots?: string[]): Promise<CloudTransaction> {
  const p = await verifyAppleJws(jws, { now, roots });
  if (p.bundleId !== cfg.bundleId) throw new Error("transaction is for another app");
  if (p.environment !== "Production" && !cfg.acceptSandbox) throw new Error("sandbox transactions are not accepted here");
  return {
    productId: String(p.productId ?? ""),
    appAccountToken: typeof p.appAccountToken === "string" ? p.appAccountToken.toLowerCase() : null,
    originalTransactionId: String(p.originalTransactionId ?? p.transactionId ?? ""),
    expiresAt: typeof p.expiresDate === "number" ? new Date(p.expiresDate) : null,
    revoked: typeof p.revocationDate === "number",
    environment: String(p.environment ?? "Production"),
  };
}

/** Verify an App Store Server Notification v2 and return its decoded payload. */
export async function verifyNotification(signedPayload: string, cfg: AppleConfig, now: Date, roots?: string[]) {
  const n = await verifyAppleJws(signedPayload, { now, roots });
  if (n.data?.bundleId && n.data.bundleId !== cfg.bundleId) throw new Error("notification is for another app");
  if (n.data?.environment && n.data.environment !== "Production" && !cfg.acceptSandbox) throw new Error("sandbox notifications are not accepted here");
  return n as { notificationType: string; subtype?: string; notificationUUID: string; data?: { signedTransactionInfo?: string } };
}
