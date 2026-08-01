import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  type DailyTotal,
  type DateRange,
  computeCost,
  computeTeslaCost,
  chargedKwhFromSamples,
  getChargeSessionsForDate,
  getTeslaStateForDate,
  getTeslaStateInRange,
  getLatestTeslaState,
  getDailyTotals,
  getHomeChargeKwhByDate,
  getLatest,
  getReadingsForDate,
  getReadingsInRange,
  getSourceFreshness,
  getTariff,
  isFutureLocalDate,
  melbNow,
  rangeWindow,
  type SourceFreshness,
} from "@/lib/energy";
import { AutoRefresh } from "./auto-refresh";
import { FlowDiagram } from "./flow-diagram";
import { RangePicker } from "./range-picker";
import { GridRelianceChartRange, LiveChartDay, PowerChartRange, ShareBar, type ShareSlice } from "./charts";
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

/** Horizontal stacked bar showing how a total splits, with a labelled legend. */
function FlowBar({
  title,
  total,
  parts,
  note,
}: {
  title: string;
  total: number;
  parts: { label: string; value: number; color: string }[];
  note?: string;
}) {
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">{title}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          {total.toFixed(1)} kWh
        </div>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden bg-rule">
        {shown.map((p) => (
          <div
            key={p.label}
            style={{ width: `${total > 0 ? (p.value / total) * 100 : 0}%`, background: p.color }}
            title={`${p.label}: ${p.value.toFixed(1)} kWh`}
          />
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        {shown.map((p) => (
          <div key={p.label} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-muted">
              <span className="inline-block w-2 h-2 shrink-0" style={{ background: p.color }} />
              {p.label}
            </span>
            <span className="text-foreground/90 shrink-0 font-mono text-xs">
              {p.value.toFixed(1)} kWh · {total > 0 ? Math.round((p.value / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
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
  const freshness = isLiveToday ? await getSourceFreshness(env.DB) : null;
  const tariff = await getTariff(env.ENERGY_KV);

  const daySeries = range === "day" ? await getReadingsForDate(env.DB, date) : [];
  const sessions = range === "day" ? await getChargeSessionsForDate(env.DB, date) : [];
  // Live Fleet API samples are the real source for any day it was connected;
  // `sessions` (the Tessie CSV import) only covers history to 2026-07-10.
  const teslaSamples = range === "day" ? await getTeslaStateForDate(env.DB, date) : [];
  // The week and month views need their own samples: without these the car's
  // cost silently vanished from every range except a single day.
  const teslaRangeSamples =
    range === "day" ? teslaSamples : await getTeslaStateInRange(env.DB, win.start, win.end);
  const dailyRaw = range !== "day" ? await getDailyTotals(env.DB, win.start, win.end) : [];
  const chargeByDate = range !== "day" ? await getHomeChargeKwhByDate(env.DB, win.start, win.end) : [];
  const daily = range !== "day" ? mergeChargeOnlyDates(dailyRaw, chargeByDate) : [];
  const costSeries =
    range === "day" ? daySeries : await getReadingsInRange(env.DB, win.start, win.end);

  const hasData = isLiveToday
    ? latestGlobal != null
    : range === "day"
      ? daySeries.length > 0 || sessions.length > 0
      : daily.length > 0;

  // Tile/stat data source: the live snapshot for "today", otherwise the last
  // reading of the selected day, otherwise aggregated range totals.
  const dayLatest = range === "day" ? (isLiveToday ? latestGlobal : daySeries[daySeries.length - 1] ?? null) : null;

  const generated =
    range === "day"
      ? (dayLatest?.solar_new_kwh_today ?? 0) + (dayLatest?.solar_old_kwh_today ?? 0)
      : daily.reduce((s, d) => s + d.generatedKwh, 0);
  const consumed =
    range === "day" ? (dayLatest?.house_kwh_today ?? 0) : daily.reduce((s, d) => s + d.consumedKwh, 0);
  const imported =
    range === "day" ? (dayLatest?.grid_import_kwh_today ?? 0) : daily.reduce((s, d) => s + d.gridImportKwh, 0);
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

  // Anker's own flow accounting for the selected day, taken from the last
  // reading that carries it (these are cumulative-since-midnight totals).
  const flowRow = [...costSeries].reverse().find((r) => r.home_usage_kwh_today != null) ?? null;
  const flow = flowRow
    ? {
        solarToHome: flowRow.solar_to_home_kwh_today ?? 0,
        solarToBattery: flowRow.solar_to_battery_kwh_today ?? 0,
        solarToGrid: flowRow.grid_export_kwh_today ?? 0,
        batteryToHome: flowRow.battery_to_home_kwh_today ?? 0,
        gridToHome: flowRow.grid_to_home_kwh_today ?? 0,
        ankerHome: flowRow.home_usage_kwh_today ?? 0,
        solarTotal: flowRow.solar_new_kwh_today ?? 0,
        growattToday: flowRow.solar_old_kwh_today,
      }
    : null;

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

  // What the car cost. NOT an addition to the bill: the car is part of the house
  // load, so its energy is already inside the metered import that computeCost
  // charges for. This attributes a share of that same cost to the car.
  const teslaCost = computeTeslaCost(costSeries, teslaRangeSamples, sessions, tariff);

  // Round once, then derive the totals from the rounded parts, so the car's
  // peak + off-peak lines visibly add up to its total on screen. Deriving the
  // total from full precision instead leaves a cent unaccounted for ($0.50 +
  // $1.46 displayed against a $1.97 total), which reads like an error.
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const carPeakKwh = r1(teslaCost.gridPeakKwh);
  const carOffPeakKwh = r1(teslaCost.gridOffPeakKwh);
  const carPeakCost = r2(teslaCost.gridPeakCost);
  const carOffPeakCost = r2(teslaCost.gridOffPeakCost);
  const carTotalCost = r2(carPeakCost + carOffPeakCost);
  const carTotalKwh = r1(teslaCost.kwh);
  const carSelfKwh = r1(carTotalKwh - carPeakKwh - carOffPeakKwh);
  const carFullGridCost = r2(teslaCost.fullGridCost);
  const carSaved = r2(carFullGridCost - carTotalCost);

  // Share of what the home actually consumed, grid split by tariff. Anker
  // meters grid_to_home as one figure, so the peak/off-peak split is applied
  // in the same ratio as the day's metered import rather than separately
  // measured — a small part of that import charged the battery, not the house.
  const gridImportTotal = cost.peakKwh + cost.offPeakKwh;
  const gridPeakShare = gridImportTotal > 0 ? cost.peakKwh / gridImportTotal : 0;
  const gridToHome = flow?.gridToHome ?? 0;
  const shareSlices: ShareSlice[] = [
    { label: "Solar", kwh: flow?.solarToHome ?? 0, color: C.solar, note: "straight from the panels" },
    { label: "Battery", kwh: flow?.batteryToHome ?? 0, color: C.battery, note: "stored earlier, mostly from solar" },
    {
      label: "Grid · peak",
      kwh: gridToHome * gridPeakShare,
      color: C.grid,
      note: `${money(tariff.peakRate)}/kWh · ${tariff.peakStartHour}:00–${tariff.peakEndHour}:00`,
    },
    {
      label: "Grid · off-peak",
      kwh: gridToHome * (1 - gridPeakShare),
      color: "#a16207",
      note: `${money(tariff.offPeakRate)}/kWh · all other hours`,
    },
  ];

  // Second bar: where the power WENT, rather than where it came from. Keeping
  // the two dimensions in separate bars matters — putting the car alongside
  // "Solar"/"Grid" would mix destination with source and the percentages would
  // no longer mean anything.
  const destSlices: ShareSlice[] = [
    {
      label: "Home",
      kwh: Math.max(0, consumed - homeChargeKwh),
      color: C.house,
      note: "everything but the car",
    },
    {
      label: "Tesla",
      kwh: homeChargeKwh,
      color: C.charge,
      note:
        teslaCost.kwh > 0
          ? `${money(teslaCost.gridCost)} of grid energy · ${kwh(teslaCost.selfKwh)} kWh free from solar/battery`
          : "no charging this period",
    },
  ];

  const gridShare = consumed > 0 ? Math.min(100, (imported / consumed) * 100) : null;

  let busiest: { kw: number; time: string; date?: string } | null = null;
  for (const r of costSeries) {
    if (r.house_kw != null && (busiest === null || r.house_kw > busiest.kw)) {
      busiest = { kw: r.house_kw, time: r.local_time, date: r.local_date };
    }
  }

  const rangeLabel =
    range === "day" ? (date === today ? "Today" : date) : `${win.start} → ${win.end}`;

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
        {isLiveToday && (
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            {hasData ? (
              <>
                Updated {latestGlobal!.local_time} · sources {latestGlobal!.sources || "—"} · now {nowTime}
              </>
            ) : (
              <>Waiting for the first reading… · now {nowTime}</>
            )}
          </p>
        )}
        <div className="mt-8">
          <RangePicker range={range} date={date} today={today} />
        </div>
      </section>

      {!hasData ? (
        <section className="px-6 sm:px-12 py-16 border-t border-rule">
          <p className="text-muted">
            No readings for this {range === "day" ? "day" : range} yet.
          </p>
        </section>
      ) : (
        <>
          {/* Live flow first: the at-a-glance "where is power moving" view.
              Only meaningful for right now, so it's hidden on past dates. */}
          {isLiveToday && latestGlobal && (
            <section className="px-6 sm:px-12 pb-4">
              <div className="flex items-baseline justify-between gap-4 mb-2 flex-wrap">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                  Live flow · pulses show direction, speed shows power
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

          {/* The balance: what's being used, and what's supplying it */}
          <section className="px-6 sm:px-12 pb-10">
            <div className="flex items-baseline justify-between gap-4 mb-8 flex-wrap">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                Where your power is going · {isLiveToday ? "now" : rangeLabel}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                big number = right now · small = {rangeLabel.toLowerCase()}
              </div>
            </div>

            <div className="flex flex-wrap items-start gap-x-2 gap-y-8">
              <BalanceTerm
                label="Home"
                nowKw={isLiveToday ? balNow.homeExclTesla : null}
                todayKwh={Math.max(0, consumed - homeChargeKwh)}
                detail="excludes the car"
                color={C.house}
              />
              <div className="flex items-start gap-2">
                <Op>+</Op>
                <BalanceTerm
                  label="Tesla"
                  nowKw={isLiveToday ? balNow.tesla : null}
                  todayKwh={homeChargeKwh}
                  detail="charged at home"
                  color={C.charge}
                />
              </div>
              <div className="flex items-start gap-2">
                <Op>=</Op>
                <BalanceTerm
                  label="Solar"
                  nowKw={isLiveToday ? balNow.solar : null}
                  todayKwh={generated}
                  detail={
                    isLiveToday && latestGlobal
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
                  nowKw={isLiveToday ? balNow.battery : null}
                  todayKwh={
                    (latestGlobal?.battery_discharge_kwh_today ?? 0) -
                    (latestGlobal?.battery_charge_kwh_today ?? 0)
                  }
                  detail={[
                    latestGlobal?.battery_soc != null ? `${Math.round(latestGlobal.battery_soc)}% charged` : null,
                    flow
                      ? `${flow.solarToBattery.toFixed(1)} solar / ${Math.max(
                          0,
                          (latestGlobal?.battery_charge_kwh_today ?? 0) - flow.solarToBattery,
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
                  nowKw={isLiveToday ? balNow.grid : null}
                  todayKwh={cost.importKwh - cost.exportKwh}
                  detail={`peak ${kwh(cost.peakKwh)} ${money(
                    cost.peakKwh * tariff.peakRate,
                  )} · off-pk ${kwh(cost.offPeakKwh)} ${money(cost.offPeakKwh * tariff.offPeakRate)}`}
                  color={balNow.grid < 0 ? C.export : C.grid}
                />
              </div>
            </div>

            <p className="mt-8 text-xs text-muted max-w-3xl">
              Read it left to right: what the house and car are using has to come from somewhere —
              solar first, then the battery, and the grid covers whatever is left. Battery and grid
              go <span className="text-foreground">negative</span>{" "}
              when they&apos;re absorbing rather than supplying (battery charging, solar
              exporting), so both sides always balance.
              {isLiveToday && (
                <>{" "}Tesla figures are live from the Fleet API, sampled every 5 minutes; the car
                stops reporting while asleep, so its power reads zero rather than stale.</>
              )}
            </p>
          </section>

          {/* One merged chart: Tesla, grid (signed), and home load excl. car */}
          <section className="border-t border-rule px-6 sm:px-12 py-10">
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

          {/* Totals for the selected period, each with its own breakdown */}
          <section className="border-t border-rule px-6 sm:px-12 py-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-8 divide-rule">
              <Stat
                label="Generated"
                value={kwh(generated)}
                sub={`kWh · new ${kwh(latestGlobal?.solar_new_kwh_today)} + old ${kwh(
                  latestGlobal?.solar_old_kwh_today,
                )}`}
              />
              <Stat
                label="Consumed"
                value={kwh(consumed)}
                sub={
                  flow
                    ? `kWh · solar ${flow.solarToHome.toFixed(1)} · battery ${flow.batteryToHome.toFixed(
                        1,
                      )} · grid ${flow.gridToHome.toFixed(1)}`
                    : `kWh · ${rangeLabel}`
                }
              />
              <Stat
                label="Imported"
                value={kwh(cost.importKwh)}
                sub={`kWh · peak ${kwh(cost.peakKwh)} ${money(
                  cost.peakKwh * tariff.peakRate,
                )} · off-pk ${kwh(cost.offPeakKwh)} ${money(cost.offPeakKwh * tariff.offPeakRate)}`}
              />
              <Stat
                label="Exported"
                value={kwh(cost.exportKwh)}
                sub={`kWh · earned ${money(cost.exportCredit)} @ ${money(tariff.feedIn)}/kWh`}
              />
              <Stat
                label="Tesla charged"
                value={kwh(homeChargeKwh)}
                sub={
                  homeChargeKwh > 0
                    ? `kWh · cost ${money(carTotalCost)} (peak ${money(
                        carPeakCost,
                      )} · off-pk ${money(carOffPeakCost)})`
                    : "kWh at home"
                }
              />
            </div>
            {homeChargeKwh > 0 && (
              <p className="pb-5 text-xs text-muted max-w-3xl">
                Car cost counts only the grid-supplied share, apportioned from the house meter
                over each stretch of charging — see the cost breakdown below for the full working,
                including what it would have cost drawn entirely from the grid.
              </p>
            )}
          </section>

          {/* Share of consumption, with the grid split by tariff */}
          <section className="border-t border-rule px-6 sm:px-12 py-10">
            <div className="flex items-baseline justify-between gap-4 mb-6 flex-wrap">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                Power use · {rangeLabel}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                hover a band for its exact share
              </div>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted mb-3">
              Where it came from
            </div>
            <ShareBar slices={shareSlices} />
            <p className="mt-6 text-xs text-muted max-w-3xl">
              Where the power your home actually used came from. The grid portion is split by
              tariff using the same peak/off-peak ratio as the day&apos;s metered import — a small
              part of that import charged the battery rather than running the house, so the split is
              proportional rather than separately metered.
            </p>

            {homeChargeKwh > 0 && (
              <div className="mt-10">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted mb-3">
                  Where it went
                </div>
                <ShareBar slices={destSlices} />
                <p className="mt-6 text-xs text-muted max-w-3xl">
                  The car&apos;s share of everything the property consumed. This is a different cut
                  of the same energy as the bar above — that one splits it by source, this one by
                  where it ended up.
                </p>
              </div>
            )}
          </section>

          {/* What it costs, and how that number is built */}
          <section className="border-t border-rule px-6 sm:px-12 py-10">
            <div className="flex items-baseline justify-between gap-4 mb-6 flex-wrap">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                Cost · {rangeLabel}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                {cost.days} day{cost.days === 1 ? "" : "s"} · Lumo time-of-use
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end gap-8 sm:gap-12">
              <div className="flex flex-col gap-1">
                <div className="text-5xl sm:text-6xl font-semibold tracking-[-0.02em]">
                  {money(cost.net)}
                </div>
                <div className="text-sm text-muted">net cost for this period</div>
              </div>

              <div className="flex-1 flex flex-col gap-2 font-mono text-[11px] sm:text-xs">
                <CostLine
                  label={`Peak · ${kwh(cost.peakKwh)} kWh @ $${tariff.peakRate.toFixed(3)}`}
                  value={money(cost.peakKwh * tariff.peakRate)}
                  color={C.grid}
                />
                <CostLine
                  label={`Off-peak · ${kwh(cost.offPeakKwh)} kWh @ $${tariff.offPeakRate.toFixed(5)}`}
                  value={money(cost.offPeakKwh * tariff.offPeakRate)}
                  color={C.grid}
                />
                <CostLine
                  label={`Supply · ${cost.days} × $${tariff.supplyPerDay.toFixed(5)}/day`}
                  value={money(cost.supply)}
                />
                <CostLine
                  label={`Export credit · ${kwh(cost.exportKwh)} kWh @ $${tariff.feedIn.toFixed(3)}`}
                  value={`−${money(cost.exportCredit)}`}
                  color={C.export}
                />
                <div className="border-t border-rule mt-1 pt-2 flex justify-between">
                  <span className="text-muted uppercase tracking-[0.18em]">Net</span>
                  <span className="text-foreground">{money(cost.net)}</span>
                </div>

                {teslaCost.kwh > 0 && (
                  <div className="mt-5 pt-4 border-t border-rule flex flex-col gap-2">
                    <div className="text-muted uppercase tracking-[0.18em] text-[10px]">
                      Of which the car — already inside the peak / off-peak lines above
                    </div>
                    <CostLine
                      label={`Car · peak · ${kwh(carPeakKwh)} kWh @ $${tariff.peakRate.toFixed(3)}`}
                      value={money(carPeakCost)}
                      color={C.charge}
                    />
                    <CostLine
                      label={`Car · off-peak · ${kwh(carOffPeakKwh)} kWh @ $${tariff.offPeakRate.toFixed(5)}`}
                      value={money(carOffPeakCost)}
                      color={C.charge}
                    />
                    <div className="border-t border-rule mt-1 pt-2 flex justify-between">
                      <span className="text-muted uppercase tracking-[0.18em]">Car total</span>
                      <span className="text-foreground">{money(carTotalCost)}</span>
                    </div>
                    {carSelfKwh > 0.05 && (
                      <CostLine
                        label={`Free from solar / battery · ${kwh(carSelfKwh)} kWh`}
                        value={`saved ${money(carSaved)}`}
                        color={C.self}
                      />
                    )}
                    <CostLine
                      label={`If it had all come from the grid · ${kwh(carTotalKwh)} kWh`}
                      value={money(carFullGridCost)}
                    />
                  </div>
                )}
              </div>
            </div>

            {teslaCost.kwh > 0 && (
              <p className="mt-6 text-xs text-muted max-w-3xl">
                The car&apos;s cost is a <span className="text-foreground">share of the net above,
                not an addition to it</span> — the car is part of the house load, so its energy is
                already in the metered import. Splitting solar-vs-grid is apportioned rather than
                measured: Anker meters the whole house as one figure and can&apos;t see the car, so
                for each stretch of charging the grid&apos;s share of total house draw over that same
                window is applied to it.
                {!teslaCost.measured &&
                  " No meter readings overlapped this charging, so it's all counted as grid-supplied — the cautious assumption."}
              </p>
            )}

            {cost.hasGaps && (
              <p className="mt-6 text-xs text-muted max-w-2xl">
                Some of this period had gaps between readings. Total kWh is still exact (it comes
                from the meter’s own cumulative counter), but for those stretches the peak vs
                off-peak split is apportioned by elapsed time rather than measured directly.
              </p>
            )}
          </section>

          {/* Where power actually came from / where solar actually went.
              Straight from Anker's own flow accounting, not derived here. */}
          {flow && flow.ankerHome > 0 && (
            <section className="border-t border-rule px-6 sm:px-12 py-10">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-8">
                Energy flow · {rangeLabel}
              </div>
              <div className="grid sm:grid-cols-2 gap-10 sm:gap-16 max-w-4xl">
                <FlowBar
                  title="Where home power came from"
                  total={flow.ankerHome}
                  parts={[
                    { label: "Own solar", value: flow.solarToHome, color: C.solar },
                    { label: "Battery", value: flow.batteryToHome, color: C.battery },
                    { label: "Grid", value: flow.gridToHome, color: C.grid },
                  ]}
                  note={
                    flow.growattToday == null
                      ? "Anker's own whole-home figure. It can't see the Growatt array, so on days that array reports, actual consumption is higher than this."
                      : undefined
                  }
                />
                <FlowBar
                  title="Where the solar went"
                  total={flow.solarTotal}
                  parts={[
                    { label: "Straight to home", value: flow.solarToHome, color: C.solar },
                    { label: "Into battery", value: flow.solarToBattery, color: C.battery },
                    { label: "Exported", value: flow.solarToGrid, color: C.export },
                  ]}
                  note={`Self-consumed ${
                    flow.solarTotal > 0
                      ? Math.round(((flow.solarToHome + flow.solarToBattery) / flow.solarTotal) * 100)
                      : 0
                  }% (home + battery) rather than exported at the ${money(tariff.feedIn)}/kWh feed-in rate.`}
                />
              </div>
            </section>
          )}

          {/* Two solar arrays, side by side, each with its own live output */}
          {isLiveToday && latestGlobal && (
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
