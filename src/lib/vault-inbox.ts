/**
 * The phone feed's drop box: payments captured from the owner's phone are
 * encrypted the moment they reach the site, to a public key whose private
 * half lives only inside the (passphrase-encrypted) vault. So the database
 * never holds a readable payment, and only the unlocked page can open them.
 *
 * Sealing is ECIES with WebCrypto only (works in Workers and browsers): a
 * fresh ephemeral ECDH P-256 key per message, HKDF-SHA256 over the shared
 * secret (salted with the ephemeral public key), then AES-GCM-256.
 *
 * The phone authenticates with a random "phone key" (a bearer token). The
 * site stores only its SHA-256, and the token can only add to the drop box:
 * it can't read anything back.
 */

import { fromB64, toB64 } from "./vault-crypto";

export type InboxEnvelope = { v: 1; epk: string; iv: string; ct: string };
export type InboxKeys = { privateJwk: JsonWebKey; publicJwk: JsonWebKey };

const INFO = new TextEncoder().encode("ericlau.io/finance/inbox/v1");
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

const pub = (j: JsonWebKey): JsonWebKey => ({ kty: "EC", crv: "P-256", x: j.x, y: j.y });

/** A public P-256 key as JWK, with no private part. */
export function isPublicKeyJwk(j: unknown): j is JsonWebKey {
  const k = j as JsonWebKey;
  const b64u = (s: unknown) => typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);
  return !!k && typeof k === "object" && k.kty === "EC" && k.crv === "P-256" && b64u(k.x) && b64u(k.y) && !("d" in k);
}

export async function newInboxKeys(): Promise<InboxKeys> {
  const kp = (await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])) as CryptoKeyPair;
  return {
    privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey),
    publicJwk: pub(await crypto.subtle.exportKey("jwk", kp.publicKey)),
  };
}

async function messageKey(shared: ArrayBuffer, epkRaw: Uint8Array<ArrayBuffer>) {
  const ikm = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: epkRaw, info: INFO },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealToInbox(publicJwk: JsonWebKey, data: unknown): Promise<InboxEnvelope> {
  const recipient = await crypto.subtle.importKey("jwk", pub(publicJwk), ECDH, false, []);
  const eph = (await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])) as CryptoKeyPair;
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: recipient }, eph.privateKey, 256);
  const epkRaw = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const key = await messageKey(shared, epkRaw);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: INFO }, key, plain));
  return { v: 1, epk: toB64(epkRaw), iv: toB64(iv), ct: toB64(ct) };
}

/** Throws if `privateJwk` isn't the key this was sealed to, or the envelope was tampered with. */
export async function openInbox<T = unknown>(privateJwk: JsonWebKey, env: InboxEnvelope): Promise<T> {
  const priv = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: privateJwk.x, y: privateJwk.y, d: privateJwk.d },
    ECDH,
    false,
    ["deriveBits"],
  );
  const epkRaw = fromB64(env.epk);
  const epk = await crypto.subtle.importKey("raw", epkRaw, ECDH, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: epk }, priv, 256);
  const key = await messageKey(shared, epkRaw);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(env.iv), additionalData: INFO }, key, fromB64(env.ct));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

export function parseInboxEnvelope(raw: unknown): InboxEnvelope | null {
  const e = raw as Record<string, unknown>;
  const b64 = (s: unknown, min: number, max: number) =>
    typeof s === "string" && s.length >= min && s.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
  if (!e || e.v !== 1 || !b64(e.epk, 88, 88) || !b64(e.iv, 16, 16) || !b64(e.ct, 24, 16_000)) return null;
  return { v: 1, epk: e.epk as string, iv: e.iv as string, ct: e.ct as string };
}

/** A new phone key: 32 random bytes, base64url (43 characters). */
export function newPhoneToken(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare two equal-length hex digests without an early exit. */
export function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
