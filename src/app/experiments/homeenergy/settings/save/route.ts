import { getCloudflareContext } from "@opennextjs/cloudflare";
import { TARIFF_KV_KEY, normalizeTariff, type Tariff } from "@/lib/energy";

export const dynamic = "force-dynamic";

/**
 * Saves tariff settings from the settings form.
 *
 * Lives under /experiments/homeenergy/ deliberately. The form used to POST to
 * /api/energy/tariff, which requires a Bearer INGEST_SECRET the browser cannot
 * have — so saving returned 401 every time and the feature never worked at all.
 *
 * The obvious fix, handing the secret to the browser, would put a
 * collector credential in client-side JavaScript. Instead this sits inside the
 * path the Cloudflare Access gate already protects, so only a signed-in user
 * reaches it. Verified: /experiments/homeenergy/settings/save returns 302 to
 * the Access login when unauthenticated — checked against the deployed site,
 * not assumed from the path.
 *
 * /api/energy/tariff keeps its Bearer check and stays available to the
 * collector; it just isn't what the browser talks to any more.
 */
export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.ENERGY_KV) {
    return Response.json({ ok: false, error: "no KV binding" }, { status: 500 });
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
