import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  TESLA_AUTHORIZE_URL,
  TESLA_REDIRECT_URI,
  TESLA_SCOPES,
  TESLA_STATE_KV_PREFIX,
} from "@/lib/tesla";

export const dynamic = "force-dynamic";

/**
 * Starts the one-time Tesla authorisation. Open this in a browser, sign in to
 * Tesla, approve the requested scopes, and Tesla redirects to
 * /api/tesla/callback with a code we exchange for a refresh token.
 *
 * A random `state` is stored in KV first and checked on the way back, so a
 * callback can't be forged or replayed from elsewhere.
 */
export async function GET() {
  const { env } = await getCloudflareContext({ async: true });
  const clientId = env.TESLA_CLIENT_ID;
  if (!clientId) {
    return Response.json({ ok: false, error: "TESLA_CLIENT_ID not configured" }, { status: 500 });
  }

  const state = crypto.randomUUID();
  // Short TTL: this only needs to survive the sign-in round trip.
  await env.ENERGY_KV.put(`${TESLA_STATE_KV_PREFIX}${state}`, "1", { expirationTtl: 900 });

  const url = new URL(TESLA_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", TESLA_REDIRECT_URI);
  url.searchParams.set("scope", TESLA_SCOPES);
  url.searchParams.set("state", state);

  return Response.redirect(url.toString(), 302);
}
