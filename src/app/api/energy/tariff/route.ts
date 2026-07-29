import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getTariff, normalizeTariff, TARIFF_KV_KEY, type Tariff } from "@/lib/energy";

export const dynamic = "force-dynamic";

// NOTE: in production this path is protected by the Cloudflare Access email gate
// (configured on /experiments/homeenergy and /api/energy/*), so only Eric can write.

export async function GET() {
  const { env } = await getCloudflareContext({ async: true });
  const tariff = await getTariff(env.ENERGY_KV);
  return Response.json(tariff);
}

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
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
