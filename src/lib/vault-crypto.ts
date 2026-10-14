/**
 * End-to-end encryption for the finance vault, using only WebCrypto.
 *
 * The passphrase never leaves the browser. It is stretched with PBKDF2-SHA256
 * (600,000 iterations, a random 16-byte salt per passphrase) into a
 * non-extractable AES-GCM-256 key. Each save gzips the JSON (when the browser
 * supports CompressionStream) and encrypts it under a fresh random 12-byte IV,
 * with a fixed AAD so a vault ciphertext can't be passed off as anything else.
 * A wrong passphrase or any tampering makes AES-GCM decryption fail.
 */

import type { VaultEnvelope, VaultKdf } from "./vault-envelope";

export const KDF_ITERATIONS = 600_000;
/** For a new passphrase. The ciphertext is only as strong as the passphrase against someone who gets a copy. */
export const MIN_NEW_PASSPHRASE = 16;
const AAD = new TextEncoder().encode("ericlau.io/finance/vault/v1");

/** Why a new passphrase is too weak, or null if it's fine. */
export function passphraseProblem(p: string): string | null {
  if (p.length < MIN_NEW_PASSPHRASE) return `Use at least ${MIN_NEW_PASSPHRASE} characters.`;
  if (new Set(p).size < 8) return "Use more different characters.";
  if (/^\d+$/.test(p)) return "Don't use only numbers.";
  return null;
}

// No look-alikes (0/o, 1/l/i), so it's easy to type on a phone.
const SUGGEST_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** A random passphrase like "k3vxq-9mqar-...": 20 characters from 31, about 99 bits. */
export function suggestPassphrase(): string {
  const out: string[] = [];
  // Rejection sampling keeps every character equally likely.
  while (out.length < 20) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < 248 && out.length < 20) out.push(SUGGEST_ALPHABET[b % 31]);
    }
  }
  return [0, 5, 10, 15].map((i) => out.slice(i, i + 5).join("")).join("-");
}

/** Thrown when the passphrase (or remembered key) doesn't open the vault. */
export class WrongPassphraseError extends Error {
  constructor() {
    super("That passphrase doesn't unlock this data.");
    this.name = "WrongPassphraseError";
  }
}

export function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** KDF parameters for a newly chosen passphrase (always a fresh salt). */
export function newKdf(iterations = KDF_ITERATIONS): VaultKdf {
  return { name: "PBKDF2", hash: "SHA-256", iterations, salt: toB64(random(16)) };
}

export async function deriveKey(passphrase: string, kdf: VaultKdf): Promise<CryptoKey> {
  // NFKC so the same passphrase typed on different keyboards gives the same bytes.
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64(kdf.salt), iterations: kdf.iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function seal(key: CryptoKey, kdf: VaultKdf, data: unknown): Promise<VaultEnvelope> {
  let plain: Uint8Array<ArrayBuffer> = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream !== "undefined") plain = await pipe(plain, new CompressionStream("gzip"));
  const iv = random(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, plain));
  return { v: 1, kdf, iv: toB64(iv), ct: toB64(ct) };
}

export async function open<T = unknown>(key: CryptoKey, envelope: VaultEnvelope): Promise<T> {
  let plain: Uint8Array<ArrayBuffer>;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(envelope.iv), additionalData: AAD }, key, fromB64(envelope.ct)),
    );
  } catch {
    throw new WrongPassphraseError();
  }
  // gzip starts with 1f 8b; uncompressed JSON starts with "{".
  if (plain[0] === 0x1f && plain[1] === 0x8b) plain = await pipe(plain, new DecompressionStream("gzip"));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
