import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  type ChargeSession,
  type DailyTotal,
  type DateRange,
  type Reading,
  type Tariff,
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
import { AutoRefresh } from "./auto-refresh";
import { RangePicker } from "./range-picker";

export const dynamic = "force-dynamic";

const C = {
  solar: "#f5b301",
  battery: "#4ade80",
  grid: "#f87171",
  house: "#f5f5f4",
  charge: "#38bdf8",
};

const kw = (n: number | null | undefined) =>
  n == null ? "—" : (Math.abs(n) < 0.05 ? 0 : n).toFixed(1);
const kwh = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1));
const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);

function minutesOfDay(localTime: string): number {
  const [hh, mm] = localTime.split(":").map(Number);
  return hh * 60 + mm;
}

// ---------- Day-mode charts (per-5-min series, x = minutes of day) ----------

function PowerChartDay({ series }: { series: Reading[] }) {
  const W = 920;
  const H = 240;
  const padL = 10;
  const padR = 10;
  const padT = 18;
  const padB = 24;

  const pts = series
    .map((r) => ({ min: minutesOfDay(r.local_time), solar: r.solar_total_kw ?? 0, house: r.house_kw ?? 0 }))
    .sort((a, b) => a.min - b.min);

  const ymax = Math.max(1, ...pts.map((p) => Math.max(p.solar, p.house))) * 1.15;
  const x = (min: number) => padL + (min / 1440) * (W - padL - padR);
  const y = (v: number) => H - padB - (v / ymax) * (H - padT - padB);
  const base = y(0);

  const solarArea =
    pts.length > 0
      ? `M ${x(pts[0].min)} ${base} ` +
        pts.map((p) => `L ${x(p.min)} ${y(p.solar)}`).join(" ") +
        ` L ${x(pts[pts.length - 1].min)} ${base} Z`
      : "";
  const houseLine =
    pts.length > 0 ? pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.min)} ${y(p.house)}`).join(" ") : "";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Power today">
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={padL} x2={W - padR} y1={y(ymax * f)} y2={y(ymax * f)} stroke="#1f1f1f" strokeWidth={1} />
      ))}
      {[0, 0.5, 1].map((f) => (
        <text key={`l${f}`} x={padL} y={y(ymax * f) - 4} fill="#737373" fontSize={10} fontFamily="var(--font-geist-mono)">
          {(ymax * f).toFixed(1)} kW
        </text>
      ))}
      {[6, 12, 18].map((h) => (
        <g key={h}>
          <line x1={x(h * 60)} x2={x(h * 60)} y1={padT} y2={base} stroke="#1f1f1f" strokeWidth={1} strokeDasharray="2 4" />
          <text x={x(h * 60)} y={H - 8} fill="#737373" fontSize={10} textAnchor="middle" fontFamily="var(--font-geist-mono)">
            {`${h}:00`}
          </text>
        </g>
      ))}
      {solarArea && <path d={solarArea} fill={C.solar} fillOpacity={0.16} stroke="none" />}
      {solarArea && (
        <path
          d={pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.min)} ${y(p.solar)}`).join(" ")}
          fill="none"
          stroke={C.solar}
          strokeWidth={1.75}
        />
      )}
      {houseLine && <path d={houseLine} fill="none" stroke={C.house} strokeOpacity={0.85} strokeWidth={1.5} />}
      {pts.length === 1 && (
        <>
          <circle cx={x(pts[0].min)} cy={y(pts[0].solar)} r={3} fill={C.solar} />
          <circle cx={x(pts[0].min)} cy={y(pts[0].house)} r={3} fill={C.house} />
        </>
      )}
    </svg>
  );
}

function GridRelianceChartDay({
  series,
  tariff,
  sessions,
}: {
  series: Reading[];
  tariff: Tariff;
  sessions: ChargeSession[];
}) {
  const W = 920;
  const H = 240;
  const padL = 10;
  const padR = 10;
  const padT = 18;
  const padB = 24;

  const pts = series
    .map((r) => {
      const house = r.house_kw ?? 0;
      const grid = Math.max(0, r.grid_import_kw ?? 0);
      return { min: minutesOfDay(r.local_time), house, self: Math.max(0, house - grid) };
    })
    .sort((a, b) => a.min - b.min);

  const chargePts = sessions
    .filter((s) => s.avgPowerKw != null)
    .map((s) => {
      const start = new Date(s.started_ts * 1000);
      const end = new Date((s.ended_ts ?? s.started_ts) * 1000);
      const startMin = start.getHours() * 60 + start.getMinutes();
      let endMin = end.getHours() * 60 + end.getMinutes();
      if (endMin < startMin) endMin = 1440; // session ran past local midnight
      return { startMin, endMin, kw: s.avgPowerKw as number };
    });

  const ymax =
    Math.max(1, ...pts.map((p) => p.house), ...chargePts.map((c) => c.kw)) * 1.15;
  const x = (min: number) => padL + (min / 1440) * (W - padL - padR);
  const y = (v: number) => H - padB - (v / ymax) * (H - padT - padB);
  const base = y(0);

  const greenArea =
    pts.length > 0
      ? `M ${x(pts[0].min)} ${base} ` +
        pts.map((p) => `L ${x(p.min)} ${y(p.self)}`).join(" ") +
        ` L ${x(pts[pts.length - 1].min)} ${base} Z`
      : "";
  const redBand =
    pts.length > 0
      ? `M ` +
        pts.map((p) => `${x(p.min)} ${y(p.house)}`).join(" L ") +
        " L " +
        [...pts].reverse().map((p) => `${x(p.min)} ${y(p.self)}`).join(" L ") +
        " Z"
      : "";

  const peakBands: [number, number][] =
    tariff.peakStartHour <= tariff.peakEndHour
      ? [[tariff.peakStartHour, tariff.peakEndHour]]
      : [
          [tariff.peakStartHour, 24],
          [0, tariff.peakEndHour],
        ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Grid reliance">
      {peakBands.map(([s, e], i) => (
        <rect key={i} x={x(s * 60)} y={padT} width={x(e * 60) - x(s * 60)} height={base - padT} fill={C.solar} fillOpacity={0.07} />
      ))}
      {peakBands.length > 0 && (
        <text
          x={x(((peakBands[0][0] + peakBands[0][1]) / 2) * 60)}
          y={padT + 11}
          fill={C.solar}
          fillOpacity={0.65}
          fontSize={9}
          textAnchor="middle"
          fontFamily="var(--font-geist-mono)"
        >
          PEAK
        </text>
      )}
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={padL} x2={W - padR} y1={y(ymax * f)} y2={y(ymax * f)} stroke="#1f1f1f" strokeWidth={1} />
      ))}
      {[0, 0.5, 1].map((f) => (
        <text key={`l${f}`} x={padL} y={y(ymax * f) - 4} fill="#737373" fontSize={10} fontFamily="var(--font-geist-mono)">
          {(ymax * f).toFixed(1)} kW
        </text>
      ))}
      {[6, 12, 18].map((h) => (
        <text key={h} x={x(h * 60)} y={H - 8} fill="#737373" fontSize={10} textAnchor="middle" fontFamily="var(--font-geist-mono)">
          {`${h}:00`}
        </text>
      ))}
      {greenArea && <path d={greenArea} fill={C.battery} fillOpacity={0.5} stroke="none" />}
      {redBand && <path d={redBand} fill={C.grid} fillOpacity={0.5} stroke="none" />}
      {pts.length === 1 && (
        <>
          <rect x={x(pts[0].min) - 2} y={y(pts[0].self)} width={4} height={base - y(pts[0].self)} fill={C.battery} />
          <rect x={x(pts[0].min) - 2} y={y(pts[0].house)} width={4} height={y(pts[0].self) - y(pts[0].house)} fill={C.grid} />
        </>
      )}
      {chargePts.map((c, i) => (
        <path
          key={i}
          d={`M ${x(c.startMin)} ${y(c.kw)} L ${x(c.endMin)} ${y(c.kw)}`}
          stroke={C.charge}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

// ---------- Range-mode charts (one bar per day, x = date) ----------

function DayLabels({ dates, x, H, padB }: { dates: string[]; x: (i: number) => number; H: number; padB: number }) {
  const n = dates.length;
  const show = [0, Math.floor(n / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <>
      {show.map((i) => (
        <text key={i} x={x(i) } y={H - padB + 16} fill="#737373" fontSize={9} textAnchor="middle" fontFamily="var(--font-geist-mono)">
          {dates[i]?.slice(5)}
        </text>
      ))}
    </>
  );
}

function PowerChartRange({ daily }: { daily: DailyTotal[] }) {
  const W = 920;
  const H = 240;
  const padL = 10;
  const padR = 10;
  const padT = 18;
  const padB = 28;
  const n = daily.length;
  if (n === 0) return <p className="text-muted text-sm">No data in this range.</p>;

  const ymax = Math.max(1, ...daily.map((d) => Math.max(d.generatedKwh, d.consumedKwh))) * 1.15;
  const bw = (W - padL - padR) / n;
  const xCenter = (i: number) => padL + i * bw + bw / 2;
  const y = (v: number) => H - padB - (v / ymax) * (H - padT - padB);
  const base = y(0);

  const linePath = daily
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xCenter(i)} ${y(d.consumedKwh)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Generated vs consumed by day">
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={padL} x2={W - padR} y1={y(ymax * f)} y2={y(ymax * f)} stroke="#1f1f1f" strokeWidth={1} />
      ))}
      {[0, 0.5, 1].map((f) => (
        <text key={`l${f}`} x={padL} y={y(ymax * f) - 4} fill="#737373" fontSize={10} fontFamily="var(--font-geist-mono)">
          {Math.round(ymax * f)} kWh
        </text>
      ))}
      {daily.map((d, i) => (
        <rect
          key={d.date}
          x={padL + i * bw + bw * 0.15}
          y={y(d.generatedKwh)}
          width={bw * 0.7}
          height={base - y(d.generatedKwh)}
          fill={C.solar}
          fillOpacity={0.45}
        />
      ))}
      <path d={linePath} fill="none" stroke={C.house} strokeOpacity={0.9} strokeWidth={1.75} />
      <DayLabels dates={daily.map((d) => d.date)} x={xCenter} H={H} padB={padB} />
    </svg>
  );
}

function GridRelianceChartRange({ daily }: { daily: DailyTotal[] }) {
  const W = 920;
  const H = 240;
  const padL = 10;
  const padR = 10;
  const padT = 18;
  const padB = 28;
  const n = daily.length;
  if (n === 0) return <p className="text-muted text-sm">No data in this range.</p>;

  const ymax =
    Math.max(1, ...daily.map((d) => d.selfKwh + d.gridImportKwh), ...daily.map((d) => d.homeChargeKwh)) * 1.15;
  const bw = (W - padL - padR) / n;
  const xCenter = (i: number) => padL + i * bw + bw / 2;
  const y = (v: number) => H - padB - (v / ymax) * (H - padT - padB);
  const base = y(0);

  const chargeLine = daily
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xCenter(i)} ${y(d.homeChargeKwh)}`)
    .join(" ");
  const hasCharging = daily.some((d) => d.homeChargeKwh > 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Grid reliance by day">
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={padL} x2={W - padR} y1={y(ymax * f)} y2={y(ymax * f)} stroke="#1f1f1f" strokeWidth={1} />
      ))}
      {[0, 0.5, 1].map((f) => (
        <text key={`l${f}`} x={padL} y={y(ymax * f) - 4} fill="#737373" fontSize={10} fontFamily="var(--font-geist-mono)">
          {Math.round(ymax * f)} kWh
        </text>
      ))}
      {daily.map((d, i) => {
        const bx = padL + i * bw + bw * 0.15;
        const bwid = bw * 0.7;
        return (
          <g key={d.date}>
            <rect x={bx} y={y(d.selfKwh)} width={bwid} height={base - y(d.selfKwh)} fill={C.battery} fillOpacity={0.5} />
            <rect
              x={bx}
              y={y(d.selfKwh + d.gridImportKwh)}
              width={bwid}
              height={y(d.selfKwh) - y(d.selfKwh + d.gridImportKwh)}
              fill={C.grid}
              fillOpacity={0.5}
            />
          </g>
        );
      })}
      {hasCharging && <path d={chargeLine} fill="none" stroke={C.charge} strokeWidth={2} />}
      {hasCharging &&
        daily.map((d, i) =>
          d.homeChargeKwh > 0 ? (
            <circle key={d.date} cx={xCenter(i)} cy={y(d.homeChargeKwh)} r={2.5} fill={C.charge} />
          ) : null,
        )}
      <DayLabels dates={daily.map((d) => d.date)} x={xCenter} H={H} padB={padB} />
    </svg>
  );
}

// ---------- Tiles ----------

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
