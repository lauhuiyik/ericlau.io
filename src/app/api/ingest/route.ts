import { getCloudflareContext } from "@opennextjs/cloudflare";

// Always run at request time (touches D1/KV bindings; never prerender).
export const dynamic = "force-dynamic";

const MELB = "Australia/Melbourne";

// Measurements sent by the Python collector. All optional — a source may be down.
type Payload = {
  solar_new_kw?: number;
  solar_old_kw?: number;
  battery_soc?: number;
  battery_charge_kw?: number;
  battery_discharge_kw?: number;
  grid_import_kw?: number;
  grid_export_kw?: number;
  solar_new_kwh_today?: number;
  solar_old_kwh_today?: number;
  grid_import_kwh_today?: number;
  grid_export_kwh_today?: number;
  battery_charge_kwh_today?: number;
  battery_discharge_kwh_today?: number;
  // Anker's own flow accounting (where power actually went).
  solar_to_home_kwh_today?: number;
  solar_to_battery_kwh_today?: number;
  battery_to_home_kwh_today?: number;
  grid_to_home_kwh_today?: number;
  home_usage_kwh_today?: number;
  sources?: string;
};

function melbParts(d: Date): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: MELB,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });

  const secret = env.INGEST_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const now = new Date();
  const ts = Math.floor(now.getTime() / 1000);
  const { date: local_date, time: local_time } = melbParts(now);

  const solarNew = num(body.solar_new_kw);

  // Growatt is fetched by the companion Worker, not the collector: Growatt
  // refuses datacenter IPs, so the collector (GitHub Actions) gets
  // 10011 error_permission_denied while Cloudflare's egress is accepted. The
  // Worker stashes a snapshot in KV on its 5-minute cron and we merge it here.
  // Ignored if older than 15 min so a stalled Worker can't keep injecting a
  // stale figure into fresh readings.
  let solarOld = num(body.solar_old_kw);
  let solarOldKwhToday = num(body.solar_old_kwh_today);
  let growattMerged = false;
  if (solarOld == null) {
    try {
      const raw = await env.ENERGY_KV.get("growatt_latest");
      if (raw) {
        const g = JSON.parse(raw) as {
          solar_old_kw?: number | null;
          solar_old_kwh_today?: number | null;
          fetched_ts?: number;
        };
        // Tolerate a little negative skew: the snapshot's fetched_ts and this
        // request's ts are stamped by different Worker invocations, whose
        // Date.now() can disagree by a second or two.
        const ageSec = ts - (g.fetched_ts ?? 0);
        if (g.fetched_ts && ageSec > -120 && ageSec < 15 * 60) {
          solarOld = num(g.solar_old_kw);
          solarOldKwhToday = num(g.solar_old_kwh_today);
          growattMerged = solarOld != null;
        }
      }
    } catch {
      // treat as simply unavailable
    }
  }

  // Carry the last known value forward if that KV read came back empty.
  //
  // house_kw and house_kwh_today are DERIVED from solar + battery + grid, so a
  // single missed merge doesn't just lose array #1 — it drops the whole-house
  // figure by array #1's entire output. Observed live: consecutive readings
  // alternating between 44.75 and 35.25 kWh, and the day view reads the last
  // row, so which number you saw was luck. A one-off KV miss must not do that.
  //
  // Same 15-minute window as above, so a genuinely stalled poller still stops
  // contributing rather than being propagated indefinitely.
  if (solarOld == null) {
    try {
      const prev = await env.DB.prepare(
        `SELECT solar_old_kw, solar_old_kwh_today, ts FROM readings
          WHERE local_date = ? AND solar_old_kw IS NOT NULL
          ORDER BY ts DESC LIMIT 1`,
      )
        .bind(local_date)
        .first<{ solar_old_kw: number | null; solar_old_kwh_today: number | null; ts: number }>();
      if (prev && ts - prev.ts < 15 * 60) {
        solarOld = prev.solar_old_kw;
        solarOldKwhToday = prev.solar_old_kwh_today;
        growattMerged = solarOld != null;
      }
    } catch {
      // treat as simply unavailable
    }
  }
  const solarTotal = (solarNew ?? 0) + (solarOld ?? 0);
  const battChg = num(body.battery_charge_kw);
  const battDis = num(body.battery_discharge_kw);
  const gridImp = num(body.grid_import_kw);
  const gridExp = num(body.grid_export_kw);

  // Whole-home load = everything coming in − everything going out.
  //
  // Null when we have no components at all, rather than 0. A failed Anker fetch
  // posts a reading with everything null, and summing those with ?? 0 stored a
  // literal 0 that is indistinguishable from "the house used nothing". Those
  // zeros then won every "last known value" lookup, which is how 2026-07-29
  // came to report 0.0 kWh consumed for the whole day.
  const anyKw = [solarNew, solarOld, battDis, battChg, gridImp, gridExp].some((v) => v != null);
  const houseKw = anyKw
    ? (solarNew ?? 0) + (solarOld ?? 0) + (battDis ?? 0) + (gridImp ?? 0) -
      (battChg ?? 0) - (gridExp ?? 0)
    : null;

  const snKwh = num(body.solar_new_kwh_today);
  const soKwh = solarOldKwhToday;
  const giKwh = num(body.grid_import_kwh_today);
  const geKwh = num(body.grid_export_kwh_today);
  const bcKwh = num(body.battery_charge_kwh_today);
  const bdKwh = num(body.battery_discharge_kwh_today);
  const anyKwh = [snKwh, soKwh, bdKwh, giKwh, bcKwh, geKwh].some((v) => v != null);
  const houseKwhToday = anyKwh
    ? (snKwh ?? 0) + (soKwh ?? 0) + (bdKwh ?? 0) + (giKwh ?? 0) -
      (bcKwh ?? 0) - (geKwh ?? 0)
    : null;

  const s2h = num(body.solar_to_home_kwh_today);
  const s2b = num(body.solar_to_battery_kwh_today);
  const b2h = num(body.battery_to_home_kwh_today);
  const g2h = num(body.grid_to_home_kwh_today);
  const ankerHome = num(body.home_usage_kwh_today);

  let sources = typeof body.sources === "string" ? body.sources : null;
  if (growattMerged) {
    const parts = (sources ?? "").split(",").filter(Boolean);
    if (!parts.includes("growatt")) parts.push("growatt");
    sources = parts.join(",");
  }

  await env.DB.prepare(
    `INSERT OR REPLACE INTO readings
      (ts, local_date, local_time, solar_new_kw, solar_old_kw, solar_total_kw,
       battery_soc, battery_charge_kw, battery_discharge_kw, grid_import_kw, grid_export_kw, house_kw,
       solar_new_kwh_today, solar_old_kwh_today, grid_import_kwh_today, grid_export_kwh_today,
       battery_charge_kwh_today, battery_discharge_kwh_today, house_kwh_today,
       solar_to_home_kwh_today, solar_to_battery_kwh_today, battery_to_home_kwh_today,
       grid_to_home_kwh_today, home_usage_kwh_today, sources)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      ts, local_date, local_time, solarNew, solarOld, solarTotal,
      num(body.battery_soc), battChg, battDis, gridImp, gridExp, houseKw,
      snKwh, soKwh, giKwh, geKwh, bcKwh, bdKwh, houseKwhToday,
      s2h, s2b, b2h, g2h, ankerHome, sources,
    )
    .run();
  // NOTE: deliberately no KV write here. This used to mirror the snapshot into
  // a "latest" key, once per reading — about 1,160 writes a day, which on its
  // own exceeded Cloudflare's 1,000/day free KV write allowance. Once the
  // allowance ran out every other KV write failed too, which is how the Growatt
  // snapshot silently stopped updating. The row is already in D1, so
  // /api/energy/latest reads it from there instead; D1 allows 5M reads a day.
  return Response.json({ ok: true, ts, house_kw: houseKw, solar_total_kw: solarTotal });
}
