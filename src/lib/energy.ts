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
  // Anker's own flow accounting — where power actually went, rather than
  // derived. `home_usage_kwh_today` is Anker's own whole-home figure; it
  // cannot see the Growatt array, so `house_kwh_today` is the truer total.
  solar_to_home_kwh_today: number | null;
  solar_to_battery_kwh_today: number | null;
  battery_to_home_kwh_today: number | null;
  grid_to_home_kwh_today: number | null;
  home_usage_kwh_today: number | null;
  sources: string | null;
};

export type BandName = "peak" | "shoulder" | "offPeak";

/**
 * A priced window inside the day, [startHour, endHour) in local time. Windows
 * may wrap past midnight (start > end). Anything no window covers is off-peak —
 * off-peak is the residual, never listed, which is how every retailer on this
 * meter has actually defined it. Windows must not overlap; where they do, peak
 * wins.
 */
export type TariffWindow = { band: "peak" | "shoulder"; startHour: number; endHour: number };

export type Tariff = {
  /** Retailer + plan, so any figure on the page can be traced back to its rates. */
  label: string;
  peakRate: number; // $/kWh inside a peak window
  shoulderRate: number; // $/kWh inside a shoulder window
  offPeakRate: number; // $/kWh everywhere else
  supplyPerDay: number; // $/day fixed supply charge
  feedIn: number; // $/kWh exported
  windows: TariffWindow[];
};

// ---------------------------------------------------------------------------
// TARIFF ERAS
//
// Rates are DATE-EFFECTIVE, not a single global setting. The house has been on
// three plans and the dashboard has to reprice each day at whatever was in force
// on that day — otherwise switching retailers silently rewrites two years of
// history and the reconciliation against real invoices stops matching.
//
// Add a new era here when the plan changes; never edit an old one.
// ---------------------------------------------------------------------------

/** Lumo "Time of Use v2" — peak 3pm-9pm, every day. */
const LUMO_TOU_V2: Tariff = {
  label: "Lumo Time of Use v2",
  peakRate: 0.308,
  shoulderRate: 0.18678, // no shoulder band on this plan: priced as off-peak
  offPeakRate: 0.18678,
  supplyPerDay: 1.00034,
  feedIn: 0.033,
  windows: [{ band: "peak", startHour: 15, endHour: 21 }],
};

/**
 * Lumo "Time of Use v3 FIT Solar" from 2026-07-20 — same rates as v2, but the
 * peak window moved 3pm -> 4pm. v3 also introduced a "Smart Rate" band at
 * 11am-4pm which it priced IDENTICALLY to off-peak, so it is modelled as a
 * shoulder window at the off-peak rate: structurally present, worth $0. That
 * band is what 1st Energy later prices separately.
 */
const LUMO_TOU_V3: Tariff = {
  label: "Lumo Time of Use v3 FIT Solar",
  peakRate: 0.308,
  shoulderRate: 0.18678,
  offPeakRate: 0.18678,
  supplyPerDay: 1.00034,
  feedIn: 0.033,
  windows: [
    { band: "peak", startHour: 16, endHour: 21 },
    { band: "shoulder", startHour: 11, endHour: 16 },
  ],
};

/**
 * 1st Energy "1st Emerald" TOU, signed 2026-08-31 (EPAS account 543520, fact
 * sheet 1ST787449MR). Rates are GST-inclusive as printed; the feed-in is GST-free.
 *
 * !! UNRESOLVED: the band WINDOWS have two conflicting sources. The rates
 * themselves are not in doubt — EPAS and fact sheet agree exactly.
 *
 *   FACTSHEET (used here): shoulder 7am-4pm and 9pm-10pm, off-peak 10pm-7am.
 *   WEBSITE (1stenergy.com.au/tou-timings, VIC residential): shoulder/solar-soak
 *   11am-4pm, off-peak 9pm-11am.
 *
 * On this house's measured 12 months the two differ by ~$103/yr ($2,406 vs
 * $2,509), because the fact-sheet reading puts the big 7-9am and 9-10pm import
 * blocks in the CHEAP shoulder band rather than off-peak. Swap
 * EMERALD_WINDOWS_WEBSITE in below if the first 1st Energy invoice disagrees.
 */
const EMERALD_WINDOWS_FACTSHEET: TariffWindow[] = [
  { band: "peak", startHour: 16, endHour: 21 },
  { band: "shoulder", startHour: 7, endHour: 16 },
  { band: "shoulder", startHour: 21, endHour: 22 },
];

/** The retailer's public timings page. Kept so the alternative is one edit away. */
export const EMERALD_WINDOWS_WEBSITE: TariffWindow[] = [
  { band: "peak", startHour: 16, endHour: 21 },
  { band: "shoulder", startHour: 11, endHour: 16 },
];

const FIRST_EMERALD: Tariff = {
  label: "1st Energy 1st Emerald",
  peakRate: 0.3157,
  shoulderRate: 0.1309,
  offPeakRate: 0.1705,
  supplyPerDay: 1.0483,
  feedIn: 0.005,
  windows: EMERALD_WINDOWS_FACTSHEET,
};

/**
 * When 1st Emerald starts pricing. This is the EPAS "Agreement Start Date"; the
 * actual retailer transfer may complete a little later, in which case the first
 * 1st Energy invoice will show the true start and this should be corrected to it.
 * Days before this date keep their Lumo rates, permanently.
 */
export const FIRST_ENERGY_FROM = "2026-08-31";

/** ToU v3 took effect on this date — peak window moved 3pm -> 4pm. */
export const V3_PEAK_FROM = "2026-07-20";

export type TariffEra = { from: string; tariff: Tariff };

/** Oldest first. The last era whose `from` is <= a date is the one in force. */
export const TARIFF_ERAS: TariffEra[] = [
  { from: "0000-01-01", tariff: LUMO_TOU_V2 },
  { from: V3_PEAK_FROM, tariff: LUMO_TOU_V3 },
  { from: FIRST_ENERGY_FROM, tariff: FIRST_EMERALD },
];

/** The plan currently in force (the newest era) — what the settings form edits. */
export const DEFAULT_TARIFF: Tariff = TARIFF_ERAS[TARIFF_ERAS.length - 1].tariff;

export const TARIFF_KV_KEY = "tariff";

/**
 * A function giving the tariff in force on any local date.
 *
 * `override` (from KV, set via the settings form) applies ONLY to the current
 * era. Historical days are always priced at the rates they were actually billed
 * at, so fiddling with the settings form can never rewrite a past bill.
 */
export type TariffAt = (date: string) => Tariff;

export function tariffResolver(override?: Tariff | null): TariffAt {
  const current = TARIFF_ERAS[TARIFF_ERAS.length - 1];
  return (date: string) => {
    let chosen = TARIFF_ERAS[0];
    for (const era of TARIFF_ERAS) if (era.from <= date) chosen = era;
    return chosen === current && override ? override : chosen.tariff;
  };
}

/** Convenience for callers that only need one date's rates. */
export function tariffForDate(date: string, override?: Tariff | null): Tariff {
  return tariffResolver(override)(date);
}

/** Every distinct plan that priced any day in [start, end], oldest first. */
export function tariffLabelsInRange(start: string, end: string, at: TariffAt): string[] {
  const labels: string[] = [];
  for (const era of TARIFF_ERAS) {
    if (era.from > end) continue;
    const label = at(era.from < start ? start : era.from).label;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

function clampNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

function clampHour(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(24, Math.max(0, Math.round(v))) : fallback;
}

/**
 * Coerce whatever is in KV into a usable current-era tariff.
 *
 * Tolerates the OLD two-band shape ({peakRate, offPeakRate, peakStartHour,
 * peakEndHour}) that KV may still hold from before the 1st Energy switch, so a
 * stale value degrades to sensible windows instead of throwing.
 */
export function normalizeTariff(input: Partial<Tariff> | null | undefined): Tariff {
  const raw = (input ?? {}) as Partial<Tariff> & {
    peakStartHour?: number;
    peakEndHour?: number;
  };
  const base = DEFAULT_TARIFF;

  let windows: TariffWindow[];
  if (Array.isArray(raw.windows) && raw.windows.length > 0) {
    windows = raw.windows
      .filter((w) => w && (w.band === "peak" || w.band === "shoulder"))
      .map((w) => ({
        band: w.band,
        startHour: clampHour(w.startHour, 0),
        endHour: clampHour(w.endHour, 0),
      }))
      .filter((w) => w.startHour !== w.endHour);
    if (windows.length === 0) windows = base.windows;
  } else if (typeof raw.peakStartHour === "number" && typeof raw.peakEndHour === "number") {
    // legacy two-band value
    windows = [
      {
        band: "peak",
        startHour: clampHour(raw.peakStartHour, 16),
        endHour: clampHour(raw.peakEndHour, 21),
      },
    ];
  } else {
    windows = base.windows;
  }

  return {
    label: typeof raw.label === "string" && raw.label ? raw.label : base.label,
    peakRate: clampNum(raw.peakRate, base.peakRate),
    shoulderRate: clampNum(raw.shoulderRate, base.shoulderRate),
    offPeakRate: clampNum(raw.offPeakRate, base.offPeakRate),
    supplyPerDay: clampNum(raw.supplyPerDay, base.supplyPerDay),
    feedIn: clampNum(raw.feedIn, base.feedIn),
    windows,
  };
}

/** The CURRENT plan's rates, with any KV override applied. */
export async function getTariff(kv: KVNamespace): Promise<Tariff> {
  try {
    const rawValue = await kv.get(TARIFF_KV_KEY);
    if (rawValue) return normalizeTariff(JSON.parse(rawValue) as Partial<Tariff>);
  } catch {
    // fall through to defaults
  }
  return DEFAULT_TARIFF;
}

/**
 * The date-aware pricer the cost functions take. Reads the current-era override
 * from KV once, then prices every date at whatever plan was in force that day.
 */
export async function getTariffAt(kv: KVNamespace): Promise<TariffAt> {
  return tariffResolver(await getTariff(kv));
}

/** Which band `hour` (0-23) falls in under `t`. Peak wins any overlap. */
export function bandForHour(hour: number, t: Tariff): BandName {
  for (const band of ["peak", "shoulder"] as const) {
    for (const w of t.windows) {
      if (w.band !== band) continue;
      const inside =
        w.startHour <= w.endHour
          ? hour >= w.startHour && hour < w.endHour
          : hour >= w.startHour || hour < w.endHour;
      if (inside) return band;
    }
  }
  return "offPeak";
}

/** The $/kWh a band is charged at. */
export function rateFor(band: BandName, t: Tariff): number {
  return band === "peak" ? t.peakRate : band === "shoulder" ? t.shoulderRate : t.offPeakRate;
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

/** Melbourne local {date, time} for a unix-seconds timestamp. */
export function melbFromTs(ts: number): { date: string; time: string } {
  return melbNow(new Date(ts * 1000));
}

/** The band a local 'HH:MM' falls in. */
export function bandForTime(localTime: string, t: Tariff): BandName {
  return bandForHour(Number(localTime.slice(0, 2)), t);
}

export function isPeak(localTime: string, t: Tariff): boolean {
  return bandForTime(localTime, t) === "peak";
}

export async function getLatest(db: D1Database): Promise<Reading | null> {
  return (
    (await db.prepare("SELECT * FROM readings ORDER BY ts DESC LIMIT 1").first<Reading>()) ??
    null
  );
}

export type SourceFreshness = {
  ts: number;
  date: string;
  time: string;
  kw: number | null;
};

/**
 * When each array last actually reported a value — independent of whether
 * it's in the single latest combined reading. Distinguishes "this array is
 * stuck/broken" from "it just hasn't reported anything since dark", which
 * look identical if you only ever look at the latest row.
 */
export async function getSourceFreshness(
  db: D1Database,
): Promise<{ anker: SourceFreshness | null; growatt: SourceFreshness | null }> {
  const [anker, growatt] = await Promise.all([
    db
      .prepare(
        "SELECT ts, local_date, local_time, solar_new_kw FROM readings WHERE sources LIKE '%anker%' ORDER BY ts DESC LIMIT 1",
      )
      .first<{ ts: number; local_date: string; local_time: string; solar_new_kw: number | null }>(),
    db
      .prepare(
        "SELECT ts, local_date, local_time, solar_old_kw FROM readings WHERE sources LIKE '%growatt%' ORDER BY ts DESC LIMIT 1",
      )
      .first<{ ts: number; local_date: string; local_time: string; solar_old_kw: number | null }>(),
  ]);
  return {
    anker: anker
      ? { ts: anker.ts, date: anker.local_date, time: anker.local_time, kw: anker.solar_new_kw }
      : null,
    growatt: growatt
      ? { ts: growatt.ts, date: growatt.local_date, time: growatt.local_time, kw: growatt.solar_old_kw }
      : null,
  };
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

/**
 * The Lumo billing cycle that `today` falls in. Bills run from the 18th of one
 * month to the 17th of the next (the "next read" date on the invoice), so the
 * dashboard's "this billing period" always matches what the retailer will bill.
 */
export function currentBillingCycle(
  today: string,
  anchorDay = 18,
): { start: string; end: string; lengthDays: number } {
  const [y, m, d] = today.split("-").map(Number);
  let sy = y;
  let sm = m;
  if (d < anchorDay) {
    sm -= 1;
    if (sm < 1) {
      sm = 12;
      sy -= 1;
    }
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${sy}-${pad(sm)}-${pad(anchorDay)}`;
  let ny = sy;
  let nm = sm + 1;
  if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  const end = shiftDate(`${ny}-${pad(nm)}-${pad(anchorDay)}`, -1); // day before next anchor
  const lengthDays = daysInclusive(start, end);
  return { start, end, lengthDays };
}

/** Inclusive day count between two 'YYYY-MM-DD' dates. */
export function daysInclusive(start: string, end: string): number {
  return (
    Math.round(
      (new Date(end + "T00:00:00Z").getTime() - new Date(start + "T00:00:00Z").getTime()) /
        86_400_000,
    ) + 1
  );
}

export type Cycle = { start: string; end: string; lengthDays: number; billed: boolean };

/**
 * The list of billing cycles, oldest→newest, for the cycle navigator.
 *
 * Lumo's read dates are NOT a rigid 18th→17th — they drift a day or two (a bill
 * ran 32 days, the next 29), which put a day's usage in the wrong cycle when the
 * dashboard assumed a fixed anchor. So past cycles use the ACTUAL invoice
 * boundaries recorded in meter_billing_periods; cycles after the last invoice
 * fall back to an estimated 18→17 rolling forward, until they cover `today`.
 */
export function buildCycleList(
  billedPeriods: { fromDate: string; toDate: string }[],
  today: string,
): Cycle[] {
  const sorted = [...billedPeriods].sort((a, b) => a.fromDate.localeCompare(b.fromDate));
  const cycles: Cycle[] = sorted.map((p) => ({
    start: p.fromDate,
    end: p.toDate,
    lengthDays: daysInclusive(p.fromDate, p.toDate),
    billed: true,
  }));

  // Estimated tail: continue from the day after the last invoice, in ~monthly
  // steps, until the current date is covered.
  let start = cycles.length ? shiftDate(cycles[cycles.length - 1].end, 1) : currentBillingCycle(today).start;
  for (let guard = 0; start <= today && guard < 24; guard++) {
    const [y, m, d] = start.split("-").map(Number);
    let ny = y;
    let nm = m + 1;
    if (nm > 12) {
      nm = 1;
      ny += 1;
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    // one calendar month on, minus a day — clamps naturally via shiftDate math
    const end = shiftDate(`${ny}-${pad(nm)}-${pad(d)}`, -1);
    cycles.push({ start, end, lengthDays: daysInclusive(start, end), billed: false });
    start = shiftDate(end, 1);
  }
  return cycles;
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
      // Each of these is a counter that resets at local midnight, so a day's
      // total is its LAST value, not its MAX.
      //
      // MAX is wrong for two independent reasons. Readings taken just after
      // midnight still carry the previous day's totals — Anker resets its
      // counters a little later — so MAX inflates every day to at least the day
      // before it (2026-08-02 read 54.33 kWh against a true 16.82). And a plain
      // last-row-of-the-day fetch fails too, because solar_old_kwh_today is only
      // populated on rows where the Growatt snapshot was fresh enough to merge,
      // so the final row is usually NULL for it.
      //
      // Hence: per column, the last NON-NULL value of that date.
      `SELECT d.local_date,
              (SELECT r.solar_new_kwh_today FROM readings r
                WHERE r.local_date = d.local_date AND r.solar_new_kwh_today IS NOT NULL
                ORDER BY r.ts DESC LIMIT 1) sn,
              (SELECT r.solar_old_kwh_today FROM readings r
                WHERE r.local_date = d.local_date AND r.solar_old_kwh_today IS NOT NULL
                ORDER BY r.ts DESC LIMIT 1) so,
              (SELECT r.grid_import_kwh_today FROM readings r
                WHERE r.local_date = d.local_date AND r.grid_import_kwh_today IS NOT NULL
                ORDER BY r.ts DESC LIMIT 1) gi,
              (SELECT r.grid_export_kwh_today FROM readings r
                WHERE r.local_date = d.local_date AND r.grid_export_kwh_today IS NOT NULL
                ORDER BY r.ts DESC LIMIT 1) ge,
              (SELECT r.battery_charge_kwh_today FROM readings r
                WHERE r.local_date = d.local_date AND r.battery_charge_kwh_today IS NOT NULL
                ORDER BY r.ts DESC LIMIT 1) bc,
              (SELECT r.battery_discharge_kwh_today FROM readings r
                WHERE r.local_date = d.local_date AND r.battery_discharge_kwh_today IS NOT NULL
                ORDER BY r.ts DESC LIMIT 1) bd
       FROM (SELECT DISTINCT local_date FROM readings
              WHERE local_date BETWEEN ? AND ?) d
       ORDER BY d.local_date ASC`,
    )
    .bind(start, end)
    .all<{
      local_date: string;
      sn: number | null;
      so: number | null;
      gi: number | null;
      ge: number | null;
      bc: number | null;
      bd: number | null;
    }>();

  const charge = await getHomeChargeKwhByDate(db, start, end);
  const chargeByDate = new Map(charge.map((c) => [c.date, c.kwh]));

  return (rows.results ?? []).map((r) => {
    const generatedKwh = (r.sn ?? 0) + (r.so ?? 0);
    // Derived here rather than read from the stored house_kwh_today. Each
    // column above is the day's last known value for that column, which may
    // come from a different row — and the stored house figure was computed on
    // whichever row it came from, so on a row that missed the Growatt merge it
    // excludes array #1 entirely. Recomputing from the day's best value for
    // each component keeps the day internally consistent.
    const consumedKwh = Math.max(
      0,
      generatedKwh + (r.bd ?? 0) + (r.gi ?? 0) - (r.bc ?? 0) - (r.ge ?? 0),
    );
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

// ---------------------------------------------------------------------------
// Powercor smart meter — the BILLING-GRADE source of truth (see schema.sql).
//
// getDailyTotals above is the live estimate derived from the Anker/Growatt CT
// clamps; these read the revenue meter the bill is actually calculated from,
// imported from the myEnergy CSV exports (30-min, ~1 day in arrears). Validated
// 2026-08 over 17 complete days: export matches the clamps to 0.4% and import to
// ~1%; use these whenever a figure has to match the bill exactly.

export type MeterDailyTotal = {
  date: string;
  importKwh: number;
  importPeakKwh: number;
  importShoulderKwh: number;
  importOffPeakKwh: number;
  exportKwh: number;
  /** false if any interval that day was estimated/substituted rather than metered. */
  actual: boolean;
};

/**
 * Daily import/export totals from the meter, with import split across the price
 * bands in force ON THAT DATE.
 *
 * The bucketing used to be a SQL CASE on the interval's start hour, which could
 * only express one peak window with a hardcoded date pivot. Three bands, two
 * shoulder blocks and an open-ended list of plan eras don't fit in that shape,
 * so the intervals come back raw and are bucketed here instead. Ranges are
 * billing cycles (~1,500 import rows), so the extra rows are cheap.
 *
 * Each interval is assigned whole to the band its START hour falls in — that is
 * how the retailer bills a 30-minute block, and every window boundary in every
 * plan so far lands on the hour, so no interval ever straddles two bands.
 */
export async function getMeterDailyTotals(
  db: D1Database,
  start: string,
  end: string,
  at: TariffAt = tariffResolver(),
): Promise<MeterDailyTotal[]> {
  const res = await db
    .prepare(
      `SELECT local_date, interval_start, stream, kwh, quality
       FROM meter_intervals
       WHERE local_date BETWEEN ? AND ?
       ORDER BY local_date ASC, interval_start ASC`,
    )
    .bind(start, end)
    .all<{
      local_date: string;
      interval_start: string;
      stream: string;
      kwh: number;
      quality: string | null;
    }>();

  const byDate = new Map<string, MeterDailyTotal>();
  for (const r of res.results ?? []) {
    let d = byDate.get(r.local_date);
    if (!d) {
      d = {
        date: r.local_date,
        importKwh: 0,
        importPeakKwh: 0,
        importShoulderKwh: 0,
        importOffPeakKwh: 0,
        exportKwh: 0,
        actual: true,
      };
      byDate.set(r.local_date, d);
    }
    if (r.quality !== "Actual") d.actual = false;
    if (r.stream === "export") {
      d.exportKwh += r.kwh;
      continue;
    }
    if (r.stream !== "import") continue;
    d.importKwh += r.kwh;
    const band = bandForTime(r.interval_start, at(r.local_date));
    if (band === "peak") d.importPeakKwh += r.kwh;
    else if (band === "shoulder") d.importShoulderKwh += r.kwh;
    else d.importOffPeakKwh += r.kwh;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Price meter daily totals. Mirrors computeCost's shape, but the band split is
 * exact (metered per interval), never apportioned.
 *
 * Priced per DAY at that day's plan, so a cycle straddling a retailer switch
 * bills each side at its own rates instead of applying today's plan backwards.
 */
export function meterCost(daily: MeterDailyTotal[], at: TariffAt): CostBreakdown {
  let peakKwh = 0;
  let shoulderKwh = 0;
  let offPeakKwh = 0;
  let exportKwh = 0;
  let peakCost = 0;
  let shoulderCost = 0;
  let offPeakCost = 0;
  let exportCredit = 0;
  let supply = 0;

  for (const d of daily) {
    const t = at(d.date);
    peakKwh += d.importPeakKwh;
    shoulderKwh += d.importShoulderKwh;
    offPeakKwh += d.importOffPeakKwh;
    exportKwh += d.exportKwh;
    peakCost += d.importPeakKwh * t.peakRate;
    shoulderCost += d.importShoulderKwh * t.shoulderRate;
    offPeakCost += d.importOffPeakKwh * t.offPeakRate;
    exportCredit += d.exportKwh * t.feedIn;
    supply += t.supplyPerDay;
  }

  const importCost = peakCost + shoulderCost + offPeakCost;
  return {
    importCost,
    exportCredit,
    supply,
    net: importCost + supply - exportCredit,
    peakKwh,
    shoulderKwh,
    offPeakKwh,
    peakCost,
    shoulderCost,
    offPeakCost,
    importKwh: peakKwh + shoulderKwh + offPeakKwh,
    exportKwh,
    days: daily.length,
    hasGaps: false, // metered per interval — no apportioning
  };
}

export type MeterBillingPeriod = {
  fromDate: string;
  toDate: string;
  peakKwh: number;
  offPeakKwh: number;
  solarKwh: number;
  importKwh: number;
};

/** Billed period totals exactly as they appear on the bill (18th → 17th cycle),
 *  newest first. */
export async function getMeterBillingPeriods(db: D1Database): Promise<MeterBillingPeriod[]> {
  const res = await db
    .prepare(
      `SELECT from_date, to_date, peak_kwh, offpeak_kwh, solar_kwh
       FROM meter_billing_periods ORDER BY from_date DESC`,
    )
    .all<{
      from_date: string;
      to_date: string;
      peak_kwh: number | null;
      offpeak_kwh: number | null;
      solar_kwh: number | null;
    }>();
  return (res.results ?? []).map((r) => ({
    fromDate: r.from_date,
    toDate: r.to_date,
    peakKwh: r.peak_kwh ?? 0,
    offPeakKwh: r.offpeak_kwh ?? 0,
    solarKwh: r.solar_kwh ?? 0,
    importKwh: (r.peak_kwh ?? 0) + (r.offpeak_kwh ?? 0),
  }));
}

export type MeterReconcileRow = {
  date: string;
  meterImportKwh: number;
  clampImportKwh: number;
  importDiffKwh: number;
  meterExportKwh: number;
  clampExportKwh: number;
  exportDiffKwh: number;
};

/**
 * Per-day meter-vs-clamp comparison over a range — the accuracy check for the CT
 * clamps. Positive diff = the clamps read HIGHER than the meter. Only dates the
 * meter covers are returned; a clamp value of 0 means no reading that day.
 */
export async function reconcileMeterVsReadings(
  db: D1Database,
  start: string,
  end: string,
): Promise<MeterReconcileRow[]> {
  const [meter, clamp] = await Promise.all([
    getMeterDailyTotals(db, start, end),
    getDailyTotals(db, start, end),
  ]);
  const clampByDate = new Map(clamp.map((c) => [c.date, c]));
  return meter.map((m) => {
    const c = clampByDate.get(m.date);
    const ci = c?.gridImportKwh ?? 0;
    const ce = c?.gridExportKwh ?? 0;
    return {
      date: m.date,
      meterImportKwh: m.importKwh,
      clampImportKwh: ci,
      importDiffKwh: ci - m.importKwh,
      meterExportKwh: m.exportKwh,
      clampExportKwh: ce,
      exportDiffKwh: ce - m.exportKwh,
    };
  });
}

export type TeslaCycleCost = {
  kwh: number; // total charged at home over the window
  freeKwh: number; // covered by solar/battery (grid wasn't importing)
  gridPeakKwh: number;
  gridShoulderKwh: number;
  gridOffPeakKwh: number;
  gridPeakCost: number;
  gridShoulderCost: number;
  gridOffPeakCost: number;
  gridCost: number; // gridPeakCost + gridOffPeakCost — what the car added to the bill
  fullGridCost: number; // what it would cost if every kWh were grid-charged
  saved: number; // fullGridCost − gridCost, i.e. the value of the free solar charging
  hadMeterGap: boolean; // some charging had no meter interval yet (e.g. today), counted as grid
};

const slotLabel = (time: string) =>
  `${time.slice(0, 2)}:${Number(time.slice(3, 5)) >= 30 ? "30" : "00"}`;

/**
 * The car's home charging over [start,end], attributed to grid vs solar using
 * the METER (billing-grade), so it's accurate for any historic cycle — not just
 * the recent days the Anker clamps cover. For each 30-minute interval the car's
 * grid draw is capped at the whole-home grid import then (min): if the house
 * wasn't importing, the car ran on solar/battery and cost nothing; the rest is
 * priced at that interval's tariff window. An upper bound (other loads compete
 * for the same import), stated as such on the page.
 *
 * Charging comes from tesla_state deltas (live, from 2026-08) and the tesla_charges
 * session history (to 2026-07-10); the two never overlap in time, so no double-count.
 */
export async function getTeslaCycleGridCost(
  db: D1Database,
  start: string,
  end: string,
  at: TariffAt,
): Promise<TeslaCycleCost> {
  // meter grid import per 30-min interval, keyed "YYYY-MM-DD HH:MM"
  const meter = await db
    .prepare(
      "SELECT local_date, interval_start, kwh FROM meter_intervals WHERE stream='import' AND local_date BETWEEN ? AND ?",
    )
    .bind(start, end)
    .all<{ local_date: string; interval_start: string; kwh: number }>();
  const imp = new Map<string, number>();
  for (const r of meter.results ?? []) imp.set(`${r.local_date} ${r.interval_start}`, r.kwh);

  // car kWh per interval
  const car = new Map<string, number>();
  const addCar = (date: string, slot: string, kwh: number) => {
    if (date < start || date > end || !(kwh > 0)) return;
    const k = `${date} ${slot}`;
    car.set(k, (car.get(k) ?? 0) + kwh);
  };

  // (a) session history — distribute each session across the local half-hours it spans
  const sess = await db
    .prepare(
      "SELECT started_ts, ended_ts, energy_added_kwh e FROM tesla_charges WHERE at_home=1 AND energy_added_kwh > 0 AND local_date BETWEEN ? AND ?",
    )
    .bind(shiftDate(start, -1), end)
    .all<{ started_ts: number; ended_ts: number | null; e: number }>();
  for (const s of sess.results ?? []) {
    const startTs = s.started_ts;
    const endTs = s.ended_ts && s.ended_ts > startTs ? s.ended_ts : startTs + 1800;
    const dur = Math.max(1, endTs - startTs);
    let ts = startTs;
    for (let guard = 0; ts < endTs && guard < 500; guard++) {
      const { date, time } = melbFromTs(ts);
      const stepSec = (30 - (Number(time.slice(3, 5)) % 30)) * 60;
      const stepEnd = Math.min(endTs, ts + stepSec);
      addCar(date, slotLabel(time), (s.e * (stepEnd - ts)) / dur);
      ts = stepEnd;
    }
  }

  // (b) live state — sum positive deltas of the per-session cumulative counter
  const st = await db
    .prepare(
      "SELECT local_date, local_time, charge_energy_added_kwh e, at_home h FROM tesla_state WHERE local_date BETWEEN ? AND ? ORDER BY ts",
    )
    .bind(start, end)
    .all<{ local_date: string; local_time: string; e: number | null; h: number | null }>();
  let last: number | null = null;
  for (const r of st.results ?? []) {
    if (r.e == null) {
      last = null;
      continue;
    }
    if (last != null && r.e >= last && r.h === 1) {
      const d = r.e - last;
      if (d > 0 && d < 50) addCar(r.local_date, slotLabel(r.local_time), d);
    }
    last = r.e;
  }

  // attribute each interval, at the rates in force on that interval's own date
  let kwh = 0;
  let freeKwh = 0;
  let gridPeakKwh = 0;
  let gridShoulderKwh = 0;
  let gridOffPeakKwh = 0;
  let gridPeakCost = 0;
  let gridShoulderCost = 0;
  let gridOffPeakCost = 0;
  let fullGridCost = 0;
  let hadMeterGap = false;
  for (const [key, ck] of car) {
    kwh += ck;
    const date = key.slice(0, 10);
    const t = at(date);
    const band = bandForTime(key.slice(11), t);
    const rate = rateFor(band, t);
    const gi = imp.get(key);
    if (gi == null) hadMeterGap = true;
    const grid = gi == null ? ck : Math.min(ck, gi);
    freeKwh += ck - grid;
    fullGridCost += ck * rate;
    if (band === "peak") {
      gridPeakKwh += grid;
      gridPeakCost += grid * rate;
    } else if (band === "shoulder") {
      gridShoulderKwh += grid;
      gridShoulderCost += grid * rate;
    } else {
      gridOffPeakKwh += grid;
      gridOffPeakCost += grid * rate;
    }
  }
  const gridCost = gridPeakCost + gridShoulderCost + gridOffPeakCost;
  return {
    kwh,
    freeKwh,
    gridPeakKwh,
    gridShoulderKwh,
    gridOffPeakKwh,
    gridPeakCost,
    gridShoulderCost,
    gridOffPeakCost,
    gridCost,
    fullGridCost,
    saved: fullGridCost - gridCost,
    hadMeterGap,
  };
}

export type BillSplit = {
  cycle: { start: string; end: string; lengthDays: number };
  daysCovered: number; // days of the cycle the meter has data for
  lengthDays: number;
  lastMeterDate: string | null;
  complete: boolean; // meter covers the whole cycle (a past bill), so no projection
  soFar: CostBreakdown; // billing-grade cost for the covered days
  projectedNet: number; // linear projection to the full cycle
  tesla: TeslaCycleCost & { projectedGridCost: number };
  houseSoFar: number; // net minus the car's grid cost
  houseProjected: number;
  housemates: number;
  perHousemate: number; // projected house cost ÷ housemates
  yourShare: number; // your housemate share + all of your car
};

/**
 * The bill for one cycle, split for housemates. Cost is billing-grade (meter);
 * the car's grid-supplied share (from getTeslaCycleGridCost) is treated as the
 * bill-payer's alone so the rest divides N ways. For a completed past cycle the
 * meter covers every day, so projection = actual; for the current cycle it's a
 * linear extension of the covered days.
 */
export function computeBillSplit(
  cycle: { start: string; end: string; lengthDays: number },
  meterDaily: MeterDailyTotal[],
  tesla: TeslaCycleCost,
  at: TariffAt,
  housemates = 4,
): BillSplit {
  const soFar = meterCost(meterDaily, at);
  const daysCovered = meterDaily.length;
  const lastMeterDate = daysCovered > 0 ? meterDaily[daysCovered - 1].date : null;
  const complete = daysCovered >= cycle.lengthDays;
  const factor = daysCovered > 0 ? cycle.lengthDays / daysCovered : 0;

  const teslaGrid = tesla.gridCost;
  const projectedNet = soFar.net * factor;
  const houseSoFar = Math.max(0, soFar.net - teslaGrid);
  const houseProjected = houseSoFar * factor;
  const perHousemate = houseProjected / housemates;

  return {
    cycle,
    daysCovered,
    lengthDays: cycle.lengthDays,
    lastMeterDate,
    complete,
    soFar,
    projectedNet,
    tesla: { ...tesla, projectedGridCost: teslaGrid * factor },
    houseSoFar,
    houseProjected,
    housemates,
    perHousemate,
    yourShare: perHousemate + teslaGrid * factor,
  };
}

/**
 * Home-charging kWh per date, live Fleet API data taking precedence.
 *
 * Two sources exist and they must not be added together:
 *  - `tesla_state` — live 5-minute Fleet API samples. Authoritative.
 *  - `tesla_charges` — the one-off Tessie CSV import, history only (to
 *    2026-07-10). Reference for dates the Fleet API never covered.
 *
 * Resolved per date rather than by a single cutoff, so a date is served by live
 * samples whenever it has any and falls back to Tessie only where it has none.
 */
export async function getHomeChargeKwhByDate(
  db: D1Database,
  start: string,
  end: string,
): Promise<{ date: string; kwh: number }[]> {
  const [legacy, live] = await Promise.all([
    db
      .prepare(
        `SELECT local_date date, ROUND(SUM(energy_added_kwh),2) kwh
         FROM tesla_charges
         WHERE at_home = 1 AND local_date BETWEEN ? AND ?
         GROUP BY local_date
         ORDER BY local_date ASC`,
      )
      .bind(start, end)
      .all<{ date: string; kwh: number | null }>(),
    db
      .prepare(
        `SELECT local_date, ts, local_time, charging_state, charge_power_kw,
                battery_level, charge_energy_added_kwh, at_home
         FROM tesla_state
         WHERE local_date BETWEEN ? AND ?
         ORDER BY ts ASC`,
      )
      .bind(start, end)
      .all<TeslaSample & { local_date: string }>(),
  ]);

  const byDate = new Map<string, number>();
  for (const r of legacy.results ?? []) byDate.set(r.date, r.kwh ?? 0);

  // Group live samples per date, then reuse the same delta walk the day view
  // uses so the two views can't report different numbers.
  const grouped = new Map<string, TeslaSample[]>();
  for (const r of live.results ?? []) {
    const list = grouped.get(r.local_date);
    if (list) list.push(r);
    else grouped.set(r.local_date, [r]);
  }
  for (const [date, samples] of grouped) {
    byDate.set(date, chargedKwhFromSamples(samples)); // live overrides Tessie
  }

  return [...byDate.entries()]
    .map(([date, kwh]) => ({ date, kwh }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** One live Fleet API sample of the car's state. */
export type TeslaSample = {
  ts: number;
  local_date: string;
  local_time: string;
  charging_state: string | null;
  charge_power_kw: number | null;
  battery_level: number | null;
  charge_energy_added_kwh: number | null;
  at_home: number | null;
};

/**
 * Live per-sample car state for a day, from the Fleet API.
 *
 * This is the source the chart should use for any day the Fleet API was
 * connected. `tesla_charges` (the Tessie CSV import) only covers history up to
 * 2026-07-10 and is the fallback for older days.
 */
export async function getTeslaStateForDate(db: D1Database, date: string): Promise<TeslaSample[]> {
  const res = await db
    .prepare(
      `SELECT ts, local_date, local_time, charging_state, charge_power_kw,
              battery_level, charge_energy_added_kwh, at_home
       FROM tesla_state WHERE local_date = ? ORDER BY ts ASC`,
    )
    .bind(date)
    .all<TeslaSample>();
  return res.results ?? [];
}

/**
 * kWh added at home over a day's samples.
 *
 * `charge_energy_added_kwh` is cumulative within a charging session and resets
 * when a new one starts, so this sums positive deltas and treats a drop as a
 * fresh session (counting the new value). That's more accurate than integrating
 * power over 5-minute samples, which would miss charging that starts and stops
 * between them.
 */
/**
 * Newest Tesla sample regardless of date, for the "right now" strip.
 *
 * Returns null when the newest sample is older than `maxAgeSec` — the car sleeps
 * and the collector skips samples while it does, so a stale row must not be
 * presented as current draw.
 *
 * 8 minutes tolerates one missed cycle of the idle 5-minute cadence with slack.
 * It used to be 15, which was long enough for a finished charge to keep showing
 * as active. While a charge is actually running the collector samples every
 * ~1 min, so this window is never the binding constraint then.
 */
export async function getLatestTeslaState(
  db: D1Database,
  maxAgeSec = 8 * 60,
): Promise<TeslaSample | null> {
  const row = await db
    .prepare(
      `SELECT ts, local_date, local_time, charging_state, charge_power_kw,
              battery_level, charge_energy_added_kwh, at_home
       FROM tesla_state ORDER BY ts DESC LIMIT 1`,
    )
    .first<TeslaSample>();
  if (!row) return null;
  const age = Math.floor(Date.now() / 1000) - row.ts;
  return age <= maxAgeSec ? row : null;
}

/** Live samples across a date range, for the week and month views. */
export async function getTeslaStateInRange(
  db: D1Database,
  start: string,
  end: string,
): Promise<TeslaSample[]> {
  const res = await db
    .prepare(
      `SELECT ts, local_date, local_time, charging_state, charge_power_kw,
              battery_level, charge_energy_added_kwh, at_home
       FROM tesla_state WHERE local_date BETWEEN ? AND ? ORDER BY ts ASC`,
    )
    .bind(start, end)
    .all<TeslaSample>();
  return res.results ?? [];
}

/** One chunk of charging: how much, and the window it accrued over. */
type ChargeDelta = { kwh: number; fromMin: number; toMin: number; date: string };

function minuteOfDay(localTime: string): number {
  const [h, m] = localTime.split(":");
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

/**
 * Walks a day's samples and yields each increment of charge, with the window it
 * happened in. Both the day total and the tariff split derive from this, so
 * they can never disagree.
 */
function chargeDeltas(samples: TeslaSample[]): ChargeDelta[] {
  const out: ChargeDelta[] = [];
  let prev: number | null = null;
  let prevMin = 0;
  let prevDate: string | null = null;
  for (const s of samples) {
    if (s.at_home === 0) continue; // only count charging done at home
    const v = s.charge_energy_added_kwh;
    if (v == null) continue;
    const min = minuteOfDay(s.local_time);
    // Over a multi-day range, don't let a window run from yesterday's clock time
    // to today's — that would span the wrong tariff bands.
    if (prevDate !== null && s.local_date !== prevDate) prevMin = 0;
    prevDate = s.local_date;

    if (prev == null) {
      // The day's first sample may already be mid-session, so its counter
      // reading is energy we'd otherwise never see. Only trust it while the car
      // is actually charging — a parked car reports the *previous* session's
      // total, which would double-count it.
      if (s.charging_state === "Charging" && v > 0)
        out.push({ kwh: v, fromMin: 0, toMin: min, date: s.local_date });
    } else if (v > prev) {
      out.push({ kwh: v - prev, fromMin: prevMin, toMin: min, date: s.local_date });
    } else if (v < prev * 0.5) {
      // A genuine reset: the counter drops to ~0 when a new session starts.
      if (v > 0) out.push({ kwh: v, fromMin: prevMin, toMin: min, date: s.local_date });
    }
    // Anything else is a decrease that isn't a reset — ignore it. Tesla's
    // charge_energy_added creeps *downward* by ~0.02 kWh per sample once a
    // session completes (observed 13.70 -> 13.68 -> 13.66 ...). Treating those
    // as resets added the full counter back on every sample, which turned one
    // real 13.7 kWh session into a reported 110 kWh.
    prev = v;
    prevMin = min;
  }
  return out;
}

/**
 * Longest gap in minutes between consecutive at-home samples for a day,
 * measured from midnight.
 *
 * The car can run a scheduled charge without coming online for third-party
 * polling — vehicle_data just returns 408 — so a charge can complete entirely
 * between samples and be invisible. Observed 2026-08-02: no samples at all
 * between 22:46 and 11:06, over which 2.9 kWh went in unrecorded.
 *
 * Deliberately reported rather than guessed at. The first sample after a gap
 * does carry a counter value, but counting it risks double-counting a stale
 * session, and Tesla's counter creeps downward after a session ends, so it
 * can't be told apart from a genuine new charge with any confidence.
 *
 * Note this only affects attribution of energy TO the car. Anker meters the
 * whole house including the charger, so consumption, grid import and cost are
 * unaffected by these gaps.
 */
export function teslaCoverageGapMin(samples: TeslaSample[]): number {
  const home = samples.filter((s) => s.at_home !== 0);
  if (home.length === 0) return 0;
  let worst = minuteOfDay(home[0].local_time); // midnight -> first sample
  for (let i = 1; i < home.length; i++) {
    worst = Math.max(worst, minuteOfDay(home[i].local_time) - minuteOfDay(home[i - 1].local_time));
  }
  return worst;
}

export function chargedKwhFromSamples(samples: TeslaSample[]): number {
  return chargeDeltas(samples).reduce((s, d) => s + d.kwh, 0);
}

/** Cost attributed to charging the car. */
export type TeslaCost = {
  /** Total charged at home over the period. */
  kwh: number;
  peakKwh: number;
  shoulderKwh: number;
  offPeakKwh: number;
  /** Portion the grid actually supplied, apportioned from the meter. */
  gridKwh: number;
  /** Grid-supplied portion split by tariff window. These two are what you
   *  actually pay for, and their costs sum to `gridCost` exactly. */
  gridPeakKwh: number;
  gridShoulderKwh: number;
  gridOffPeakKwh: number;
  gridPeakCost: number;
  gridShoulderCost: number;
  gridOffPeakCost: number;
  /** Portion covered by solar or the battery, so it cost nothing to import. */
  selfKwh: number;
  /** Cost of the grid-supplied portion at time-of-use rates. */
  gridCost: number;
  /** What the whole charge would have cost drawn entirely from the grid. */
  fullGridCost: number;
  /** Saved by charging off solar/battery rather than importing it all. */
  saved: number;
  /** False when no readings overlapped the charging windows, so the
   *  solar-vs-grid attribution is a whole-period average rather than measured. */
  measured: boolean;
};

/**
 * What the car cost to charge.
 *
 * Important: this is NOT an extra line on the bill. The car is part of the house
 * load, so its energy is already inside the metered import that `computeCost`
 * charges for. This attributes a share of that existing cost to the car rather
 * than adding to it — adding would double-count.
 *
 * The solar-vs-grid split is apportioned, not measured directly: Anker meters
 * the whole house as one figure and cannot see the car separately. For each
 * increment of charge we take the grid's share of total house draw over that
 * same window — if the house was pulling 60% of its load from the grid while the
 * car charged, 60% of that increment is treated as grid-supplied. Averaging over
 * the window (rather than assuming the car is the marginal load) is the
 * conservative reading and is what the meter can actually support.
 */
export function computeTeslaCost(
  readings: Reading[],
  samples: TeslaSample[],
  sessions: ChargeSession[],
  at: TariffAt,
): TeslaCost {
  // Live samples give ~1-minute increments. For dates the Fleet API never
  // covered, fall back to the imported Tessie sessions, treating each whole
  // session as one increment spanning its own duration — coarser, but it keeps
  // history costed instead of silently reporting $0.
  const deltas: ChargeDelta[] =
    samples.length > 0
      ? chargeDeltas(samples)
      : sessions
          .filter((c) => c.at_home === 1 && (c.energy_added_kwh ?? 0) > 0)
          .map((c) => {
            const start = new Date(c.started_ts * 1000);
            const end = new Date((c.ended_ts ?? c.started_ts) * 1000);
            const fromMin = start.getHours() * 60 + start.getMinutes();
            let toMin = end.getHours() * 60 + end.getMinutes();
            if (toMin < fromMin) toMin = 1440; // ran past local midnight
            return { kwh: c.energy_added_kwh ?? 0, fromMin, toMin, date: c.local_date };
          });
  // Keyed by date as well as minute: over a week view, matching on minute alone
  // would attribute Monday's charging against Thursday's meter readings.
  const byDate = new Map<string, { min: number; house: number; grid: number }[]>();
  for (const r of readings) {
    if (r.house_kw == null) continue;
    const row = {
      min: minuteOfDay(r.local_time),
      house: r.house_kw ?? 0,
      grid: Math.max(0, r.grid_import_kw ?? 0),
    };
    const list = byDate.get(r.local_date);
    if (list) list.push(row);
    else byDate.set(r.local_date, [row]);
  }

  let kwh = 0;
  let peakKwh = 0;
  let shoulderKwh = 0;
  let offPeakKwh = 0;
  let gridPeakKwh = 0;
  let gridShoulderKwh = 0;
  let gridOffPeakKwh = 0;
  let gridPeakCost = 0;
  let gridShoulderCost = 0;
  let gridOffPeakCost = 0;
  let fullGridCost = 0;
  let anyOverlap = false;

  for (const d of deltas) {
    const to = Math.max(d.toMin, d.fromMin + 1);
    const t = at(d.date); // rates as they were on the day of this charge
    const f = bandFractions(d.fromMin, to, t);

    kwh += d.kwh;
    peakKwh += d.kwh * f.peak;
    shoulderKwh += d.kwh * f.shoulder;
    offPeakKwh += d.kwh * f.offPeak;
    fullGridCost +=
      d.kwh * (f.peak * t.peakRate + f.shoulder * t.shoulderRate + f.offPeak * t.offPeakRate);

    // Grid's share of house draw across this window.
    const dayRows = byDate.get(d.date) ?? [];
    const inWindow = dayRows.filter((r) => r.min >= d.fromMin && r.min <= to);
    const totalHouse = inWindow.reduce((a, r) => a + r.house, 0);
    const totalGrid = inWindow.reduce((a, r) => a + r.grid, 0);
    let gridShare: number;
    if (inWindow.length > 0 && totalHouse > 0) {
      gridShare = Math.min(1, totalGrid / totalHouse);
      anyOverlap = true;
    } else {
      // No overlapping readings: charging overnight almost certainly came off
      // the grid, so assume the worst rather than quietly reporting it as free.
      gridShare = 1;
    }
    const g = d.kwh * gridShare;
    gridPeakKwh += g * f.peak;
    gridShoulderKwh += g * f.shoulder;
    gridOffPeakKwh += g * f.offPeak;
    // Costs accumulate alongside the kWh at the same rates, so the band lines
    // always sum to the total even across a plan change mid-period.
    gridPeakCost += g * f.peak * t.peakRate;
    gridShoulderCost += g * f.shoulder * t.shoulderRate;
    gridOffPeakCost += g * f.offPeak * t.offPeakRate;
  }

  const gridCost = gridPeakCost + gridShoulderCost + gridOffPeakCost;
  const gridKwh = gridPeakKwh + gridShoulderKwh + gridOffPeakKwh;

  return {
    kwh,
    peakKwh,
    shoulderKwh,
    offPeakKwh,
    gridKwh,
    gridPeakKwh,
    gridShoulderKwh,
    gridOffPeakKwh,
    gridPeakCost,
    gridShoulderCost,
    gridOffPeakCost,
    selfKwh: Math.max(0, kwh - gridKwh),
    gridCost,
    fullGridCost,
    saved: Math.max(0, fullGridCost - gridCost),
    measured: anyOverlap,
  };
}

export type ChargeSession = {
  id: string;
  local_date: string;
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
      `SELECT id, local_date, started_ts, ended_ts, energy_added_kwh, at_home
       FROM tesla_charges
       WHERE at_home = 1 AND local_date BETWEEN ? AND ?
       ORDER BY started_ts ASC`,
    )
    .bind(shiftDate(date, -1), date)
    .all<{
      id: string;
      local_date: string;
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

export function minutesOfDay(localTime: string): number {
  const [hh, mm] = localTime.split(":").map(Number);
  return hh * 60 + mm;
}

/** The clock ranges (minutes from midnight) a band occupies, for chart shading.
 *  Off-peak is the residual and is deliberately not returned. */
export function bandRanges(band: "peak" | "shoulder", t: Tariff): [number, number][] {
  return t.windows.filter((w) => w.band === band).flatMap(windowRanges);
}

/** How a window's minutes divide across the three bands. Sums to 1. */
export type BandSplit = { peak: number; shoulder: number; offPeak: number };

const overlapMin = (a: [number, number], b: [number, number]) =>
  Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

/** The clock ranges a window covers, splitting one that wraps past midnight. */
function windowRanges(w: TariffWindow): [number, number][] {
  return w.startHour <= w.endHour
    ? [[w.startHour * 60, w.endHour * 60]]
    : [
        [w.startHour * 60, 1440],
        [0, w.endHour * 60],
      ];
}

/**
 * Fraction of [startMin,endMin) falling in each price band. Used to apportion a
 * block of grid import when it straddles a tariff boundary (or a gap in
 * readings). Peak minutes are counted first and subtracted from shoulder, so
 * overlapping windows can never double-count.
 */
export function bandFractions(startMin: number, endMin: number, t: Tariff): BandSplit {
  const total = endMin - startMin;
  if (total <= 0) {
    const b = bandForHour(Math.floor((((startMin % 1440) + 1440) % 1440) / 60), t);
    return { peak: b === "peak" ? 1 : 0, shoulder: b === "shoulder" ? 1 : 0, offPeak: b === "offPeak" ? 1 : 0 };
  }
  const span: [number, number] = [startMin, endMin];
  const peakRanges = t.windows.filter((w) => w.band === "peak").flatMap(windowRanges);
  const shoulderRanges = t.windows.filter((w) => w.band === "shoulder").flatMap(windowRanges);

  let peak = 0;
  for (const r of peakRanges) peak += overlapMin(span, r);

  let shoulder = 0;
  for (const r of shoulderRanges) {
    let mins = overlapMin(span, r);
    // strip any minutes this shoulder range shares with a peak range
    for (const pr of peakRanges) mins -= overlapMin([Math.max(span[0], r[0]), Math.min(span[1], r[1])], pr);
    shoulder += Math.max(0, mins);
  }

  peak = Math.min(peak, total);
  shoulder = Math.min(shoulder, total - peak);
  return {
    peak: peak / total,
    shoulder: shoulder / total,
    offPeak: Math.max(0, (total - peak - shoulder) / total),
  };
}

export type CostBreakdown = {
  importCost: number;
  exportCredit: number;
  supply: number;
  net: number;
  peakKwh: number;
  shoulderKwh: number;
  offPeakKwh: number;
  /** Cost per band, accumulated at each day's own rates — so these stay correct
   *  across a cycle that straddles a plan change, where kWh x today's rate
   *  would not. Always prefer these over multiplying volumes by a rate. */
  peakCost: number;
  shoulderCost: number;
  offPeakCost: number;
  importKwh: number;
  exportKwh: number;
  days: number;
  /** True if any priced block spans a >20 min gap in readings — the kWh total
   * is still correct (it comes from the meter's own cumulative counter), but
   * the peak/off-peak split for that block is apportioned by elapsed time
   * rather than measured directly. */
  hasGaps: boolean;
};

/**
 * Price grid usage over an arbitrary set of readings (one day, or many).
 *
 * Each reading carries counters that are cumulative since local midnight, so
 * a day's usage is reconstructed as: the first reading's value (everything
 * from midnight up to that reading) plus the positive deltas between
 * consecutive readings. Working per-day matters because those counters reset
 * at midnight — treating a multi-day series as one sequence would discard
 * each day's opening block and mis-handle the reset.
 *
 * Each block is split across the price bands in proportion to the time it
 * covers, so a block straddling a band boundary (or spanning a collector
 * outage) is priced sensibly instead of being dumped entirely into one rate.
 * Bands and rates come from whatever plan was in force on that day.
 */
export function computeCost(readings: Reading[], at: TariffAt): CostBreakdown {
  const byDate = new Map<string, Reading[]>();
  for (const r of readings) {
    const arr = byDate.get(r.local_date);
    if (arr) arr.push(r);
    else byDate.set(r.local_date, [r]);
  }

  let peakKwh = 0;
  let shoulderKwh = 0;
  let offPeakKwh = 0;
  let peakCost = 0;
  let shoulderCost = 0;
  let offPeakCost = 0;
  let importKwh = 0;
  let exportKwh = 0;
  let exportCredit = 0;
  let supply = 0;
  let hasGaps = false;

  for (const [date, rows] of byDate) {
    const t = at(date);
    supply += t.supplyPerDay;

    /** Bucket one block of import into the bands the window covers. */
    const price = (deltaKwh: number, fromMin: number, toMin: number) => {
      const f = bandFractions(fromMin, toMin, t);
      peakKwh += deltaKwh * f.peak;
      shoulderKwh += deltaKwh * f.shoulder;
      offPeakKwh += deltaKwh * f.offPeak;
      peakCost += deltaKwh * f.peak * t.peakRate;
      shoulderCost += deltaKwh * f.shoulder * t.shoulderRate;
      offPeakCost += deltaKwh * f.offPeak * t.offPeakRate;
      importKwh += deltaKwh;
    };

    const impAll = rows
      .filter((r) => r.grid_import_kwh_today != null)
      .sort((a, b) => a.ts - b.ts);

    // Anker resets its daily counters a little AFTER local midnight, so the
    // first readings of a date still carry the previous day's totals. Left in,
    // that leading value gets billed as the midnight-to-first-reading block and
    // then the day's real consumption is added on top of it: 2026-08-01
    // reconstructed 142.16 kWh against a true 61.72, very nearly doubling the
    // day's cost. Start from the last reset instead — a drop to under half the
    // previous value, which a monotonic within-day counter can't otherwise do.
    let startIdx = 0;
    for (let i = 1; i < impAll.length; i++) {
      const prev = impAll[i - 1].grid_import_kwh_today ?? 0;
      const cur = impAll[i].grid_import_kwh_today ?? 0;
      if (prev > 0 && cur < prev * 0.5) startIdx = i;
    }
    const imp = impAll.slice(startIdx);
    const dayRows = startIdx > 0 ? rows.filter((r) => r.ts >= imp[0].ts) : rows;

    if (imp.length > 0) {
      // midnight -> first reading of the day
      const first = imp[0];
      const firstKwh = first.grid_import_kwh_today ?? 0;
      const firstMin = minutesOfDay(first.local_time);
      if (firstKwh > 0) {
        price(firstKwh, 0, firstMin);
        if (firstMin > 20) hasGaps = true;
      }
      // deltas between consecutive readings
      for (let i = 1; i < imp.length; i++) {
        const delta = Math.max(
          0,
          (imp[i].grid_import_kwh_today ?? 0) - (imp[i - 1].grid_import_kwh_today ?? 0),
        );
        const a = minutesOfDay(imp[i - 1].local_time);
        const b = minutesOfDay(imp[i].local_time);
        if (b - a > 20) hasGaps = true;
        if (delta === 0) continue;
        price(delta, a, b);
      }
    }

    // Export is read off the day's highest cumulative value, so it needs no gap
    // handling — but it must skip the same pre-reset carryover rows, or a day
    // that exported less than the day before inherits the larger figure.
    let maxExp = 0;
    for (const r of dayRows) maxExp = Math.max(maxExp, r.grid_export_kwh_today ?? 0);
    exportKwh += maxExp;
    exportCredit += maxExp * t.feedIn;
  }

  const importCost = peakCost + shoulderCost + offPeakCost;
  return {
    importCost,
    exportCredit,
    supply,
    net: importCost + supply - exportCredit,
    peakKwh,
    shoulderKwh,
    offPeakKwh,
    peakCost,
    shoulderCost,
    offPeakCost,
    importKwh,
    exportKwh,
    days: byDate.size,
    hasGaps,
  };
}
