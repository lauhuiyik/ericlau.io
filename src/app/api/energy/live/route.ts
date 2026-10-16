import { getCloudflareContext } from "@opennextjs/cloudflare";
import { checkAccess } from "@/lib/cf-access";
import { ENERGY_LIVE_MS, getEnergyLiveUntil, setEnergyLiveUntil } from "@/lib/doorbell";

export const dynamic = "force-dynamic";

/**
 * Energy Live mode.
 *
 *   GET               → { liveUntil }   (ms; 0 = off)
 *   POST { on: bool } → { liveUntil }
 *
 * Off, the cron Worker (cron-pinger/) collects once an hour, plus once just
 * before midnight for the day's closing counters, and the home Growatt poller
 * reports to match. On, both go back to every 5 minutes (1-minute samples)
 * for ENERGY_LIVE_MS, then it switches itself off. The flag lives in the
 * public doorbell file status/energy.json (src/lib/doorbell.ts) so the home
 * PC can read it without touching this Worker.
 *
 * /api/energy/* is behind Cloudflare Access; the POST also verifies the
 * Access token itself and refuses cross-site requests.
 */
const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

export async function GET() {
  const { env } = await getCloudflareContext({ async: true });
  return new Response(JSON.stringify({ liveUntil: await getEnergyLiveUntil(env.MEDIA_BUCKET) }), {
    headers: JSON_HEADERS,
  });
}

export async function POST(request: Request) {
  const { env, ctx } = await getCloudflareContext({ async: true });
  const fail = (error: string, status: number) =>
    new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });

  if (process.env.NODE_ENV !== "development") {
    const gate = await checkAccess(request.headers, env);
    if (!gate.ok) return fail(gate.reason, 401);
  }
  if (request.headers.get("x-energy") !== "1") return fail("missing x-energy header", 403);
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return fail("cross-site request", 403);

  let body: { on?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("expected JSON", 400);
  }
  const liveUntil = body.on === true ? Date.now() + ENERGY_LIVE_MS : 0;
  await setEnergyLiveUntil(env.MEDIA_BUCKET, liveUntil);

  // Start a reading now rather than at the cron's next 5-minute tick.
  if (liveUntil) {
    ctx.waitUntil(
      env.ENERGY_PINGER.fetch("https://cron-pinger/", { method: "POST" })
        .then((r) => console.log("live mode: pinger", r.status))
        .catch((e) => console.error("live mode: pinger", e)),
    );
  }
  return new Response(JSON.stringify({ liveUntil }), { headers: JSON_HEADERS });
}
