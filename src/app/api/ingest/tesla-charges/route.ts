import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

type Charge = {
  id: string;
  started_ts: number;
  ended_ts: number | null;
  local_date: string;
  energy_added_kwh: number | null;
  location: string | null;
  at_home: 0 | 1;
  odometer_km: number | null;
  cost_aud: number | null;
  source: string;
};

// One-time/occasional batch import (e.g. a Tessie CSV export). Upserts by id
// so re-running an import is safe and idempotent.
export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });

  const secret = env.INGEST_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { charges?: Charge[] };
  try {
    body = (await request.json()) as { charges?: Charge[] };
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const charges = body.charges ?? [];
  if (!Array.isArray(charges) || charges.length === 0) {
    return Response.json({ ok: false, error: "no charges provided" }, { status: 400 });
  }

  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO tesla_charges
      (id, started_ts, ended_ts, local_date, energy_added_kwh, location, at_home, odometer_km, cost_aud, source)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );

  const batch = charges.map((c) =>
    stmt.bind(
      c.id,
      c.started_ts,
      c.ended_ts,
      c.local_date,
      c.energy_added_kwh,
      c.location,
      c.at_home,
      c.odometer_km,
      c.cost_aud,
      c.source,
    ),
  );

  await env.DB.batch(batch);

  return Response.json({ ok: true, imported: charges.length });
}
