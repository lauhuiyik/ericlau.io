/**
 * Server-side proof that a request came through Cloudflare Access.
 *
 * Access is configured in the Cloudflare dashboard, so nothing in this repo
 * shows whether a path is actually covered — and a dashboard slip would make
 * a private page public without any code changing. Pages that must stay
 * private call checkAccess() and refuse to render unless the request carries
 * a valid Access token for our Access application.
 *
 * Access adds that token to every request it lets through, in the
 * Cf-Access-Jwt-Assertion header: an RS256 JWT signed with keys published at
 * https://<team>.cloudflareaccess.com/cdn-cgi/access/certs, whose `aud`
 * contains the Access application's AUD tag.
 *
 * Fails closed: if CF_ACCESS_TEAM_DOMAIN or CF_ACCESS_AUD isn't set, or the
 * token is missing, forged, expired or for another application, it denies.
 */

type Jwk = JsonWebKey & { kid?: string };
export type AccessResult = { ok: true; email?: string } | { ok: false; reason: string };

const CERTS_TTL_MS = 60 * 60 * 1000;
/** After a key rotation, refetch early for an unknown kid, but at most this often. */
const CERTS_FORCED_REFRESH_MS = 60 * 1000;
let certsCache: { url: string; at: number; keys: Jwk[] } | null = null;
let lastForcedRefresh = 0;

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

/** "ericlau.cloudflareaccess.com", with or without scheme or trailing slash. */
export const normaliseTeamDomain = (d: string) => d.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");

async function fetchKeys(teamDomain: string, force = false): Promise<Jwk[]> {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (!force && certsCache && certsCache.url === url && Date.now() - certsCache.at < CERTS_TTL_MS) return certsCache.keys;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  if (keys.length === 0) throw new Error("no signing keys"); // never cache an empty key set
  certsCache = { url, at: Date.now(), keys };
  return keys;
}

export async function verifyAccessJwt(
  token: string,
  opts: { teamDomain: string; aud: string; keys: Jwk[]; now?: number },
): Promise<AccessResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };
  let sig: Uint8Array<ArrayBuffer>;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
    sig = b64urlToBytes(parts[2]);
  } catch {
    return { ok: false, reason: "malformed token" };
  }
  if (!header || typeof header !== "object" || !payload || typeof payload !== "object") {
    return { ok: false, reason: "malformed token" };
  }
  // Only RS256: never let the token pick a weaker algorithm (e.g. "none" or HS256).
  if (header.alg !== "RS256") return { ok: false, reason: "unexpected algorithm" };

  const candidates = header.kid ? opts.keys.filter((k) => k.kid === header.kid) : opts.keys;
  if (candidates.length === 0) return { ok: false, reason: "unknown signing key" };
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let verified = false;
  for (const k of candidates) {
    if (k.kty !== "RSA" || !k.n || !k.e) continue;
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data)) {
        verified = true;
        break;
      }
    } catch {
      // Unusable key: try the next one.
    }
  }
  if (!verified) return { ok: false, reason: "bad signature" };

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const skew = 60;
  if (payload.iss !== `https://${opts.teamDomain}`) return { ok: false, reason: "wrong issuer" };
  const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!auds.includes(opts.aud)) return { ok: false, reason: "token is for another Access application" };
  if (typeof payload.exp !== "number" || payload.exp < now - skew) return { ok: false, reason: "token expired" };
  if (typeof payload.nbf === "number" && payload.nbf > now + skew) return { ok: false, reason: "token not yet valid" };
  return { ok: true, email: payload.email };
}

export async function checkAccess(
  headers: Headers,
  env: { CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string },
): Promise<AccessResult> {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN ? normaliseTeamDomain(env.CF_ACCESS_TEAM_DOMAIN) : "";
  const aud = env.CF_ACCESS_AUD?.trim() ?? "";
  if (!teamDomain || !aud) return { ok: false, reason: "Access check not configured (CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD)" };
  const token = headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, reason: "request did not come through Cloudflare Access" };
  try {
    const result = await verifyAccessJwt(token, { teamDomain, aud, keys: await fetchKeys(teamDomain) });
    // Cloudflare rotated its keys since we cached them: refetch once (rate-limited) and retry.
    if (!result.ok && result.reason === "unknown signing key" && Date.now() - lastForcedRefresh > CERTS_FORCED_REFRESH_MS) {
      lastForcedRefresh = Date.now();
      return verifyAccessJwt(token, { teamDomain, aud, keys: await fetchKeys(teamDomain, true) });
    }
    return result;
  } catch {
    return { ok: false, reason: "could not verify the Access token" };
  }
}
