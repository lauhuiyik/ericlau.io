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

/** Melbourne local {date, time} for a unix-seconds timestamp. */
export function melbFromTs(ts: number): { date: string; time: string } {
  return melbNow(new Date(ts * 1000));
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
  offPeakKwh: number;
  /** Portion the grid actually supplied, apportioned from the meter. */
  gridKwh: number;
  /** Grid-supplied portion split by tariff window. These two are what you
   *  actually pay for, and their costs sum to `gridCost` exactly. */
  gridPeakKwh: number;
  gridOffPeakKwh: number;
  gridPeakCost: number;
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
  t: Tariff,
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
  let offPeakKwh = 0;
  let gridPeakKwh = 0;
  let gridOffPeakKwh = 0;
  let anyOverlap = false;

  for (const d of deltas) {
    const to = Math.max(d.toMin, d.fromMin + 1);
    const frac = peakFraction(d.fromMin, to, t);

    kwh += d.kwh;
    peakKwh += d.kwh * frac;
    offPeakKwh += d.kwh * (1 - frac);

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
    gridPeakKwh += d.kwh * gridShare * frac;
    gridOffPeakKwh += d.kwh * gridShare * (1 - frac);
  }

  // Costs are derived from the kWh buckets rather than accumulated separately,
  // so the peak and off-peak lines always add up to the total exactly.
  const gridPeakCost = gridPeakKwh * t.peakRate;
  const gridOffPeakCost = gridOffPeakKwh * t.offPeakRate;
  const gridCost = gridPeakCost + gridOffPeakCost;
  const fullGridCost = peakKwh * t.peakRate + offPeakKwh * t.offPeakRate;
  const gridKwh = gridPeakKwh + gridOffPeakKwh;

  return {
    kwh,
    peakKwh,
    offPeakKwh,
    gridKwh,
    gridPeakKwh,
    gridOffPeakKwh,
    gridPeakCost,
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

/** Fraction of the window [startMin,endMin) that falls inside the peak price
 * window. Used to apportion a block of grid import across peak/off-peak when
 * the block spans a tariff boundary (or a gap in readings). */
function peakFraction(startMin: number, endMin: number, t: Tariff): number {
  const total = endMin - startMin;
  if (total <= 0) return isPeak(minToTimeString(startMin), t) ? 1 : 0;
  const bands: [number, number][] =
    t.peakStartHour <= t.peakEndHour
      ? [[t.peakStartHour * 60, t.peakEndHour * 60]]
      : [
          [t.peakStartHour * 60, 1440],
          [0, t.peakEndHour * 60],
        ];
  let peak = 0;
  for (const [bs, be] of bands) {
    const lo = Math.max(startMin, bs);
    const hi = Math.min(endMin, be);
    if (hi > lo) peak += hi - lo;
  }
  return peak / total;
}

function minToTimeString(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}


export type CostBreakdown = {
  importCost: number;
  exportCredit: number;
  supply: number;
  net: number;
  peakKwh: number;
  offPeakKwh: number;
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
 * Each block is split across peak/off-peak in proportion to the time it
 * covers, so a block straddling 15:00 (or spanning a collector outage) is
 * priced sensibly instead of being dumped entirely into one rate.
 */
export function computeCost(readings: Reading[], t: Tariff): CostBreakdown {
  const byDate = new Map<string, Reading[]>();
  for (const r of readings) {
    const arr = byDate.get(r.local_date);
    if (arr) arr.push(r);
    else byDate.set(r.local_date, [r]);
  }

  let peakKwh = 0;
  let offPeakKwh = 0;
  let importKwh = 0;
  let exportKwh = 0;
  let hasGaps = false;

  for (const rows of byDate.values()) {
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
        const frac = peakFraction(0, firstMin, t);
        peakKwh += firstKwh * frac;
        offPeakKwh += firstKwh * (1 - frac);
        importKwh += firstKwh;
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
        const frac = peakFraction(a, b, t);
        peakKwh += delta * frac;
        offPeakKwh += delta * (1 - frac);
        importKwh += delta;
      }
    }

    // Export is read off the day's highest cumulative value, so it needs no gap
    // handling — but it must skip the same pre-reset carryover rows, or a day
    // that exported less than the day before inherits the larger figure.
    let maxExp = 0;
    for (const r of dayRows) maxExp = Math.max(maxExp, r.grid_export_kwh_today ?? 0);
    exportKwh += maxExp;
  }

  const importCost = peakKwh * t.peakRate + offPeakKwh * t.offPeakRate;
  const exportCredit = exportKwh * t.feedIn;
  const days = byDate.size;
  const supply = t.supplyPerDay * days; // one supply charge PER DAY in range
  return {
    importCost,
    exportCredit,
    supply,
    net: importCost + supply - exportCredit,
    peakKwh,
    offPeakKwh,
    importKwh,
    exportKwh,
    days,
    hasGaps,
  };
}
