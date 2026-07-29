import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  type DailyTotal,
  type DateRange,
  computeCost,
  getChargeSessionsForDate,
  getDailyTotals,
  getHomeChargeKwhByDate,
  getLatest,
  getReadingsForDate,
  getReadingsInRange,
  getTariff,
  isFutureLocalDate,
  melbNow,
  rangeWindow,
} from "@/lib/energy";
import { AutoRefresh } from "./auto-refresh";
import { RangePicker } from "./range-picker";
import {
  C,
  GridRelianceChartDay,
  GridRelianceChartRange,
  PowerChartDay,
  PowerChartRange,
} from "./charts";

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

function Tile({
  label,
  value,
  unit,
  sub,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-2 py-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-4xl sm:text-5xl font-semibold tracking-[-0.02em]" style={{ color }}>
          {value}
        </span>
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
      {sub && <div className="text-sm text-muted">{sub}</div>}
    </div>
  );
}

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
}: {
  name: string;
  hardware: string;
  rated: string;
  liveKw: number | null;
  todayKwh: number | null;
  ratedKw: number;
  extra?: string;
  offline?: boolean;
}) {
  const utilisation =
    liveKw != null && ratedKw > 0 ? Math.min(100, Math.max(0, (liveKw / ratedKw) * 100)) : 0;
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
        {offline ? (
          <div style={{ color: C.grid }}>No data — this array isn’t reporting</div>
        ) : (
          <div className="text-muted">
            {kwh(todayKwh)} kWh today{extra ? ` · ${extra}` : ""}
          </div>
        )}
      </div>
    </div>
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

const VALID_RANGES: DateRange[] = ["day", "week", "month"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; date?: string }>;
}) {
  const { env } = await getCloudflareContext({ async: true });
  const { date: today, time: nowTime } = melbNow();
  const sp = await searchParams;

  const range: DateRange = VALID_RANGES.includes(sp.range as DateRange)
    ? (sp.range as DateRange)
    : "day";
  let date = sp.date && DATE_RE.test(sp.date) ? sp.date : today;
  if (isFutureLocalDate(date, today)) date = today;

  const isLiveToday = range === "day" && date === today;
  const win = rangeWindow(range, date);

  const latestGlobal = await getLatest(env.DB);
  const tariff = await getTariff(env.ENERGY_KV);

  const daySeries = range === "day" ? await getReadingsForDate(env.DB, date) : [];
  const sessions = range === "day" ? await getChargeSessionsForDate(env.DB, date) : [];
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
  const exported =
    range === "day" ? (dayLatest?.grid_export_kwh_today ?? 0) : daily.reduce((s, d) => s + d.gridExportKwh, 0);
  const selfPowered =
    consumed > 0 ? Math.max(0, Math.min(100, ((consumed - imported) / consumed) * 100)) : null;
  const homeChargeKwh =
    range === "day"
      ? sessions.reduce((s, c) => s + (c.energy_added_kwh ?? 0), 0)
      : daily.reduce((s, d) => s + d.homeChargeKwh, 0);

  const cost = computeCost(costSeries, tariff);
  const gridShare = consumed > 0 ? Math.min(100, (imported / consumed) * 100) : null;

  let busiest: { kw: number; time: string; date?: string } | null = null;
  for (const r of costSeries) {
    if (r.house_kw != null && (busiest === null || r.house_kw > busiest.kw)) {
      busiest = { kw: r.house_kw, time: r.local_time, date: r.local_date };
    }
  }

  // Live-tile-only derivations (today, day mode)
  const bChg = latestGlobal?.battery_charge_kw ?? 0;
  const bDis = latestGlobal?.battery_discharge_kw ?? 0;
  const batterySub =
    bChg > 0.05 ? `Charging ${kw(bChg)} kW` : bDis > 0.05 ? `Discharging ${kw(bDis)} kW` : "Idle";
  const gImp = latestGlobal?.grid_import_kw ?? 0;
  const gExp = latestGlobal?.grid_export_kw ?? 0;
  const gridValue = gImp > 0.05 ? kw(gImp) : gExp > 0.05 ? kw(gExp) : "0.0";
  const gridSub = gImp > 0.05 ? "Importing" : gExp > 0.05 ? "Exporting" : "Balanced";
  // Red while drawing from the grid, green while exporting to it.
  const gridColor = gImp > 0.05 ? C.grid : gExp > 0.05 ? C.self : undefined;

  const rangeLabel =
    range === "day" ? (date === today ? "Today" : date) : `${win.start} → ${win.end}`;

  // Which inverters reported in the most recent sample. When one is missing,
  // solar totals AND the derived house load are understated, so say so plainly
  // rather than presenting a partial number as if it were complete.
  const reported = (latestGlobal?.sources ?? "").split(",").filter(Boolean);
  const missingSources = ["anker", "growatt"].filter((s) => !reported.includes(s));
  const showPartialWarning = isLiveToday && latestGlobal != null && missingSources.length > 0;

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
          {isLiveToday && <AutoRefresh seconds={30} currentTs={latestGlobal?.ts ?? null} />}
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
          Live from 36 Australis Dr — two solar arrays (12.8 kW), a 10 kWh battery, and the grid,
          combined into one view.
        </p>
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

      {showPartialWarning && (
        <section className="border-t border-rule px-6 sm:px-12 py-5">
          <div className="flex items-start gap-3 text-sm">
            <span style={{ color: C.grid }} className="font-mono text-[10px] uppercase tracking-[0.18em] pt-1">
              Incomplete
            </span>
            <p className="text-muted max-w-2xl">
              The <span className="text-foreground">{missingSources.join(" and ")}</span> inverter
              {missingSources.length > 1 ? "s are" : " is"} not reporting in the latest reading, so
              solar generation and house load below are{" "}
              <span className="text-foreground">understated</span> — house load is derived from all
              generation sources, so a missing array pulls it down too. Grid import/export and cost
              are unaffected.
            </p>
          </div>
        </section>
      )}

      {!hasData ? (
        <section className="px-6 sm:px-12 py-16 border-t border-rule">
          <p className="text-muted">
            No readings for this {range === "day" ? "day" : range} yet.
          </p>
        </section>
      ) : (
        <>
          {/* Live tiles — only for "today" in day mode */}
          {isLiveToday && latestGlobal && (
            <section className="border-t border-rule px-6 sm:px-12">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 divide-rule">
                <Tile
                  label="Solar now"
                  value={kw(latestGlobal.solar_total_kw)}
                  unit="kW"
                  color={C.solar}
                  sub={`New ${kw(latestGlobal.solar_new_kw)} + old ${kw(latestGlobal.solar_old_kw)} kW`}
                />
                <Tile label="Battery" value={pct(latestGlobal.battery_soc)} color={C.battery} sub={batterySub} />
                <Tile label="Grid" value={gridValue} unit="kW" color={gridColor} sub={gridSub} />
                <Tile
                  label="House load"
                  value={kw(latestGlobal.house_kw)}
                  unit="kW"
                  color={C.house}
                  sub="Drawing right now"
                />
              </div>
              <div className="pb-8 -mt-2">
                <div className="h-1.5 w-full max-w-xs rounded-full bg-rule overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${latestGlobal.battery_soc ?? 0}%`, background: C.battery }}
                  />
                </div>
              </div>
            </section>
          )}

          {/* Totals for the selected period */}
          <section className="border-t border-rule px-6 sm:px-12">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-8 divide-rule">
              <Stat label="Generated" value={`${kwh(generated)}`} sub={`kWh · ${rangeLabel}`} />
              <Stat label="Consumed" value={`${kwh(consumed)}`} sub={`kWh · ${rangeLabel}`} />
              <Stat label="Self-powered" value={pct(selfPowered)} sub="of consumption" />
              <Stat label="Imported" value={`${kwh(imported)}`} sub="kWh from grid" />
              <Stat label="Exported" value={`${kwh(exported)}`} sub="kWh to grid" />
              <Stat label="Tesla charged" value={`${kwh(homeChargeKwh)}`} sub="kWh at home" />
            </div>
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
                  color={C.self}
                />
                <div className="border-t border-rule mt-1 pt-2 flex justify-between">
                  <span className="text-muted uppercase tracking-[0.18em]">Net</span>
                  <span className="text-foreground">{money(cost.net)}</span>
                </div>
              </div>
            </div>

            {cost.hasGaps && (
              <p className="mt-6 text-xs text-muted max-w-2xl">
                Some of this period had gaps between readings. Total kWh is still exact (it comes
                from the meter’s own cumulative counter), but for those stretches the peak vs
                off-peak split is apportioned by elapsed time rather than measured directly.
              </p>
            )}
          </section>

          {/* Power / generation chart */}
          <section className="border-t border-rule px-6 sm:px-12 py-10">
            <div className="flex items-center gap-6 mb-6 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-2" style={{ background: C.solar }} /> Solar
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-0.5" style={{ background: C.house }} /> House
              </span>
              <span className="ml-auto normal-case tracking-normal text-muted">
                {range === "day" ? `${rangeLabel} · kW` : `${rangeLabel} · kWh/day`}
              </span>
            </div>
            {range === "day" ? <PowerChartDay series={daySeries} /> : <PowerChartRange daily={daily} />}
          </section>

          {/* Grid reliance + Tesla charging overlay */}
          <section className="border-t border-rule px-6 sm:px-12 py-10">
            <div className="flex items-center gap-6 mb-6 font-mono text-[10px] uppercase tracking-[0.22em] text-muted flex-wrap">
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-2" style={{ background: C.self }} /> Self · solar+battery
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-2" style={{ background: C.grid }} /> Grid
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-0.5" style={{ background: C.charge }} /> Tesla charging
              </span>
              <span className="ml-auto normal-case tracking-normal text-muted">
                {range === "day" ? `${rangeLabel} · kW` : `${rangeLabel} · kWh/day`}
              </span>
            </div>
            {range === "day" ? (
              <GridRelianceChartDay series={daySeries} tariff={tariff} sessions={sessions} />
            ) : (
              <GridRelianceChartRange daily={daily} />
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
                />
                <ArrayBox
                  name="Original array"
                  hardware="Growatt 5000TL3-S"
                  rated="6.6 kW"
                  liveKw={latestGlobal.solar_old_kw}
                  todayKwh={latestGlobal.solar_old_kwh_today}
                  ratedKw={6.6}
                  offline={latestGlobal.solar_old_kw == null}
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
