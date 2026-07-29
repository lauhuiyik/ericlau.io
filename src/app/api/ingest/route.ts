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
  const solarOld = num(body.solar_old_kw);
  const solarTotal = (solarNew ?? 0) + (solarOld ?? 0);
  const battChg = num(body.battery_charge_kw);
  const battDis = num(body.battery_discharge_kw);
  const gridImp = num(body.grid_import_kw);
  const gridExp = num(body.grid_export_kw);

  // Whole-home load = everything coming in − everything going out.
  const houseKw =
    (solarNew ?? 0) + (solarOld ?? 0) + (battDis ?? 0) + (gridImp ?? 0) -
    (battChg ?? 0) - (gridExp ?? 0);

  const snKwh = num(body.solar_new_kwh_today);
  const soKwh = num(body.solar_old_kwh_today);
  const giKwh = num(body.grid_import_kwh_today);
  const geKwh = num(body.grid_export_kwh_today);
  const bcKwh = num(body.battery_charge_kwh_today);
  const bdKwh = num(body.battery_discharge_kwh_today);
  const houseKwhToday =
    (snKwh ?? 0) + (soKwh ?? 0) + (bdKwh ?? 0) + (giKwh ?? 0) -
    (bcKwh ?? 0) - (geKwh ?? 0);

  const sources = typeof body.sources === "string" ? body.sources : null;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO readings
      (ts, local_date, local_time, solar_new_kw, solar_old_kw, solar_total_kw,
       battery_soc, battery_charge_kw, battery_discharge_kw, grid_import_kw, grid_export_kw, house_kw,
       solar_new_kwh_today, solar_old_kwh_today, grid_import_kwh_today, grid_export_kwh_today,
       battery_charge_kwh_today, battery_discharge_kwh_today, house_kwh_today, sources)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      ts, local_date, local_time, solarNew, solarOld, solarTotal,
      num(body.battery_soc), battChg, battDis, gridImp, gridExp, houseKw,
      snKwh, soKwh, giKwh, geKwh, bcKwh, bdKwh, houseKwhToday, sources,
    )
    .run();

  const snapshot = {
    ts, local_date, local_time,
    solar_new_kw: solarNew, solar_old_kw: solarOld, solar_total_kw: solarTotal,
    battery_soc: num(body.battery_soc), battery_charge_kw: battChg, battery_discharge_kw: battDis,
    grid_import_kw: gridImp, grid_export_kw: gridExp, house_kw: houseKw,
    solar_new_kwh_today: snKwh, solar_old_kwh_today: soKwh,
    grid_import_kwh_today: giKwh, grid_export_kwh_today: geKwh,
    battery_charge_kwh_today: bcKwh, battery_discharge_kwh_today: bdKwh,
    house_kwh_today: houseKwhToday, sources,
  };
  await env.ENERGY_KV.put("latest", JSON.stringify(snapshot));

  return Response.json({ ok: true, ts, house_kw: houseKw, solar_total_kw: solarTotal });
}
