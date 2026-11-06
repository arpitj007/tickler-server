// Minimal X.509 (DER) reader and signature check with WebCrypto. Just enough to verify
// Apple's JWS certificate chain and the Amazon SNS signing certificate. Not a general
// purpose PKI library: no name constraints, policies or revocation.

import { ab, b64decode } from "./util";

interface Tlv {
  tag: number;
  start: number; // offset of the tag byte
  body: number; // offset of the value
  end: number; // offset after the value
}

function readTlv(d: Uint8Array, p: number): Tlv {
  const tag = d[p];
  let len = d[p + 1];
  let body = p + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("bad DER length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + d[p + 2 + i];
    body += n;
  }
  if (body + len > d.length) throw new Error("truncated DER");
  return { tag, start: p, body, end: body + len };
}

function children(d: Uint8Array, t: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let p = t.body; p < t.end; ) {
    const c = readTlv(d, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

function oid(d: Uint8Array, t: Tlv): string {
  const b = d.subarray(t.body, t.end);
  const parts = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) {
      parts.push(v);
      v = 0;
    }
  }
  return parts.join(".");
}

function time(d: Uint8Array, t: Tlv): Date {
  const s = new TextDecoder().decode(d.subarray(t.body, t.end));
  // UTCTime YYMMDDHHMMSSZ or GeneralizedTime YYYYMMDDHHMMSSZ
  const full = t.tag === 0x17 ? (Number(s.slice(0, 2)) >= 50 ? "19" : "20") + s : s;
  return new Date(
    Date.UTC(+full.slice(0, 4), +full.slice(4, 6) - 1, +full.slice(6, 8), +full.slice(8, 10), +full.slice(10, 12), +full.slice(12, 14)),
  );
}

export interface Cert {
  der: Uint8Array;
  tbs: Uint8Array;
  sigAlg: string;
  signature: Uint8Array;
  issuer: Uint8Array;
  subject: Uint8Array;
  notBefore: Date;
  notAfter: Date;
  spki: Uint8Array;
  keyAlg: string;
  keyCurve: string | null;
  extensions: Map<string, { critical: boolean; value: Uint8Array }>;
  isCA: boolean;
}

export const OID = {
  ecPublicKey: "1.2.840.10045.2.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
  p256: "1.2.840.10045.3.1.7",
  p384: "1.3.132.0.34",
  ecdsaSha256: "1.2.840.10045.4.3.2",
  ecdsaSha384: "1.2.840.10045.4.3.3",
  rsaSha1: "1.2.840.113549.1.1.5",
  rsaSha256: "1.2.840.113549.1.1.11",
  basicConstraints: "2.5.29.19",
};

export function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, "").replace(/\s+/g, "");
  return b64decode(body);
}

export function parseCert(input: Uint8Array | string): Cert {
  const der = typeof input === "string" ? (input.includes("BEGIN") ? pemToDer(input) : b64decode(input)) : input;
  const root = readTlv(der, 0);
  const [tbsT, algT, sigT] = children(der, root);
  const tbsParts = children(der, tbsT);
  let i = tbsParts[0].tag === 0xa0 ? 1 : 0; // explicit version
  i++; // serial
  i++; // signature algorithm (inner)
  const issuerT = tbsParts[i++];
  const validity = children(der, tbsParts[i++]);
  const subjectT = tbsParts[i++];
  const spkiT = tbsParts[i++];
  const spkiAlg = children(der, children(der, spkiT)[0]);
  const keyAlg = oid(der, spkiAlg[0]);
  const keyCurve = spkiAlg[1]?.tag === 0x06 ? oid(der, spkiAlg[1]) : null;

  const extensions = new Map<string, { critical: boolean; value: Uint8Array }>();
  let isCA = false;
  for (; i < tbsParts.length; i++) {
    if (tbsParts[i].tag !== 0xa3) continue;
    const seq = children(der, tbsParts[i])[0];
    for (const ext of children(der, seq)) {
      const parts = children(der, ext);
      const id = oid(der, parts[0]);
      const critical = parts.length === 3 && der[parts[1].body] !== 0;
      const valT = parts[parts.length - 1];
      const value = der.subarray(valT.body, valT.end);
      extensions.set(id, { critical, value });
      if (id === OID.basicConstraints) {
        const bc = readTlv(value, 0);
        const first = bc.body < bc.end ? readTlv(value, bc.body) : null;
        isCA = !!first && first.tag === 0x01 && value[first.body] !== 0;
      }
    }
  }

  return {
    der,
    tbs: der.subarray(tbsT.start, tbsT.end),
    sigAlg: oid(der, children(der, algT)[0]),
    signature: der.subarray(sigT.body + 1, sigT.end), // skip "unused bits" byte
    issuer: der.subarray(issuerT.start, issuerT.end),
    subject: der.subarray(subjectT.start, subjectT.end),
    notBefore: time(der, validity[0]),
    notAfter: time(der, validity[1]),
    spki: der.subarray(spkiT.start, spkiT.end),
    keyAlg,
    keyCurve,
    extensions,
    isCA,
  };
}

/** Import the certificate's public key for verifying signatures made with `hash`. */
export async function publicKey(cert: Cert, hash: "SHA-1" | "SHA-256" | "SHA-384" = "SHA-256"): Promise<CryptoKey> {
  if (cert.keyAlg === OID.ecPublicKey) {
    const namedCurve = cert.keyCurve === OID.p384 ? "P-384" : cert.keyCurve === OID.p256 ? "P-256" : null;
    if (!namedCurve) throw new Error("unsupported EC curve");
    return crypto.subtle.importKey("spki", ab(cert.spki), { name: "ECDSA", namedCurve }, true, ["verify"]);
  }
  if (cert.keyAlg === OID.rsaEncryption) {
    return crypto.subtle.importKey("spki", ab(cert.spki), { name: "RSASSA-PKCS1-v1_5", hash }, true, ["verify"]);
  }
  throw new Error("unsupported key algorithm");
}

/** ECDSA DER signature (SEQUENCE { r, s }) to the raw r||s form WebCrypto wants. */
export function ecdsaDerToRaw(sig: Uint8Array, size: number): Uint8Array {
  const seq = readTlv(sig, 0);
  const [r, s] = children(sig, seq);
  const out = new Uint8Array(size * 2);
  const put = (t: Tlv, off: number) => {
    let v = sig.subarray(t.body, t.end);
    while (v.length > size && v[0] === 0) v = v.subarray(1);
    if (v.length > size) throw new Error("bad ECDSA signature");
    out.set(v, off + size - v.length);
  };
  put(r, 0);
  put(s, size);
  return out;
}

/** True when `cert` was signed by `issuer`'s key. */
export async function verifySignedBy(cert: Cert, issuer: Cert): Promise<boolean> {
  try {
    if (cert.sigAlg === OID.ecdsaSha256 || cert.sigAlg === OID.ecdsaSha384) {
      const hash = cert.sigAlg === OID.ecdsaSha384 ? "SHA-384" : "SHA-256";
      const key = await publicKey(issuer);
      const size = issuer.keyCurve === OID.p384 ? 48 : 32;
      return await crypto.subtle.verify({ name: "ECDSA", hash }, key, ab(ecdsaDerToRaw(cert.signature, size)), ab(cert.tbs));
    }
    if (cert.sigAlg === OID.rsaSha256 || cert.sigAlg === OID.rsaSha1) {
      const key = await publicKey(issuer, cert.sigAlg === OID.rsaSha1 ? "SHA-1" : "SHA-256");
      return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, ab(cert.signature), ab(cert.tbs));
    }
    return false;
  } catch {
    return false;
  }
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function validAt(cert: Cert, at: Date): boolean {
  return cert.notBefore.getTime() <= at.getTime() && at.getTime() <= cert.notAfter.getTime();
}
