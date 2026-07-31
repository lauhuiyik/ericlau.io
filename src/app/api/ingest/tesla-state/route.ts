import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

const MELB = "Australia/Melbourne";

/** Live vehicle/charging state sampled by the collector from the Fleet API. */
type Payload = {
  charging_state?: string;
  charge_power_kw?: number;
  charge_rate_kw?: number;
  battery_level?: number;
  charge_energy_added_kwh?: number;
  charge_limit_soc?: number;
  at_home?: boolean;
};

function melbParts(d: Date): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: MELB,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
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

  await env.DB.prepare(
    `INSERT OR REPLACE INTO tesla_state
      (ts, local_date, local_time, charging_state, charge_power_kw, charge_rate_kw,
       battery_level, charge_energy_added_kwh, charge_limit_soc, at_home, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      ts, local_date, local_time,
      typeof body.charging_state === "string" ? body.charging_state : null,
      num(body.charge_power_kw), num(body.charge_rate_kw), num(body.battery_level),
      num(body.charge_energy_added_kwh), num(body.charge_limit_soc),
      body.at_home === true ? 1 : body.at_home === false ? 0 : null,
      "fleet",
    )
    .run();

  return Response.json({ ok: true, ts, charging_state: body.charging_state ?? null });
}
