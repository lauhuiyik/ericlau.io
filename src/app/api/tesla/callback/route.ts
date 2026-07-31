import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  TESLA_DEFAULT_BASE,
  TESLA_REDIRECT_URI,
  TESLA_STATE_KV_PREFIX,
  TESLA_TOKEN_URL,
  putTeslaTokens,
} from "@/lib/tesla";

export const dynamic = "force-dynamic";

/**
 * Tesla redirects here after Eric approves access. Exchanges the one-time code
 * for tokens, resolves which regional API host his account belongs to, and
 * stores the refresh token in KV for the collector to use from then on.
 *
 * The authorisation code is single-use and only redeemable with our client
 * secret, and `state` is verified against KV, so this endpoint being publicly
 * reachable (Tesla has to be able to reach it) isn't a way in.
 */
export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const teslaError = url.searchParams.get("error");

  if (teslaError) {
    return html(`Tesla returned an error: ${escapeHtml(teslaError)}`, false);
  }
  if (!code || !state) {
    return html("Missing code or state in the callback URL.", false);
  }

  const stateKey = `${TESLA_STATE_KV_PREFIX}${state}`;
  if (!(await env.ENERGY_KV.get(stateKey))) {
    return html("That authorisation link has expired or was already used. Start again from /api/tesla/connect.", false);
  }
  await env.ENERGY_KV.delete(stateKey);

  const clientId = env.TESLA_CLIENT_ID;
  const clientSecret = env.TESLA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return html("Tesla client credentials are not configured on the server.", false);
  }

  // code -> tokens
  const tokenRes = await fetch(TESLA_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: TESLA_REDIRECT_URI,
    }),
  });
  const tokenBody = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokenBody.refresh_token) {
    return html(
      `Token exchange failed (${tokenRes.status}): ${escapeHtml(
        tokenBody.error_description ?? tokenBody.error ?? "no refresh_token returned",
      )}`,
      false,
    );
  }

  // Which regional host serves this account? Falls back to the default if the
  // lookup fails — the collector retries it later either way.
  let baseUrl = TESLA_DEFAULT_BASE;
  try {
    const regionRes = await fetch(`${TESLA_DEFAULT_BASE}/api/1/users/region`, {
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (regionRes.ok) {
      const region = (await regionRes.json()) as { response?: { fleet_api_base_url?: string } };
      if (region.response?.fleet_api_base_url) baseUrl = region.response.fleet_api_base_url;
    }
  } catch {
    // keep the default
  }

  await putTeslaTokens(env.ENERGY_KV, { refresh_token: tokenBody.refresh_token, base_url: baseUrl });

  return html(
    `Tesla connected. Region: ${escapeHtml(baseUrl)}. The collector will start recording charge data on its next run — you can close this tab.`,
    true,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function html(message: string, ok: boolean): Response {
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
     <body style="background:#0a0a0a;color:#f5f5f4;font:16px/1.6 ui-sans-serif,system-ui,sans-serif;padding:3rem 1.5rem;max-width:34rem;margin:0 auto">
     <h1 style="font-size:1.25rem;margin:0 0 1rem">${ok ? "Tesla connected" : "Couldn’t connect Tesla"}</h1>
     <p style="color:#a3a3a3;margin:0 0 1.5rem">${message}</p>
     <a href="/experiments/homeenergy" style="color:${ok ? "#4ade80" : "#f87171"}">← Back to Home Energy</a>
     </body>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
