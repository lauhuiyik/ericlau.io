import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  type DailyTotal,
  type DateRange,
  costToday,
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

  const costLatestForExport =
    range === "day" ? dayLatest : costSeries.length ? costSeries[costSeries.length - 1] : null;
  const cost = costToday(costSeries, costLatestForExport, tariff);
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
  const gridColor = gImp > 0.05 ? C.grid : gExp > 0.05 ? C.battery : undefined;

  const rangeLabel =
    range === "day" ? (date === today ? "Today" : date) : `${win.start} → ${win.end}`;

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
                  sub="Whole-home consumption"
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
              <Stat label="Grid cost" value={money(cost.net)} sub="est. (ToU)" />
            </div>
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
                <span className="inline-block w-3 h-2" style={{ background: C.battery }} /> Self · solar+battery
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

          {/* Per-array breakdown — only meaningful for "today" live view */}
          {isLiveToday && latestGlobal && (
            <section className="border-t border-rule px-6 sm:px-12 py-10">
              <div className="grid sm:grid-cols-2 gap-8">
                <div className="flex flex-col gap-2">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                    New array · Anker SOLIX X1 · 6.16 kW
                  </div>
                  <div className="text-3xl font-semibold" style={{ color: C.solar }}>
                    {kw(latestGlobal.solar_new_kw)} <span className="text-sm text-muted">kW now</span>
                  </div>
                  <div className="text-sm text-muted">
                    {kwh(latestGlobal.solar_new_kwh_today)} kWh today · battery {pct(latestGlobal.battery_soc)}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                    Original array · Growatt · 6.6 kW
                  </div>
                  <div className="text-3xl font-semibold" style={{ color: C.solar }}>
                    {kw(latestGlobal.solar_old_kw)} <span className="text-sm text-muted">kW now</span>
                  </div>
                  <div className="text-sm text-muted">{kwh(latestGlobal.solar_old_kwh_today)} kWh today</div>
                </div>
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
