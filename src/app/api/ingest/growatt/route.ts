import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

/**
 * Growatt snapshot posted from a machine on Eric's home network.
 *
 * Why this exists: Growatt's open API answers `10011 error_permission_denied`
 * for requests from datacenter IPs. Verified same-token, same-plant, same
 * minute — the home connection returns error_code 0 while both the Cloudflare
 * Worker and GitHub Actions are refused. Retrying doesn't help (three attempts
 * in one cycle, all 10011), so the call has to originate from the house.
 *
 * Writes the same `growatt_latest` KV key the companion Worker used to write,
 * so /api/ingest merges it exactly as before and nothing downstream changes.
 * The Worker's own attempt is harmless and still runs as an opportunistic
 * fallback; whichever succeeds last wins, and they agree when both do.
 */

const KV_KEY = "growatt_latest";

type Payload = {
  solar_old_kw?: number | null;
  solar_old_kwh_today?: number | null;
  last_update_time?: string | null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const secret = env.INGEST_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!env.ENERGY_KV) {
    return Response.json({ ok: false, error: "no KV binding" }, { status: 500 });
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const solar_old_kw = num(body.solar_old_kw);
  const solar_old_kwh_today = num(body.solar_old_kwh_today);
  // A snapshot with neither figure tells us nothing and would only serve to
  // reset the freshness clock, hiding a stalled poller behind recent-looking
  // data. Reject it rather than store it.
  if (solar_old_kw == null && solar_old_kwh_today == null) {
    return Response.json({ ok: false, error: "no usable values" }, { status: 400 });
  }

  const snapshot = {
    solar_old_kw,
    solar_old_kwh_today,
    last_update_time: body.last_update_time ?? null,
    // Stamped here, not by the client: /api/ingest ignores snapshots older than
    // 15 minutes, and that check must not depend on a remote machine's clock.
    fetched_ts: Math.floor(Date.now() / 1000),
  };

  await env.ENERGY_KV.put(KV_KEY, JSON.stringify(snapshot));
  return Response.json({ ok: true, stored: snapshot });
}
