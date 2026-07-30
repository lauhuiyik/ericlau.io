import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

const KV_KEY = "anker_auth_cache";

/**
 * Persists the anker-solix-api library's own login-token cache file (a small
 * JSON blob) between collector runs. GitHub Actions runners start from a
 * blank filesystem every run, so without this the collector was doing a
 * fresh username/password login on every 5-minute poll — Anker rate-limits/
 * CAPTCHAs an account after ~10 logins/day, which is what happened. Restoring
 * this blob before authenticating lets the library reuse its cached token
 * (~7 day validity) and only truly log in when that expires.
 *
 * Bearer-secret authed (not the Cloudflare Access browser gate) because the
 * collector calls this from GitHub Actions, with no browser session.
 */

function authed(request: Request, secret: string | undefined): boolean {
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  if (!authed(request, env.INGEST_SECRET)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const blob = await env.ENERGY_KV.get(KV_KEY);
  return Response.json({ blob });
}

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  if (!authed(request, env.INGEST_SECRET)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: { blob?: string };
  try {
    body = (await request.json()) as { blob?: string };
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (typeof body.blob !== "string" || body.blob.length === 0) {
    return Response.json({ ok: false, error: "missing blob" }, { status: 400 });
  }
  await env.ENERGY_KV.put(KV_KEY, body.blob);
  return Response.json({ ok: true });
}
