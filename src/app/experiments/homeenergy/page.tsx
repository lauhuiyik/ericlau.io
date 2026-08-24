import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  type DailyTotal,
  type DateRange,
  computeCost,
  computeBillSplit,
  currentBillingCycle,
  type BillSplit,
  chargedKwhFromSamples,
  getChargeSessionsForDate,
  getTeslaStateForDate,
  getTeslaStateInRange,
  getLatestTeslaState,
  getDailyTotals,
  getMeterDailyTotals,
  getHomeChargeKwhByDate,
  getLatest,
  getReadingsForDate,
  getReadingsInRange,
  getSourceFreshness,
  getTariff,
  type Tariff,
  isFutureLocalDate,
  melbNow,
  rangeWindow,
  type SourceFreshness,
} from "@/lib/energy";
import { AutoRefresh } from "./auto-refresh";
import { FlowDiagram } from "./flow-diagram";
import { getWeatherNow, checkSolarAgainstSky } from "@/lib/weather";
import { RangePicker } from "./range-picker";
import { GridRelianceChartRange, LiveChartDay, PowerChartRange } from "./charts";
import { C } from "@/lib/colors";

export const dynamic = "force-dynamic";

/** Fill in any dates in [start,end] that have home-charging energy but no
 * solar/grid readings yet — getDailyTotals only returns dates with readings,
 * so a charging-only day (before the collector started) would otherwise
 * vanish from the range charts entirely. */
function mergeChargeOnlyDates(
  daily: DailyTotal[],
  chargeByDate: { date: string; kwh: number }[],
): DailyTotal[] {
  const known = new Map(daily.map((d) => [d.date, d]));
  for (const c of chargeByDate) {
    if (!known.has(c.date)) {
      known.set(c.date, {
        date: c.date,
        generatedKwh: 0,
        consumedKwh: 0,
        gridImportKwh: 0,
        gridExportKwh: 0,
        selfKwh: 0,
        homeChargeKwh: c.kwh,
      });
    }
  }
  return [...known.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const kw = (n: number | null | undefined) =>
  n == null ? "—" : (Math.abs(n) < 0.05 ? 0 : n).toFixed(1);
const kwh = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1));
const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);

function CostLine({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted flex items-center gap-2">
        {color && <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
        {label}
      </span>
      <span className="text-foreground/90 shrink-0">{value}</span>
    </div>
  );
}

/** "just now" / "12m ago" / "2h ago" / "yesterday 18:40" relative to nowTs. */
function timeAgoLabel(seen: SourceFreshness | null, today: string, nowTs: number): string {
  if (!seen) return "never reported";
  const diffMin = Math.max(0, Math.floor((nowTs - seen.ts) / 60));
  if (seen.date !== today) return `${seen.date} ${seen.time}`;
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `${h}h${m ? ` ${m}m` : ""} ago · ${seen.time}`;
}

/** One solar array, as a self-contained box with its own live output. */
function ArrayBox({
  name,
  hardware,
  rated,
  liveKw,
  todayKwh,
  ratedKw,
  extra,
  offline = false,
  lastSeen,
  today,
  nowTs,
}: {
  name: string;
  hardware: string;
  rated: string;
  liveKw: number | null;
  todayKwh: number | null;
  ratedKw: number;
  extra?: string;
  offline?: boolean;
  lastSeen: SourceFreshness | null;
  today: string;
  nowTs: number;
}) {
  const utilisation =
    liveKw != null && ratedKw > 0 ? Math.min(100, Math.max(0, (liveKw / ratedKw) * 100)) : 0;
  const staleMin = lastSeen ? Math.floor((nowTs - lastSeen.ts) / 60) : Infinity;
  // A gap of more than ~20 min during genuine daylight is worth flagging red;
  // otherwise (overnight, or just a normal ~5 min polling lag) it's neutral —
  // this array simply isn't generating right now, not necessarily broken.
  const staleWarn = offline && staleMin > 20;

  return (
    <div className="border border-rule p-6 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/80">
          {name}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{rated}</div>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span
          className="text-5xl sm:text-6xl font-semibold tracking-[-0.02em]"
          style={{ color: offline ? undefined : C.solar }}
        >
          {offline ? "—" : kw(liveKw)}
        </span>
        <span className="text-sm text-muted">kW now</span>
      </div>

      {/* share of this array's rated capacity currently being produced */}
      <div className="h-1 w-full bg-rule overflow-hidden">
        <div className="h-full" style={{ width: `${utilisation}%`, background: C.solar }} />
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <div className="text-muted">{hardware}</div>
        <div className="text-muted">
          {kwh(todayKwh)} kWh today{extra ? ` · ${extra}` : ""}
        </div>
        <div style={{ color: staleWarn ? C.warn : undefined }} className={staleWarn ? "" : "text-muted"}>
          Last reported: {timeAgoLabel(lastSeen, today, nowTs)}
        </div>
      </div>
    </div>
  );
}

/** One term in the energy-balance strip: a live kW figure, the running total
 * for the period beneath it, and an optional breakdown line. */
function BalanceTerm({
  label,
  nowKw,
  todayKwh,
  detail,
  color,
}: {
  label: string;
  nowKw: number | null;
  todayKwh: number | null;
  detail?: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-[7.5rem]">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-[-0.02em]" style={{ color }}>
          {kw(nowKw)}
        </span>
        <span className="text-xs text-muted">kW</span>
      </div>
      <div className="font-mono text-[11px] text-muted">{kwh(todayKwh)} kWh</div>
      {detail && <div className="font-mono text-[10px] text-muted/80 leading-relaxed">{detail}</div>}
    </div>
  );
}

/** The +, −, = glyphs separating balance terms. */
function Op({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-2xl text-muted/50 font-light select-none pt-5 shrink-0">{children}</div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1.5 py-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">{label}</div>
      <div className="text-2xl font-medium tracking-[-0.01em]">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** "This billing period" — the rehauled billing view. Cycle-based (18th→17th),
 * grounded in the meter, with the car split out as the bill-payer's own so the
 * rest divides among housemates. */
function BillingCard({ bill, tariff }: { bill: BillSplit; tariff: Tariff }) {
  const b = bill;
  if (b.daysCovered === 0) {
    return (
      <p className="text-sm text-muted max-w-2xl">
        No meter reads for this cycle yet ({b.cycle.start} → {b.cycle.end}). Powercor lands about a
        day behind, so the first figures appear tomorrow.
      </p>
    );
  }
  const pctThrough = Math.round((b.daysCovered / b.cycle.lengthDays) * 100);
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col sm:flex-row sm:items-end gap-8 sm:gap-14">
        <div className="flex flex-col gap-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            Projected bill
          </div>
          <div className="text-5xl sm:text-6xl font-semibold tracking-[-0.02em]">
            {money(b.projectedNet)}
          </div>
          <div className="text-sm text-muted">whole cycle · {b.cycle.start} → {b.cycle.end}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            Cost so far
          </div>
          <div className="text-3xl font-semibold tracking-[-0.01em]">{money(b.soFar.net)}</div>
          <div className="text-sm text-muted">
            {b.daysCovered} of {b.cycle.lengthDays} days metered · {pctThrough}%
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-x-14 gap-y-8">
        <div className="flex flex-col gap-2 font-mono text-[11px] sm:text-xs">
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted">
            Cost so far, itemised
          </div>
          <CostLine
            label={`Peak · ${kwh(b.soFar.peakKwh)} kWh @ $${tariff.peakRate.toFixed(3)}`}
            value={money(b.soFar.peakKwh * tariff.peakRate)}
            color={C.grid}
          />
          <CostLine
            label={`Off-peak · ${kwh(b.soFar.offPeakKwh)} kWh @ $${tariff.offPeakRate.toFixed(5)}`}
            value={money(b.soFar.offPeakKwh * tariff.offPeakRate)}
            color={C.grid}
          />
          <CostLine label={`Supply · ${b.soFar.days} days`} value={money(b.soFar.supply)} />
          <CostLine
            label={`Export credit · ${kwh(b.soFar.exportKwh)} kWh`}
            value={`−${money(b.soFar.exportCredit)}`}
            color={C.export}
          />
          <div className="mt-1 flex justify-between border-t border-rule pt-2">
            <span className="uppercase tracking-[0.18em] text-muted">Net so far</span>
            <span className="text-foreground">{money(b.soFar.net)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 font-mono text-[11px] sm:text-xs">
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted">
            Your share · projected
          </div>
          <CostLine
            label={`Tesla — yours · ${kwh(b.tesla.kwh)} kWh charged`}
            value={money(b.tesla.projectedGridCost)}
            color={C.charge}
          />
          <CostLine label="House — shared" value={money(b.houseProjected)} color={C.house} />
          <CostLine label={`÷ ${b.housemates} housemates`} value={money(b.perHousemate)} />
          <div className="mt-1 flex justify-between border-t border-rule pt-2">
            <span className="uppercase tracking-[0.18em] text-muted">You pay</span>
            <span className="text-base text-foreground">{money(b.yourShare)}</span>
          </div>
          <p className="mt-1 text-[10px] normal-case leading-relaxed tracking-normal text-muted/80">
            Your car&apos;s grid charging is yours alone; the rest splits {b.housemates} ways.{" "}
            {kwh(b.tesla.freeKwh)} kWh of charging came free from solar / battery.
          </p>
        </div>
      </div>

      <p className="max-w-3xl text-xs text-muted">
        Projected linearly from {b.daysCovered} day{b.daysCovered === 1 ? "" : "s"} of billing-grade
        meter data (to {b.lastMeterDate}) across the {b.cycle.lengthDays}-day cycle — it tightens as
        the month fills in. The car&apos;s grid share is attributed from the house meter over each
        charging window
        {b.tesla.measured
          ? ""
          : " (no overlapping readings, so counted as grid — the cautious assumption)"}
        .
      </p>
    </div>
  );
}

/** The physical system, from the signed Bascon proposals and the Clean Energy
 * Regulator panel-validation certificate. Static facts, not telemetry. */
const SYSTEM = {
  arrays: [
    {
      name: "Original array",
      dc: "6.6 kW",
      panels: "20 × 330 W Jinko Cheetah",
      inverter: "Growatt 5000TL3-S · 5 kW",
      year: "2021",
    },
    {
      name: "New array",
      dc: "6.16 kW",
      panels: "14 × 440 W DAS Solar",
      inverter: "Anker SOLIX X1 · 5 kW hybrid",
      year: "2025",
    },
  ],
  totalDc: "12.76 kW",
  battery: "10 kWh usable · 2 × Anker X1-B5-H LFP",
  inverterAc: "10 kW AC · 3-phase",
  evCharger: "22 kW · 3-phase",
  exportLimit: "5 kW",
  grid: "Powercor · 3-phase",
} as const;

function SpecRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted/70">{label}</div>
      <div className="text-sm text-foreground/90">{value}</div>
      {sub && <div className="font-mono text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

const VALID_RANGES: DateRange[] = ["day", "week", "month"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; date?: string }>;
}) {
  const { env } = await getCloudflareContext({ async: true });
  const { date: today, time: nowTime } = melbNow();
  // force-dynamic server component: this runs once per request (not a
  // re-rendering client component), so a per-request timestamp is correct
  // here, not the "impure component" case the purity lint is guarding against.
  // eslint-disable-next-line react-hooks/purity
  const nowTs = Math.floor(Date.now() / 1000);
  const sp = await searchParams;

  const range: DateRange = VALID_RANGES.includes(sp.range as DateRange)
    ? (sp.range as DateRange)
    : "day";
  let date = sp.date && DATE_RE.test(sp.date) ? sp.date : today;
  if (isFutureLocalDate(date, today)) date = today;

  const isLiveToday = range === "day" && date === today;
  const win = rangeWindow(range, date);

  const latestGlobal = await getLatest(env.DB);
  // Not date-scoped: the balance strip always describes right now, whichever day
  // is being browsed.
  const latestTesla = await getLatestTeslaState(env.DB);
  // Independent physical reference. Every other check on this page compares our
  // own derived numbers with each other, which is how a stuck 4.5 kW reading
  // survived a full arithmetic audit and was only caught by someone noticing
  // solar after dark. Sunlight is the one input our code can't fake.
  // The live flow, balance and array boxes always describe "right now" and no
  // longer hide when the range picker (which only scopes the chart + stats
  // below) is on week/month — so this "now" data is always fetched.
  const weather = await getWeatherNow();
  const freshness = await getSourceFreshness(env.DB);
  const tariff = await getTariff(env.ENERGY_KV);

  const daySeries = range === "day" ? await getReadingsForDate(env.DB, date) : [];
  const sessions = range === "day" ? await getChargeSessionsForDate(env.DB, date) : [];
  // Live Fleet API samples are the real source for any day it was connected;
  // `sessions` (the Tessie CSV import) only covers history to 2026-07-10.
  const teslaSamples = range === "day" ? await getTeslaStateForDate(env.DB, date) : [];
  // Fetched for every range, including a single day. The day view used to read
  // its totals off one row's stored counters, which breaks in two ways: that
  // row may have missed the Growatt merge (excluding array #1 from consumption
  // entirely), and a failed Anker fetch used to store a literal 0. Deriving the
  // day's totals the same way as a week's keeps one code path and one answer.
  const dailyRaw = await getDailyTotals(env.DB, win.start, win.end);
  const chargeByDate = await getHomeChargeKwhByDate(env.DB, win.start, win.end);
  const daily = mergeChargeOnlyDates(dailyRaw, chargeByDate);
  const costSeries =
    range === "day" ? daySeries : await getReadingsInRange(env.DB, win.start, win.end);

  // The page now always leads with the live "now" view, so having any latest
  // reading is enough to render; the chart and stats below handle their own
  // empty range inline.
  const hasData = latestGlobal != null;
  const hasRangeData =
    range === "day" ? daySeries.length > 0 || sessions.length > 0 : daily.length > 0;

  const consumed = daily.reduce((s, d) => s + d.consumedKwh, 0);
  const imported = daily.reduce((s, d) => s + d.gridImportKwh, 0);
  // Live Fleet API samples are authoritative. The Tessie CSV import is
  // reference-only history (to 2026-07-10) and is used solely for dates the
  // Fleet API never covered — never combined with live data.
  const liveChargedKwh = chargedKwhFromSamples(teslaSamples);
  const homeChargeKwh =
    range === "day"
      ? teslaSamples.length > 0
        ? liveChargedKwh
        : sessions.reduce((s, c) => s + (c.energy_added_kwh ?? 0), 0)
      : daily.reduce((s, d) => s + d.homeChargeKwh, 0);

  // ---- Energy balance ------------------------------------------------------
  // What the property USES has to equal what SUPPLIES it:
  //     home(excl. car) + car  =  solar + battery + grid
  // Battery and grid are signed: battery is positive while discharging to the
  // house and negative while charging; grid is positive while importing and
  // negative while exporting. Both sides balance exactly, which is the point
  // of showing them side by side.
  //
  // Note this is NOT "home + car − solar − battery + grid" — that mixes demand
  // and supply on one side and double-counts (it returned 6.98 kW against an
  // actual 3.49 kW draw when checked against live data).
  // Live charge power, from the Fleet API's newest sample. Only counted while the
  // car is actually drawing at home: a parked car still reports its last
  // session's power, which would show phantom load.
  const teslaReportedKw =
    latestTesla && latestTesla.charging_state === "Charging" && latestTesla.at_home !== 0
      ? (latestTesla.charge_power_kw ?? 0)
      : 0;

  // Cross-check against the house meter, which is ~1 min fresh where Tesla is up
  // to ~5 min behind. Anker meters the whole house INCLUDING the car, so the car
  // physically cannot be drawing more than the house total. Without this clamp,
  // stopping a charge left the car showing 11 kW while the house read 2.1 kW —
  // an impossible state, and the reason the page looked stuck mid-charge.
  //
  // Clamping rather than zeroing keeps a genuine charge visible: mid-charge the
  // house total is at least the car's draw, so the clamp does nothing.
  const liveTeslaKw = Math.min(teslaReportedKw, Math.max(0, latestGlobal?.house_kw ?? 0));
  const balNow = {
    homeExclTesla: Math.max(0, (latestGlobal?.house_kw ?? 0) - liveTeslaKw),
    tesla: liveTeslaKw,
    solar: latestGlobal?.solar_total_kw ?? 0,
    battery: (latestGlobal?.battery_discharge_kw ?? 0) - (latestGlobal?.battery_charge_kw ?? 0),
    grid: (latestGlobal?.grid_import_kw ?? 0) - (latestGlobal?.grid_export_kw ?? 0),
  };

  const cost = computeCost(costSeries, tariff);

  // The balance strip is always "right now + today", independent of the
  // range picker below (which only scopes the chart and the stats under it).
  const todayReadings = await getReadingsForDate(env.DB, today);
  const todayTeslaSamples = await getTeslaStateForDate(env.DB, today);
  const todayDaily = (await getDailyTotals(env.DB, today, today))[0] ?? null;
  const todayCost = computeCost(todayReadings, tariff);
  const todayGenerated = todayDaily?.generatedKwh ?? 0;
  const todayConsumed = todayDaily?.consumedKwh ?? 0;
  const todayCharge = chargedKwhFromSamples(todayTeslaSamples);
  const todayFlowRow =
    [...todayReadings].reverse().find((r) => r.home_usage_kwh_today != null) ?? null;
  const todayFlow = todayFlowRow
    ? {
        solarToBattery: todayFlowRow.solar_to_battery_kwh_today ?? 0,
      }
    : null;

  // "This billing period" — always the current Lumo cycle (18th→17th), grounded
  // in the meter, with the car's grid cost split out as the bill-payer's own.
  const HOUSEMATES = 4;
  const cycle = currentBillingCycle(today);
  const meterDaily = await getMeterDailyTotals(env.DB, cycle.start, today, tariff);
  const billLastDate = meterDaily.length ? meterDaily[meterDaily.length - 1].date : today;
  const cycleReadings = await getReadingsInRange(env.DB, cycle.start, billLastDate);
  const cycleTeslaSamples = await getTeslaStateInRange(env.DB, cycle.start, billLastDate);
  const bill = computeBillSplit(today, meterDaily, cycleReadings, cycleTeslaSamples, tariff, HOUSEMATES);

  const gridShare = consumed > 0 ? Math.min(100, (imported / consumed) * 100) : null;

  let busiest: { kw: number; time: string; date?: string } | null = null;
  for (const r of costSeries) {
    if (r.house_kw != null && (busiest === null || r.house_kw > busiest.kw)) {
      busiest = { kw: r.house_kw, time: r.local_time, date: r.local_date };
    }
  }

  const rangeLabel =
    range === "day" ? (date === today ? "Today" : date) : `${win.start} → ${win.end}`;

  // 12.76 kW across both arrays. Compared against what the current sky can
  // physically support, not against our own other figures.
  const sky = checkSolarAgainstSky(latestGlobal?.solar_total_kw ?? null, 12.76, weather);

  // A missing inverter is surfaced per-array in the solar boxes below (each
  // shows its own "last reported" time), rather than as a page-level banner —
  // Growatt reporting nothing after dark is routine, not an alert.

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-6 sm:px-12">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          ← Eric Lau
        </Link>
        <div className="flex items-center gap-6 font-mono text-xs uppercase tracking-[0.18em] text-muted">
          {isLiveToday && <AutoRefresh seconds={10} currentTs={latestGlobal?.ts ?? null} />}
          <Link href="/experiments/homeenergy/settings" className="hover:text-foreground transition-colors">
            Settings
          </Link>
          <span className="hidden sm:inline">Home Energy</span>
        </div>
      </header>

      <section className="px-6 sm:px-12 pt-12 sm:pt-16 pb-8 max-w-5xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">
          Logs · {isLiveToday ? "Live" : rangeLabel}
        </div>
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-[-0.03em] leading-[0.9]">
          Home Energy
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted leading-relaxed">
          {SYSTEM.totalDc} of solar across two arrays, feeding a 10 kWh battery and a 22 kW car
          charger.
        </p>

        {/* Full spec tucked behind a disclosure — reference detail, not
            something worth looking at every visit. Native <details> so this
            stays a server component with no client JS. */}
        <details className="group mt-6 max-w-3xl">
          <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors inline-flex items-center gap-2">
            <span className="transition-transform group-open:rotate-90">›</span>
            System spec
          </summary>
          <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-5">
            {SYSTEM.arrays.map((a) => (
              <SpecRow
                key={a.name}
                label={`${a.name} · ${a.year}`}
                value={`${a.dc} · ${a.panels}`}
                sub={a.inverter}
              />
            ))}
            <SpecRow label="Battery" value={SYSTEM.battery} sub="charges from solar first" />
            <SpecRow label="Inverters" value={SYSTEM.inverterAc} sub={`export limit ${SYSTEM.exportLimit}`} />
            <SpecRow label="EV charger" value={SYSTEM.evCharger} sub="Tesla, charged at home" />
            <SpecRow label="Grid" value={SYSTEM.grid} sub="Lumo · time-of-use" />
          </div>
        </details>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          {hasData ? (
            <>
              Updated {latestGlobal!.local_time} · sources {latestGlobal!.sources || "—"} · now {nowTime}
            </>
          ) : (
            <>Waiting for the first reading… · now {nowTime}</>
          )}
        </p>
      </section>

      {!hasData ? (
        <section className="px-6 sm:px-12 py-16 border-t border-rule">
          <p className="text-muted">
            No readings for this {range === "day" ? "day" : range} yet.
          </p>
        </section>
      ) : (
        <>
          {sky && (
            <section className="px-6 sm:px-12 pt-2 pb-4">
              <div
                className="border-l-2 pl-4 py-1"
                style={{
                  borderColor:
                    sky.level === "bad" ? C.warn : sky.level === "warn" ? C.solar : C.self,
                }}
              >
                <div
                  className="font-mono text-[10px] uppercase tracking-[0.22em] mb-1"
                  style={{
                    color: sky.level === "bad" ? C.warn : sky.level === "warn" ? C.solar : C.self,
                  }}
                >
                  Sky check · {sky.headline}
                </div>
                <p className="text-xs text-muted max-w-3xl">{sky.detail}</p>
              </div>
            </section>
          )}

          {/* Live flow first: the at-a-glance "where is power moving" view.
              Always "right now", never scoped by the range picker below. */}
          {latestGlobal && (
            <section className="px-6 sm:px-12 pb-4">
              <div className="flex items-baseline justify-between gap-4 mb-2 flex-wrap">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                  Live flow · now · pulses show direction, speed shows power
                </div>
              </div>
              <div className="max-w-5xl">
                <FlowDiagram
                  solarNewKw={latestGlobal.solar_new_kw}
                  solarOldKw={latestGlobal.solar_old_kw}
                  batteryKw={balNow.battery}
                  batterySoc={latestGlobal.battery_soc}
                  gridKw={balNow.grid}
                  houseKw={latestGlobal.house_kw ?? 0}
                  teslaKw={liveTeslaKw}
                  teslaState={latestTesla?.charging_state ?? null}
                />
              </div>
            </section>
          )}

          {/* The balance: what's being used, and what's supplying it. Always the
              live "now + today" view — the range picker below does not touch it. */}
          <section className="px-6 sm:px-12 pb-10">
            <div className="flex items-baseline justify-between gap-4 mb-8 flex-wrap">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                Where your power is going · now
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                big number = right now · small = today so far
              </div>
            </div>

            <div className="flex flex-wrap items-start gap-x-2 gap-y-8">
              <BalanceTerm
                label="Home"
                nowKw={balNow.homeExclTesla}
                todayKwh={Math.max(0, todayConsumed - todayCharge)}
                detail="excludes the car"
                color={C.house}
              />
              <div className="flex items-start gap-2">
                <Op>+</Op>
                <BalanceTerm
                  label="Tesla"
                  nowKw={balNow.tesla}
                  todayKwh={todayCharge}
                  detail="charged at home"
                  color={C.charge}
                />
              </div>
              <div className="flex items-start gap-2">
                <Op>=</Op>
                <BalanceTerm
                  label="Solar"
                  nowKw={balNow.solar}
                  todayKwh={todayGenerated}
                  detail={
                    latestGlobal
                      ? `new ${kw(latestGlobal.solar_new_kw)} + old ${kw(latestGlobal.solar_old_kw)}`
                      : undefined
                  }
                  color={C.solar}
                />
              </div>
              <div className="flex items-start gap-2">
                <Op>+</Op>
                <BalanceTerm
                  label="Battery"
                  nowKw={balNow.battery}
                  todayKwh={
                    (latestGlobal?.battery_discharge_kwh_today ?? 0) -
                    (latestGlobal?.battery_charge_kwh_today ?? 0)
                  }
                  detail={[
                    latestGlobal?.battery_soc != null ? `${Math.round(latestGlobal.battery_soc)}% charged` : null,
                    todayFlow
                      ? `${todayFlow.solarToBattery.toFixed(1)} solar / ${Math.max(
                          0,
                          (latestGlobal?.battery_charge_kwh_today ?? 0) - todayFlow.solarToBattery,
                        ).toFixed(1)} grid in`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  color={C.battery}
                />
              </div>
              <div className="flex items-start gap-2">
                <Op>+</Op>
                <BalanceTerm
                  label="Grid"
                  nowKw={balNow.grid}
                  todayKwh={todayCost.importKwh - todayCost.exportKwh}
                  detail={`peak ${kwh(todayCost.peakKwh)} ${money(
                    todayCost.peakKwh * tariff.peakRate,
                  )} · off-pk ${kwh(todayCost.offPeakKwh)} ${money(todayCost.offPeakKwh * tariff.offPeakRate)}`}
                  color={balNow.grid < 0 ? C.export : C.grid}
                />
              </div>
            </div>

            <p className="mt-8 text-xs text-muted max-w-3xl">
              Read it left to right: what the house and car are using has to come from somewhere —
              solar first, then the battery, and the grid covers whatever is left. Battery and grid
              go <span className="text-foreground">negative</span>{" "}
              when they&apos;re absorbing rather than supplying (battery charging, solar
              exporting), so both sides always balance. Tesla figures are live from the Fleet API,
              sampled every 5 minutes; the car stops reporting while asleep, so its power reads zero
              rather than stale.
            </p>
          </section>

          {/* Billing: the current Lumo cycle (18th→17th), split for housemates.
              Cycle-based, so it ignores the range picker too. */}
          <section className="border-t border-rule px-6 sm:px-12 py-10">
            <div className="flex items-baseline justify-between gap-4 mb-8 flex-wrap">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                This billing period · Lumo cycle
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                projected · actual so far · your share
              </div>
            </div>
            <BillingCard bill={bill} tariff={tariff} />
          </section>

          {/* Range picker scopes everything BELOW it — the chart and stats. */}
          <section className="border-t border-rule px-6 sm:px-12 pt-8 pb-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-4">
              History · pick a timescale for the chart and stats below
            </div>
            <RangePicker range={range} date={date} today={today} />
          </section>

          {!hasRangeData ? (
            <section className="px-6 sm:px-12 py-16">
              <p className="text-muted">No readings for this {range === "day" ? "day" : range} yet.</p>
            </section>
          ) : (
          <>
          {/* One merged chart: Tesla, grid (signed), and home load excl. car */}
          <section className="px-6 sm:px-12 py-10">
            <div className="flex items-center gap-x-6 gap-y-2 mb-6 font-mono text-[10px] uppercase tracking-[0.22em] text-muted flex-wrap">
              {range === "day" ? (
                <>
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-0.5" style={{ background: C.charge }} /> Tesla charging
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-0.5" style={{ background: C.grid }} /> Grid draw
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-0.5" style={{ background: C.export }} /> Exporting (below 0)
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-0.5" style={{ background: C.house }} /> Home excl. car
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-0.5" style={{ background: C.battery }} /> Battery
                    (− = charging)
                  </span>
                  <span className="flex items-center gap-2 opacity-70">
                    <span className="inline-block w-3 h-2" style={{ background: C.solar, opacity: 0.4 }} /> Solar
                  </span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-2" style={{ background: C.self }} /> Self · solar+battery
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-2" style={{ background: C.grid }} /> Grid
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-0.5" style={{ background: C.charge }} /> Tesla charging
                  </span>
                </>
              )}
              <span className="ml-auto normal-case tracking-normal text-muted">
                {range === "day" ? `${rangeLabel} · kW` : `${rangeLabel} · kWh/day`}
              </span>
            </div>
            {range === "day" ? (
              <LiveChartDay
                series={daySeries}
                tariff={tariff}
                sessions={sessions}
                teslaSamples={teslaSamples}
              />
            ) : (
              <GridRelianceChartRange daily={daily} />
            )}
            {range === "day" && sessions.length === 0 && teslaSamples.length === 0 && (
              <p className="mt-4 text-xs text-muted max-w-2xl">
                No Tesla charging recorded for this day, so the red line sits at zero.
              </p>
            )}
            {range !== "day" && (
              <div className="mt-6">
                <PowerChartRange daily={daily} />
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 mt-8">
              <Stat label="Grid-powered" value={pct(gridShare)} sub="of consumption" />
              <Stat label="Peak-window grid" value={kwh(cost.peakKwh)} sub={`kWh @ $${tariff.peakRate.toFixed(3)}`} />
              <Stat
                label="Busiest moment"
                value={busiest ? `${kw(busiest.kw)} kW` : "—"}
                sub={busiest ? (range === "day" ? `at ${busiest.time}` : `${busiest.date} ${busiest.time}`) : undefined}
              />
              <Stat label="Tesla charged" value={`${kwh(homeChargeKwh)} kWh`} sub="at home, this period" />
            </div>
          </section>

          </>
          )}

          {/* Two solar arrays, side by side, each with its own live output */}
          {latestGlobal && (
            <section className="border-t border-rule px-6 sm:px-12 py-10">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">
                Solar arrays · generating right now
              </div>
              <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
                <ArrayBox
                  name="New array"
                  hardware="Anker SOLIX X1"
                  rated="6.16 kW"
                  liveKw={latestGlobal.solar_new_kw}
                  todayKwh={latestGlobal.solar_new_kwh_today}
                  ratedKw={6.16}
                  extra={`Battery ${pct(latestGlobal.battery_soc)}`}
                  offline={latestGlobal.solar_new_kw == null}
                  lastSeen={freshness?.anker ?? null}
                  today={today}
                  nowTs={nowTs}
                />
                <ArrayBox
                  name="Original array"
                  hardware="Growatt 5000TL3-S"
                  rated="6.6 kW"
                  liveKw={latestGlobal.solar_old_kw}
                  todayKwh={latestGlobal.solar_old_kwh_today}
                  ratedKw={6.6}
                  offline={latestGlobal.solar_old_kw == null}
                  lastSeen={freshness?.growatt ?? null}
                  today={today}
                  nowTs={nowTs}
                />
              </div>
            </section>
          )}
        </>
      )}

      <footer className="border-t border-rule px-6 sm:px-12 py-8 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        <Link href="/experiments" className="hover:text-foreground transition-colors">
          ← Experiments
        </Link>
      </footer>
    </div>
  );
}
