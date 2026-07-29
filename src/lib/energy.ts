// Home energy dashboard — shared types, tariffs, and D1/KV queries.

export type Reading = {
  ts: number;
  local_date: string;
  local_time: string;
  solar_new_kw: number | null;
  solar_old_kw: number | null;
  solar_total_kw: number | null;
  battery_soc: number | null;
  battery_charge_kw: number | null;
  battery_discharge_kw: number | null;
  grid_import_kw: number | null;
  grid_export_kw: number | null;
  house_kw: number | null;
  solar_new_kwh_today: number | null;
  solar_old_kwh_today: number | null;
  grid_import_kwh_today: number | null;
  grid_export_kwh_today: number | null;
  battery_charge_kwh_today: number | null;
  battery_discharge_kwh_today: number | null;
  house_kwh_today: number | null;
  sources: string | null;
};

export type Tariff = {
  peakRate: number; // $/kWh during the peak window
  offPeakRate: number; // $/kWh all other times
  supplyPerDay: number; // $/day fixed supply charge
  feedIn: number; // $/kWh exported
  peakStartHour: number; // 0–24, local
  peakEndHour: number; // 0–24, local
};

// Seeded from Eric's Lumo "Time of Use v2 FIT Solar" bill (fixed until 30 Sep 2026).
export const DEFAULT_TARIFF: Tariff = {
  peakRate: 0.308,
  offPeakRate: 0.18678,
  supplyPerDay: 1.00034,
  feedIn: 0.033,
  peakStartHour: 15,
  peakEndHour: 21,
};

export const TARIFF_KV_KEY = "tariff";

export function normalizeTariff(input: Partial<Tariff> | null | undefined): Tariff {
  const t = { ...DEFAULT_TARIFF, ...(input ?? {}) };
  const clampNum = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
  const clampHour = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(24, Math.max(0, Math.round(v))) : fallback;
  return {
    peakRate: clampNum(t.peakRate, DEFAULT_TARIFF.peakRate),
    offPeakRate: clampNum(t.offPeakRate, DEFAULT_TARIFF.offPeakRate),
    supplyPerDay: clampNum(t.supplyPerDay, DEFAULT_TARIFF.supplyPerDay),
    feedIn: clampNum(t.feedIn, DEFAULT_TARIFF.feedIn),
    peakStartHour: clampHour(t.peakStartHour, DEFAULT_TARIFF.peakStartHour),
    peakEndHour: clampHour(t.peakEndHour, DEFAULT_TARIFF.peakEndHour),
  };
}

export async function getTariff(kv: KVNamespace): Promise<Tariff> {
  try {
    const raw = await kv.get(TARIFF_KV_KEY);
    if (raw) return normalizeTariff(JSON.parse(raw) as Partial<Tariff>);
  } catch {
    // fall through to defaults
  }
  return DEFAULT_TARIFF;
}

const MELB = "Australia/Melbourne";

/** Current date/time parts in Australia/Melbourne. */
export function melbNow(now: Date = new Date()): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: MELB,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function isPeak(localTime: string, t: Tariff): boolean {
  const h = Number(localTime.slice(0, 2));
  // Handle windows that wrap past midnight (e.g. 22–6) as well as normal ones.
  if (t.peakStartHour <= t.peakEndHour) return h >= t.peakStartHour && h < t.peakEndHour;
  return h >= t.peakStartHour || h < t.peakEndHour;
}

export async function getLatest(db: D1Database): Promise<Reading | null> {
  return (
    (await db.prepare("SELECT * FROM readings ORDER BY ts DESC LIMIT 1").first<Reading>()) ??
    null
  );
}

export type ChargeSummary = {
  totalSessions: number;
  homeSessions: number;
  totalKwh: number;
  homeKwh: number;
  totalCost: number;
  first: string | null;
  last: string | null;
  byMonth: { month: string; homeKwh: number; awayKwh: number }[];
};

export async function getChargeSummary(db: D1Database): Promise<ChargeSummary> {
  const overall = await db
    .prepare(
      `SELECT COUNT(*) n, SUM(at_home) home_n,
              ROUND(SUM(energy_added_kwh),1) total_kwh,
              ROUND(SUM(CASE WHEN at_home=1 THEN energy_added_kwh ELSE 0 END),1) home_kwh,
              ROUND(SUM(cost_aud),2) total_cost,
              MIN(local_date) first, MAX(local_date) last
       FROM tesla_charges`,
    )
    .first<{
      n: number;
      home_n: number | null;
      total_kwh: number | null;
      home_kwh: number | null;
      total_cost: number | null;
      first: string | null;
      last: string | null;
    }>();

  const months = await db
    .prepare(
      `SELECT substr(local_date,1,7) month,
              ROUND(SUM(CASE WHEN at_home=1 THEN energy_added_kwh ELSE 0 END),1) home_kwh,
              ROUND(SUM(CASE WHEN at_home=0 THEN energy_added_kwh ELSE 0 END),1) away_kwh
       FROM tesla_charges
       GROUP BY month
       ORDER BY month ASC`,
    )
    .all<{ month: string; home_kwh: number | null; away_kwh: number | null }>();

  return {
    totalSessions: overall?.n ?? 0,
    homeSessions: overall?.home_n ?? 0,
    totalKwh: overall?.total_kwh ?? 0,
    homeKwh: overall?.home_kwh ?? 0,
    totalCost: overall?.total_cost ?? 0,
    first: overall?.first ?? null,
    last: overall?.last ?? null,
    byMonth: (months.results ?? []).map((m) => ({
      month: m.month,
      homeKwh: m.home_kwh ?? 0,
      awayKwh: m.away_kwh ?? 0,
    })),
  };
}

export async function getTodaySeries(db: D1Database, date: string): Promise<Reading[]> {
  const res = await db
    .prepare("SELECT * FROM readings WHERE local_date = ? ORDER BY ts ASC")
    .bind(date)
    .all<Reading>();
  return res.results ?? [];
}

/**
 * Cost accrued today from the tracked readings. Grid import is priced by
 * time-of-use using the delta between consecutive running totals; export is
 * credited at the feed-in rate; the fixed daily supply charge is added. Also
 * returns peak/off-peak grid kWh split. Accurate once the collector runs
 * continuously; before that it only covers the polled period.
 */
export function costToday(series: Reading[], latest: Reading | null, t: Tariff) {
  let importCost = 0;
  let peakKwh = 0;
  let offPeakKwh = 0;
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].grid_import_kwh_today ?? 0;
    const cur = series[i].grid_import_kwh_today ?? 0;
    const delta = Math.max(0, cur - prev);
    if (isPeak(series[i].local_time, t)) {
      peakKwh += delta;
      importCost += delta * t.peakRate;
    } else {
      offPeakKwh += delta;
      importCost += delta * t.offPeakRate;
    }
  }
  const exportKwh = latest?.grid_export_kwh_today ?? 0;
  const exportCredit = exportKwh * t.feedIn;
  const supply = t.supplyPerDay;
  return {
    importCost,
    exportCredit,
    supply,
    net: importCost + supply - exportCredit,
    peakKwh,
    offPeakKwh,
  };
}
