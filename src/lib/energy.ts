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

/** Which Australia/Melbourne local calendar date a unix-seconds timestamp falls on. */
export function melbDateFromTs(ts: number): string {
  return melbNow(new Date(ts * 1000)).date;
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

export type DateRange = "day" | "week" | "month";

/** Shift a 'YYYY-MM-DD' local-calendar date by `days` (may be negative). Pure
 * calendar-date arithmetic — deliberately not timezone-aware beyond the string. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive [start, end] local-date window for a range anchored at `date`. */
export function rangeWindow(range: DateRange, date: string): { start: string; end: string } {
  if (range === "day") return { start: date, end: date };
  if (range === "week") return { start: shiftDate(date, -6), end: date };
  return { start: shiftDate(date, -29), end: date }; // month ≈ trailing 30 days
}

export function isFutureLocalDate(date: string, today: string): boolean {
  return date > today;
}

export async function getReadingsForDate(db: D1Database, date: string): Promise<Reading[]> {
  return getReadingsInRange(db, date, date);
}

export async function getReadingsInRange(
  db: D1Database,
  start: string,
  end: string,
): Promise<Reading[]> {
  const res = await db
    .prepare("SELECT * FROM readings WHERE local_date BETWEEN ? AND ? ORDER BY ts ASC")
    .bind(start, end)
    .all<Reading>();
  return res.results ?? [];
}

export type DailyTotal = {
  date: string;
  generatedKwh: number;
  consumedKwh: number;
  gridImportKwh: number;
  gridExportKwh: number;
  selfKwh: number;
  homeChargeKwh: number;
};

/**
 * One row per local_date in [start,end], using the day's final running kWh
 * totals (each reading carries a cumulative-since-midnight value, so the max
 * for a date IS that day's total — no need to sum deltas).
 */
export async function getDailyTotals(
  db: D1Database,
  start: string,
  end: string,
): Promise<DailyTotal[]> {
  const rows = await db
    .prepare(
      `SELECT local_date,
              MAX(solar_new_kwh_today) sn, MAX(solar_old_kwh_today) so,
              MAX(grid_import_kwh_today) gi, MAX(grid_export_kwh_today) ge,
              MAX(house_kwh_today) house
       FROM readings
       WHERE local_date BETWEEN ? AND ?
       GROUP BY local_date
       ORDER BY local_date ASC`,
    )
    .bind(start, end)
    .all<{
      local_date: string;
      sn: number | null;
      so: number | null;
      gi: number | null;
      ge: number | null;
      house: number | null;
    }>();

  const charge = await getHomeChargeKwhByDate(db, start, end);
  const chargeByDate = new Map(charge.map((c) => [c.date, c.kwh]));

  return (rows.results ?? []).map((r) => {
    const generatedKwh = (r.sn ?? 0) + (r.so ?? 0);
    const consumedKwh = r.house ?? 0;
    const gridImportKwh = r.gi ?? 0;
    return {
      date: r.local_date,
      generatedKwh,
      consumedKwh,
      gridImportKwh,
      gridExportKwh: r.ge ?? 0,
      selfKwh: Math.max(0, consumedKwh - gridImportKwh),
      homeChargeKwh: chargeByDate.get(r.local_date) ?? 0,
    };
  });
}

export async function getHomeChargeKwhByDate(
  db: D1Database,
  start: string,
  end: string,
): Promise<{ date: string; kwh: number }[]> {
  const res = await db
    .prepare(
      `SELECT local_date date, ROUND(SUM(energy_added_kwh),2) kwh
       FROM tesla_charges
       WHERE at_home = 1 AND local_date BETWEEN ? AND ?
       GROUP BY local_date
       ORDER BY local_date ASC`,
    )
    .bind(start, end)
    .all<{ date: string; kwh: number | null }>();
  return (res.results ?? []).map((r) => ({ date: r.date, kwh: r.kwh ?? 0 }));
}

export type ChargeSession = {
  id: string;
  started_ts: number;
  ended_ts: number | null;
  energy_added_kwh: number | null;
  at_home: number;
  avgPowerKw: number | null;
};

/** Home charging sessions overlapping a single local date, with an average
 * power (energy ÷ duration) — an approximation until live Fleet API power
 * data lands; there is no per-minute charge-power reading yet. */
export async function getChargeSessionsForDate(
  db: D1Database,
  date: string,
): Promise<ChargeSession[]> {
  // A session starting the day before can still run past midnight into `date`.
  const res = await db
    .prepare(
      `SELECT id, started_ts, ended_ts, energy_added_kwh, at_home
       FROM tesla_charges
       WHERE at_home = 1 AND local_date BETWEEN ? AND ?
       ORDER BY started_ts ASC`,
    )
    .bind(shiftDate(date, -1), date)
    .all<{
      id: string;
      started_ts: number;
      ended_ts: number | null;
      energy_added_kwh: number | null;
      at_home: number;
    }>();

  return (res.results ?? [])
    .map((r) => {
      const durationH =
        r.ended_ts && r.ended_ts > r.started_ts ? (r.ended_ts - r.started_ts) / 3600 : null;
      const avgPowerKw =
        durationH && r.energy_added_kwh != null ? r.energy_added_kwh / durationH : null;
      return { ...r, avgPowerKw };
    })
    .filter((s) => {
      // Keep sessions that overlap the requested Melbourne local date, using
      // proper timezone conversion rather than a fixed UTC offset (correct
      // across the AEST/AEDT daylight-saving boundary).
      const end = s.ended_ts ?? s.started_ts;
      return melbDateFromTs(s.started_ts) === date || melbDateFromTs(end) === date;
    });
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
