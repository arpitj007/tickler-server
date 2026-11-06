// Secrets: AES-GCM for provider credentials (key from TICKLER_SECRET via HKDF-SHA256),
// PBKDF2-SHA256 for the admin passphrase. PBKDF2 is capped at 100,000 iterations on
// Cloudflare Workers (https://developers.cloudflare.com/workers/runtime-apis/web-crypto/, checked 2026-11-06).
import { b64url, fromB64url, randomBytes, timingSafeEqual } from "./util";

const enc = new TextEncoder();

async function hkdfKey(secret: string, info: string, usage: KeyUsage[], alg: AesKeyGenParams | HmacImportParams) {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("tickler-v1"), info: enc.encode(info) },
    base,
    alg,
    false,
    usage,
  );
}

export async function encryptJson(secret: string, value: unknown): Promise<string> {
  const key = await hkdfKey(secret, "provider-credentials", ["encrypt"], { name: "AES-GCM", length: 256 });
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value))));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

export async function decryptJson<T>(secret: string, blob: string): Promise<T> {
  const [v, ivs, cts] = blob.split(".");
  if (v !== "v1" || !ivs || !cts) throw new Error("bad ciphertext");
  const key = await hkdfKey(secret, "provider-credentials", ["decrypt"], { name: "AES-GCM", length: 256 });
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(ivs) }, key, fromB64url(cts));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

export const PBKDF2_ITERATIONS = 100_000;

export async function hashPassphrase(passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  const hash = await pbkdf2(passphrase, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassphrase(passphrase: string, stored: string): Promise<boolean> {
  const [alg, it, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2-sha256" || !it || !salt || !hash) return false;
  const got = await pbkdf2(passphrase, fromB64url(salt), Number(it));
  return timingSafeEqual(b64url(got), hash);
}

async function pbkdf2(passphrase: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}
