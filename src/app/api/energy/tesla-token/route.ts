import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getTeslaTokens, putTeslaTokens, type TeslaTokens } from "@/lib/tesla";

export const dynamic = "force-dynamic";

/**
 * Lets the collector read the stored Tesla refresh token and write back the
 * rotated one. Tesla invalidates a refresh token as soon as it's used, so
 * persisting the replacement is mandatory — miss it once and the next run is
 * locked out until Eric re-authorises in a browser.
 *
 * Bearer-secret authed (not the Cloudflare Access browser gate), same as
 * /api/ingest, because the caller is GitHub Actions with no browser session.
 */
function authed(request: Request, secret: string | undefined): boolean {
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  if (!authed(request, env.INGEST_SECRET)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const tokens = await getTeslaTokens(env.ENERGY_KV);
  return Response.json({
    connected: tokens != null,
    refresh_token: tokens?.refresh_token ?? null,
    base_url: tokens?.base_url ?? null,
    client_id: env.TESLA_CLIENT_ID ?? null,
    client_secret: env.TESLA_CLIENT_SECRET ?? null,
  });
}

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  if (!authed(request, env.INGEST_SECRET)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: Partial<TeslaTokens>;
  try {
    body = (await request.json()) as Partial<TeslaTokens>;
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (typeof body.refresh_token !== "string" || body.refresh_token.length === 0) {
    return Response.json({ ok: false, error: "missing refresh_token" }, { status: 400 });
  }
  const existing = await getTeslaTokens(env.ENERGY_KV);
  await putTeslaTokens(env.ENERGY_KV, {
    refresh_token: body.refresh_token,
    base_url: body.base_url ?? existing?.base_url,
  });
  return Response.json({ ok: true });
}
