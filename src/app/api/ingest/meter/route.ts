import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

// Powercor smart-meter import from the myEnergy CSV exports. `intervals` come
// from the 'interval' export (30-min consumption/generation), `periods` from the
// 'basic' export (billed Peak/Off Peak/Solar totals). Both upsert by primary key
// so re-running an import — including overlapping date ranges — is idempotent.
type Interval = {
  local_date: string;
  interval_start: string;
  stream: "import" | "export";
  kwh: number;
  quality: string | null;
};
type Period = {
  from_date: string;
  to_date: string;
  peak_kwh: number | null;
  offpeak_kwh: number | null;
  solar_kwh: number | null;
};

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });

  const secret = env.INGEST_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { intervals?: Interval[]; periods?: Period[] };
  try {
    body = (await request.json()) as { intervals?: Interval[]; periods?: Period[] };
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const intervals = body.intervals ?? [];
  const periods = body.periods ?? [];
  if (intervals.length === 0 && periods.length === 0) {
    return Response.json({ ok: false, error: "no intervals or periods provided" }, { status: 400 });
  }

  const batch = [];

  if (intervals.length > 0) {
    const stmt = env.DB.prepare(
      `INSERT OR REPLACE INTO meter_intervals
        (local_date, interval_start, stream, kwh, quality)
       VALUES (?,?,?,?,?)`,
    );
    for (const i of intervals) {
      batch.push(stmt.bind(i.local_date, i.interval_start, i.stream, i.kwh, i.quality));
    }
  }

  if (periods.length > 0) {
    const stmt = env.DB.prepare(
      `INSERT OR REPLACE INTO meter_billing_periods
        (from_date, to_date, peak_kwh, offpeak_kwh, solar_kwh)
       VALUES (?,?,?,?,?)`,
    );
    for (const p of periods) {
      batch.push(stmt.bind(p.from_date, p.to_date, p.peak_kwh, p.offpeak_kwh, p.solar_kwh));
    }
  }

  await env.DB.batch(batch);

  return Response.json({ ok: true, intervals: intervals.length, periods: periods.length });
}
