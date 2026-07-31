/**
 * Tesla Fleet API constants and token helpers.
 *
 * Auth model: Eric authorises once in a browser (authorization_code + the
 * `offline_access` scope), which yields a refresh token. Everything after that
 * is machine-to-machine — the collector swaps the refresh token for a
 * short-lived access token on each run.
 *
 * Refresh tokens ROTATE: each refresh returns a new one and invalidates the
 * old. So the new value has to be written back to KV every time, or the next
 * run is locked out and Eric has to re-authorise by hand.
 */

export const TESLA_AUTH_ORIGIN = "https://fleet-auth.prd.vn.cloud.tesla.com";
export const TESLA_TOKEN_URL = `${TESLA_AUTH_ORIGIN}/oauth2/v3/token`;
export const TESLA_AUTHORIZE_URL = `${TESLA_AUTH_ORIGIN}/oauth2/v3/authorize`;

/** Australia sits in Tesla's NA/APAC region. The collector confirms the real
 * base URL for the account via /api/1/users/region and stores it, so this is
 * only the starting point. */
export const TESLA_DEFAULT_BASE = "https://fleet-api.prd.na.vn.cloud.tesla.com";

export const TESLA_REDIRECT_URI = "https://ericlau.io/api/tesla/callback";

/** offline_access is what makes Tesla return a refresh token at all — without
 * it the grant is single-use and unattended polling is impossible. */
export const TESLA_SCOPES = "openid offline_access vehicle_device_data vehicle_location";

export const TESLA_KV_KEY = "tesla_tokens";
export const TESLA_STATE_KV_PREFIX = "tesla_oauth_state:";

export type TeslaTokens = {
  refresh_token: string;
  /** Base URL for this account's region, from /api/1/users/region. */
  base_url?: string;
  /** When the refresh token was last rotated (unix seconds), for debugging. */
  updated_ts?: number;
};

export async function getTeslaTokens(kv: KVNamespace): Promise<TeslaTokens | null> {
  const raw = await kv.get(TESLA_KV_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TeslaTokens;
  } catch {
    return null;
  }
}

export async function putTeslaTokens(kv: KVNamespace, tokens: TeslaTokens): Promise<void> {
  await kv.put(TESLA_KV_KEY, JSON.stringify({ ...tokens, updated_ts: Math.floor(Date.now() / 1000) }));
}
