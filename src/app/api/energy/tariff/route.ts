import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getTariff, normalizeTariff, TARIFF_KV_KEY, type Tariff } from "@/lib/energy";

export const dynamic = "force-dynamic";

/**
 * The GET is harmless (tariff rates aren't secret). The POST is NOT: anyone who
 * can call it can silently corrupt every cost figure on the dashboard.
 *
 * This previously relied on a comment asserting "Cloudflare Access protects
 * this path" — but Access was never actually switched on, so the write was wide
 * open to the internet. It now FAILS CLOSED behind the shared secret.
 *
 * Once Access is enabled on /experiments/* and /api/energy/*, the browser
 * settings form will carry Access credentials and can be allowed through again;
 * until then editing tariffs is done via an authenticated request rather than
 * the form.
 */

export async function GET() {
  const { env } = await getCloudflareContext({ async: true });
  const tariff = await getTariff(env.ENERGY_KV);
  return Response.json(tariff);
}

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const secret = env.INGEST_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: Partial<Tariff>;
  try {
    body = (await request.json()) as Partial<Tariff>;
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const tariff = normalizeTariff(body);
  await env.ENERGY_KV.put(TARIFF_KV_KEY, JSON.stringify(tariff));
  return Response.json({ ok: true, tariff });
}
