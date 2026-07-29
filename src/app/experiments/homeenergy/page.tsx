import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  type ChargeSummary,
  type Reading,
  type Tariff,
  costToday,
  getChargeSummary,
  getLatest,
  getTariff,
  getTodaySeries,
  melbNow,
} from "@/lib/energy";
import { AutoRefresh } from "./auto-refresh";

export const dynamic = "force-dynamic";

const C = {
  solar: "#f5b301",
  battery: "#4ade80",
  grid: "#f87171",
  house: "#f5f5f4",
};

const kw = (n: number | null | undefined) =>
  n == null ? "—" : (Math.abs(n) < 0.05 ? 0 : n).toFixed(1);
const kwh = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1));
const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);

function PowerChart({ series }: { series: Reading[] }) {
  const W = 920;
  const H = 240;
  const padL = 10;
  const padR = 10;
  const padT = 18;
  const padB = 24;

  const pts = series
    .map((r) => {
      const [hh, mm] = r.local_time.split(":").map(Number);
      return {
        min: hh * 60 + mm,
        solar: r.solar_total_kw ?? 0,
        house: r.house_kw ?? 0,
      };
    })
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
    pts.length > 0
      ? pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.min)} ${y(p.house)}`).join(" ")
      : "";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Today's power">
      {/* horizontal gridlines */}
      {[0, 0.5, 1].map((f) => (
        <line
          key={f}
          x1={padL}
          x2={W - padR}
          y1={y(ymax * f)}
          y2={y(ymax * f)}
          stroke="#1f1f1f"
          strokeWidth={1}
        />
      ))}
      {[0, 0.5, 1].map((f) => (
        <text key={`l${f}`} x={padL} y={y(ymax * f) - 4} fill="#737373" fontSize={10} fontFamily="var(--font-geist-mono)">
          {(ymax * f).toFixed(1)} kW
        </text>
      ))}
      {/* hour markers */}
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

function GridRelianceChart({ series, tariff }: { series: Reading[]; tariff: Tariff }) {
  const W = 920;
  const H = 240;
  const padL = 10;
  const padR = 10;
  const padT = 18;
  const padB = 24;

  const pts = series
    .map((r) => {
      const [hh, mm] = r.local_time.split(":").map(Number);
      const house = r.house_kw ?? 0;
      const grid = Math.max(0, r.grid_import_kw ?? 0);
      return { min: hh * 60 + mm, house, self: Math.max(0, house - grid) };
    })
    .sort((a, b) => a.min - b.min);

  const ymax = Math.max(1, ...pts.map((p) => p.house)) * 1.15;
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
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Grid reliance today">
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
    </svg>
  );
}

function ChargeHistoryChart({ byMonth }: { byMonth: ChargeSummary["byMonth"] }) {
  const W = 920;
  const H = 220;
  const padL = 36;
  const padR = 10;
  const padT = 14;
  const padB = 24;
  const months = byMonth.slice(-18); // last 18 months keeps bars readable
  const n = months.length;
  if (n === 0) return <p className="text-muted text-sm">No charging history yet.</p>;

  const ymax = Math.max(1, ...months.map((m) => m.homeKwh + m.awayKwh)) * 1.1;
  const bw = (W - padL - padR) / n;
  const y = (v: number) => H - padB - (v / ymax) * (H - padT - padB);
  const base = y(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Charging by month">
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={padL} x2={W - padR} y1={y(ymax * f)} y2={y(ymax * f)} stroke="#1f1f1f" strokeWidth={1} />
      ))}
      {[0, 0.5, 1].map((f) => (
        <text key={`l${f}`} x={0} y={y(ymax * f) - 4} fill="#737373" fontSize={10} fontFamily="var(--font-geist-mono)">
          {Math.round(ymax * f)}
        </text>
      ))}
      {months.map((m, i) => {
        const x = padL + i * bw + bw * 0.15;
        const w = bw * 0.7;
        return (
          <g key={m.month}>
            <rect x={x} y={y(m.homeKwh)} width={w} height={base - y(m.homeKwh)} fill={C.battery} fillOpacity={0.75} />
            <rect
              x={x}
              y={y(m.homeKwh + m.awayKwh)}
              width={w}
              height={y(m.homeKwh) - y(m.homeKwh + m.awayKwh)}
              fill={C.grid}
              fillOpacity={0.55}
            />
            {(i === 0 || i === n - 1 || i === Math.floor(n / 2)) && (
              <text x={x + w / 2} y={H - 6} fill="#737373" fontSize={9} textAnchor="middle" fontFamily="var(--font-geist-mono)">
                {m.month.slice(2)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

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

export default async function Page() {
  const { env } = await getCloudflareContext({ async: true });
  const { date: today, time: nowTime } = melbNow();
  const latest = await getLatest(env.DB);
  const series = await getTodaySeries(env.DB, today);
  const tariff = await getTariff(env.ENERGY_KV);
  const charges = await getChargeSummary(env.DB);

  const hasData = latest != null;

  const generated =
    (latest?.solar_new_kwh_today ?? 0) + (latest?.solar_old_kwh_today ?? 0);
  const consumed = latest?.house_kwh_today ?? 0;
  const imported = latest?.grid_import_kwh_today ?? 0;
  const exported = latest?.grid_export_kwh_today ?? 0;
  const selfPowered =
    consumed > 0 ? Math.max(0, Math.min(100, ((consumed - imported) / consumed) * 100)) : null;
  const cost = costToday(series, latest, tariff);
  const gridShare = consumed > 0 ? Math.min(100, (imported / consumed) * 100) : null;
  let busiest: { kw: number; time: string } | null = null;
  for (const r of series) {
    if (r.house_kw != null && (busiest === null || r.house_kw > busiest.kw)) {
      busiest = { kw: r.house_kw, time: r.local_time };
    }
  }

  // battery flow label
  const bChg = latest?.battery_charge_kw ?? 0;
  const bDis = latest?.battery_discharge_kw ?? 0;
  const batterySub =
    bChg > 0.05 ? `Charging ${kw(bChg)} kW` : bDis > 0.05 ? `Discharging ${kw(bDis)} kW` : "Idle";

  const gImp = latest?.grid_import_kw ?? 0;
  const gExp = latest?.grid_export_kw ?? 0;
  const gridValue = gImp > 0.05 ? kw(gImp) : gExp > 0.05 ? kw(gExp) : "0.0";
  const gridSub = gImp > 0.05 ? "Importing" : gExp > 0.05 ? "Exporting" : "Balanced";
  const gridColor = gImp > 0.05 ? C.grid : gExp > 0.05 ? C.battery : undefined;

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
          <AutoRefresh seconds={30} currentTs={latest?.ts ?? null} />
          <Link href="/experiments/homeenergy/settings" className="hover:text-foreground transition-colors">
            Settings
          </Link>
          <span className="hidden sm:inline">Home Energy</span>
        </div>
      </header>

      <section className="px-6 sm:px-12 pt-12 sm:pt-16 pb-8 max-w-5xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">
          Logs · Live
        </div>
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-[-0.03em] leading-[0.9]">
          Home Energy
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted leading-relaxed">
          Live from 36 Australis Dr — two solar arrays (12.8 kW), a 10 kWh battery, and the grid,
          combined into one view.
        </p>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          {hasData ? (
            <>
              Updated {latest!.local_time} · sources {latest!.sources || "—"} · now {nowTime}
            </>
          ) : (
            <>Waiting for the first reading… · now {nowTime}</>
          )}
        </p>
      </section>

      {!hasData ? (
        <section className="px-6 sm:px-12 py-16 border-t border-rule">
          <p className="text-muted">
            No readings yet. Once the collector posts its first sample it will appear here and
            refresh every minute.
          </p>
        </section>
      ) : (
        <>
          {/* Live tiles */}
          <section className="border-t border-rule px-6 sm:px-12">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 divide-rule">
              <Tile
                label="Solar now"
                value={kw(latest!.solar_total_kw)}
                unit="kW"
                color={C.solar}
                sub={`New ${kw(latest!.solar_new_kw)} + old ${kw(latest!.solar_old_kw)} kW`}
              />
              <Tile
                label="Battery"
                value={pct(latest!.battery_soc)}
                color={C.battery}
                sub={batterySub}
              />
              <Tile label="Grid" value={gridValue} unit="kW" color={gridColor} sub={gridSub} />
              <Tile
                label="House load"
                value={kw(latest!.house_kw)}
                unit="kW"
                sub="Whole-home consumption"
              />
            </div>
            {/* battery bar */}
            <div className="pb-8 -mt-2">
              <div className="h-1.5 w-full max-w-xs rounded-full bg-rule overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${latest!.battery_soc ?? 0}%`, background: C.battery }}
                />
              </div>
            </div>
          </section>

          {/* Today totals */}
          <section className="border-t border-rule px-6 sm:px-12">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-8 divide-rule">
              <Stat label="Generated" value={`${kwh(generated)}`} sub="kWh today" />
              <Stat label="Consumed" value={`${kwh(consumed)}`} sub="kWh today" />
              <Stat label="Self-powered" value={pct(selfPowered)} sub="of consumption" />
              <Stat label="Imported" value={`${kwh(imported)}`} sub="kWh from grid" />
              <Stat label="Exported" value={`${kwh(exported)}`} sub="kWh to grid" />
              <Stat label="Grid cost" value={money(cost.net)} sub="est. today (ToU)" />
            </div>
          </section>

          {/* Chart */}
          <section className="border-t border-rule px-6 sm:px-12 py-10">
            <div className="flex items-center gap-6 mb-6 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-2" style={{ background: C.solar }} /> Solar
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-0.5" style={{ background: C.house }} /> House
              </span>
              <span className="ml-auto normal-case tracking-normal text-muted">Today · kW</span>
            </div>
            <PowerChart series={series} />
          </section>

          {/* Grid reliance */}
          <section className="border-t border-rule px-6 sm:px-12 py-10">
            <div className="flex items-center gap-6 mb-6 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-2" style={{ background: C.battery }} /> Self · solar+battery
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-2" style={{ background: C.grid }} /> Grid
              </span>
              <span className="ml-auto normal-case tracking-normal text-muted">Consumption today · kW</span>
            </div>
            <GridRelianceChart series={series} tariff={tariff} />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 mt-8">
              <Stat label="Grid-powered" value={pct(gridShare)} sub="of consumption today" />
              <Stat
                label="Peak-window grid"
                value={kwh(cost.peakKwh)}
                sub={`kWh @ $${tariff.peakRate.toFixed(3)}`}
              />
              <Stat
                label="Busiest moment"
                value={busiest ? `${kw(busiest.kw)} kW` : "—"}
                sub={busiest ? `at ${busiest.time}` : undefined}
              />
            </div>
          </section>

          {/* Per-array breakdown */}
          <section className="border-t border-rule px-6 sm:px-12 py-10">
            <div className="grid sm:grid-cols-2 gap-8">
              <div className="flex flex-col gap-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                  New array · Anker SOLIX X1 · 6.16 kW
                </div>
                <div className="text-3xl font-semibold" style={{ color: C.solar }}>
                  {kw(latest!.solar_new_kw)} <span className="text-sm text-muted">kW now</span>
                </div>
                <div className="text-sm text-muted">
                  {kwh(latest!.solar_new_kwh_today)} kWh today · battery {pct(latest!.battery_soc)}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                  Original array · Growatt · 6.6 kW
                </div>
                <div className="text-3xl font-semibold" style={{ color: C.solar }}>
                  {kw(latest!.solar_old_kw)} <span className="text-sm text-muted">kW now</span>
                </div>
                <div className="text-sm text-muted">
                  {kwh(latest!.solar_old_kwh_today)} kWh today
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Tesla charging history */}
      {charges.totalSessions > 0 && (
        <section className="border-t border-rule px-6 sm:px-12 py-10">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-2">
            Vehicle · Charging history
          </div>
          <p className="text-sm text-muted mb-6 max-w-xl">
            Imported from Tessie · {charges.first} to {charges.last}. Live charge power vs. solar
            arrives once the Tesla Fleet API is connected.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 mb-8">
            <Stat label="Sessions" value={String(charges.totalSessions)} />
            <Stat
              label="At home"
              value={`${Math.round((charges.homeSessions / charges.totalSessions) * 100)}%`}
              sub={`${charges.homeSessions} of ${charges.totalSessions}`}
            />
            <Stat label="Energy added" value={`${Math.round(charges.totalKwh).toLocaleString()} kWh`} sub={`${Math.round(charges.homeKwh).toLocaleString()} kWh at home`} />
            <Stat label="Total spent" value={money(charges.totalCost)} sub="on charging (all locations)" />
          </div>
          <div className="flex items-center gap-6 mb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            <span className="flex items-center gap-2">
              <span className="inline-block w-3 h-2" style={{ background: C.battery }} /> At home
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block w-3 h-2" style={{ background: C.grid }} /> Away
            </span>
            <span className="ml-auto normal-case tracking-normal text-muted">Monthly kWh added</span>
          </div>
          <ChargeHistoryChart byMonth={charges.byMonth} />
        </section>
      )}

      <footer className="border-t border-rule px-6 sm:px-12 py-8 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        <Link href="/experiments" className="hover:text-foreground transition-colors">
          ← Experiments
        </Link>
      </footer>
    </div>
  );
}
