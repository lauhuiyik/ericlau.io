/**
 * The encrypted finance vault as it is stored on the site.
 *
 * The browser encrypts the data with a key derived from the owner's
 * passphrase (src/lib/vault-crypto.ts) and the server only ever stores this
 * envelope: KDF parameters, an IV and ciphertext. It is shared by the client
 * and the /experiments/finance/vault route, which validates every envelope it
 * accepts but can never decrypt one.
 */

export type VaultKdf = { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
export type VaultEnvelope = { v: 1; kdf: VaultKdf; iv: string; ct: string };

/** D1 rows top out at 2 MB; leave headroom for the rest of the row. */
export const MAX_CT_CHARS = 1_800_000;
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 5_000_000;

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
// Base64 lengths: a 16-byte salt is 24 characters, a 12-byte IV is 16.
const SALT_CHARS = 24;
const IV_CHARS = 16;

export function parseEnvelope(raw: unknown): { ok: true; envelope: VaultEnvelope } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "envelope must be an object" };
  const e = raw as Record<string, unknown>;
  const kdf = e.kdf as Record<string, unknown> | undefined;
  if (e.v !== 1) return { ok: false, error: "unsupported envelope version" };
  if (!kdf || typeof kdf !== "object" || kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256") {
    return { ok: false, error: "unsupported key derivation" };
  }
  const iterations = kdf.iterations;
  if (typeof iterations !== "number" || !Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    return { ok: false, error: "bad iteration count" };
  }
  if (typeof kdf.salt !== "string" || kdf.salt.length !== SALT_CHARS || !B64.test(kdf.salt)) return { ok: false, error: "bad salt" };
  if (typeof e.iv !== "string" || e.iv.length !== IV_CHARS || !B64.test(e.iv)) return { ok: false, error: "bad iv" };
  if (typeof e.ct !== "string" || e.ct.length < 24 || e.ct.length > MAX_CT_CHARS || e.ct.length % 4 !== 0 || !B64.test(e.ct)) {
    return { ok: false, error: "bad ciphertext" };
  }
  // Rebuild from the checked fields only, so nothing else is ever stored.
  return {
    ok: true,
    envelope: { v: 1, kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: kdf.salt }, iv: e.iv, ct: e.ct },
  };
}
