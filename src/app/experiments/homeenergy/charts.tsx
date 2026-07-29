"use client";

import { useRef, useState } from "react";
import type { ChargeSession, DailyTotal, Reading, Tariff } from "@/lib/energy";

export const C = {
  solar: "#f5b301", // yellow — solar generation
  battery: "#60a5fa", // blue — battery state of charge
  self: "#4ade80", // green — load covered by own solar/battery, and grid export
  grid: "#f87171", // red — load drawn from the grid
  house: "#fb923c", // orange — whole-home consumption
  charge: "#c084fc", // violet — Tesla charging (kept clear of battery blue)
};

const fmt2 = (n: number) => n.toFixed(2);
const minToTime = (min: number) => {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/** Tracks mouse position over an SVG (in its own viewBox units) for hover
 * readouts. Attach `bind` to the <svg>'s event handlers and `svgRef` to it. */
function useChartHover(viewBoxWidth: number) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const bind = {
    onMouseMove: (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const scale = viewBoxWidth / rect.width;
      setHoverX((e.clientX - rect.left) * scale);
    },
    onMouseLeave: () => setHoverX(null),
    onTouchMove: (e: React.TouchEvent<SVGSVGElement>) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const t = e.touches[0];
      if (!rect || !t || rect.width === 0) return;
      const scale = viewBoxWidth / rect.width;
      setHoverX((t.clientX - rect.left) * scale);
    },
    onTouchEnd: () => setHoverX(null),
  };
  return { svgRef, hoverX, bind };
}

const FULL_DAY: [number, number] = [0, 1440];

/** Tick spacing (minutes) that keeps the axis readable as the visible
 * window narrows — down to 30-minute intervals when zoomed in tight. */
function tickStepFor(spanMin: number): number {
  if (spanMin <= 180) return 30;
  if (spanMin <= 360) return 60;
  if (spanMin <= 720) return 120;
  if (spanMin <= 1440) return 240;
  return 360;
}

function ticksFor(domain: [number, number]): number[] {
  const step = tickStepFor(domain[1] - domain[0]);
  const first = Math.ceil(domain[0] / step) * step;
  const ticks: number[] = [];
  for (let t = first; t <= domain[1]; t += step) ticks.push(t);
  return ticks;
}

/**
 * Combines hover-readout with drag-to-zoom for the day-mode (time-of-day)
 * charts: drag across a region to zoom into it (down to 30-min granularity),
 * click "Reset zoom" (rendered by the caller) to return to the full day.
 */
function useDayChartInteraction(W: number, padL: number, padR: number) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [domain, setDomain] = useState<[number, number]>(FULL_DAY);
  const [hoverVX, setHoverVX] = useState<number | null>(null);
  const [dragAnchorVX, setDragAnchorVX] = useState<number | null>(null);

  const toVX = (clientX: number): number | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return (clientX - rect.left) * (W / rect.width);
  };
  const vxToMin = (vx: number) => domain[0] + ((vx - padL) / (W - padL - padR)) * (domain[1] - domain[0]);

  const commitDrag = (anchorVX: number | null, endVX: number | null) => {
    if (anchorVX == null || endVX == null) return;
    const loMin = Math.min(vxToMin(anchorVX), vxToMin(endVX));
    const hiMin = Math.max(vxToMin(anchorVX), vxToMin(endVX));
    if (hiMin - loMin >= 15) {
      setDomain([Math.max(0, Math.floor(loMin)), Math.min(1440, Math.ceil(hiMin))]);
    }
  };

  const bind = {
    onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => {
      const vx = toVX(e.clientX);
      if (vx != null) {
        setDragAnchorVX(vx);
        setHoverVX(vx);
      }
    },
    onMouseMove: (e: React.MouseEvent<SVGSVGElement>) => {
      const vx = toVX(e.clientX);
      if (vx != null) setHoverVX(vx);
    },
    onMouseUp: () => {
      commitDrag(dragAnchorVX, hoverVX);
      setDragAnchorVX(null);
    },
    onMouseLeave: () => {
      setDragAnchorVX(null);
      setHoverVX(null);
    },
    onTouchStart: (e: React.TouchEvent<SVGSVGElement>) => {
      const t = e.touches[0];
      const vx = t ? toVX(t.clientX) : null;
      if (vx != null) {
        setDragAnchorVX(vx);
        setHoverVX(vx);
      }
    },
    onTouchMove: (e: React.TouchEvent<SVGSVGElement>) => {
      const t = e.touches[0];
      const vx = t ? toVX(t.clientX) : null;
      if (vx != null) setHoverVX(vx);
    },
    onTouchEnd: () => {
      commitDrag(dragAnchorVX, hoverVX);
      setDragAnchorVX(null);
    },
  };

  const isDragging = dragAnchorVX != null;
  const hoverMin = !isDragging && hoverVX != null ? vxToMin(hoverVX) : null;
  const dragPreviewVX: [number, number] | null =
    isDragging && hoverVX != null ? [Math.min(dragAnchorVX!, hoverVX), Math.max(dragAnchorVX!, hoverVX)] : null;

  return {
    svgRef,
    domain,
    isZoomed: domain[0] !== FULL_DAY[0] || domain[1] !== FULL_DAY[1],
    resetZoom: () => setDomain(FULL_DAY),
    bind,
    hoverMin,
    dragPreviewVX,
  };
}

function ZoomControls({ isZoomed, onReset }: { isZoomed: boolean; onReset: () => void }) {
  return (
    <div className="absolute top-1 right-1 z-10 font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
      {isZoomed ? (
        <button
          type="button"
          onClick={onReset}
          className="pointer-events-auto bg-background border border-rule px-2 py-1 hover:text-foreground hover:border-foreground transition-colors"
        >
          Reset zoom ↺
        </button>
      ) : (
        <span className="pointer-events-none opacity-60">Drag to zoom</span>
      )}
    </div>
  );
}

function Tooltip({ leftPct, children }: { leftPct: number; children: React.ReactNode }) {
  const clamped = Math.min(94, Math.max(6, leftPct));
  return (
    <div
      className="absolute top-1 -translate-x-1/2 bg-background border border-rule px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] pointer-events-none whitespace-nowrap z-10 shadow-lg"
      style={{ left: `${clamped}%` }}
    >
      {children}
    </div>
  );
}

function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-muted">{label}</span>
      <span className="text-foreground ml-2">{value}</span>
    </div>
  );
}

// ---------- Day-mode charts (per-5-min series, x = minutes of day) ----------

export function PowerChartDay({ series }: { series: Reading[] }) {
  const W = 920;
  const H = 240;
  const padL = 10;
  const padR = 10;
  const padT = 18;
  const padB = 24;
  const { svgRef, domain, isZoomed, resetZoom, bind, hoverMin, dragPreviewVX } = useDayChartInteraction(W, padL, padR);

  const pts = series
    .map((r) => ({ min: minutesOfDayLocal(r.local_time), solar: r.solar_total_kw ?? 0, house: r.house_kw ?? 0 }))
    .sort((a, b) => a.min - b.min);

  const visible = pts.filter((p) => p.min >= domain[0] && p.min <= domain[1]);
  const ymax = Math.max(1, ...(visible.length ? visible : pts).map((p) => Math.max(p.solar, p.house))) * 1.15;
  const x = (min: number) => padL + ((min - domain[0]) / (domain[1] - domain[0])) * (W - padL - padR);
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

  const nearest =
    hoverMin == null || pts.length === 0
      ? null
      : pts.reduce((a, b) => (Math.abs(b.min - hoverMin) < Math.abs(a.min - hoverMin) ? b : a));

  return (
    <div className="relative">
      <ZoomControls isZoomed={isZoomed} onReset={resetZoom} />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none cursor-crosshair"
        role="img"
        aria-label="Power today"
        {...bind}
      >
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={padL} x2={W - padR} y1={y(ymax * f)} y2={y(ymax * f)} stroke="#1f1f1f" strokeWidth={1} />
        ))}
        {[0, 0.5, 1].map((f) => (
          <text key={`l${f}`} x={padL} y={y(ymax * f) - 4} fill="#737373" fontSize={10} fontFamily="var(--font-geist-mono)">
            {(ymax * f).toFixed(1)} kW
          </text>
        ))}
        {ticksFor(domain).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={padT} y2={base} stroke="#1f1f1f" strokeWidth={1} strokeDasharray="2 4" />
            <text x={x(t)} y={H - 8} fill="#737373" fontSize={10} textAnchor="middle" fontFamily="var(--font-geist-mono)">
              {minToTime(t)}
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
        {nearest && (
          <>
            <line x1={x(nearest.min)} x2={x(nearest.min)} y1={padT} y2={base} stroke="#737373" strokeWidth={1} strokeDasharray="2 3" />
            <circle cx={x(nearest.min)} cy={y(nearest.solar)} r={3.5} fill={C.solar} />
            <circle cx={x(nearest.min)} cy={y(nearest.house)} r={3.5} fill={C.house} />
          </>
        )}
        {dragPreviewVX && (
          <rect x={dragPreviewVX[0]} y={padT} width={dragPreviewVX[1] - dragPreviewVX[0]} height={base - padT} fill="#f5f5f4" fillOpacity={0.1} />
        )}
      </svg>
      {nearest && !dragPreviewVX && (
        <Tooltip leftPct={(x(nearest.min) / W) * 100}>
          <div className="text-foreground mb-1">{minToTime(nearest.min)}</div>
          <TipRow color={C.solar} label="Solar" value={`${fmt2(nearest.solar)} kW`} />
          <TipRow color={C.house} label="House" value={`${fmt2(nearest.house)} kW`} />
        </Tooltip>
      )}
    </div>
  );
}

export function GridRelianceChartDay({
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
  const { svgRef, domain, isZoomed, resetZoom, bind, hoverMin, dragPreviewVX } = useDayChartInteraction(W, padL, padR);

  const pts = series
    .map((r) => {
      const house = r.house_kw ?? 0;
      const grid = Math.max(0, r.grid_import_kw ?? 0);
      return { min: minutesOfDayLocal(r.local_time), house, self: Math.max(0, house - grid), grid };
    })
    .sort((a, b) => a.min - b.min);

  const chargePts = sessions
    .filter((s) => s.avgPowerKw != null)
    .map((s) => {
      const start = new Date(s.started_ts * 1000);
      const end = new Date((s.ended_ts ?? s.started_ts) * 1000);
      const startMin = start.getHours() * 60 + start.getMinutes();
      let endMin = end.getHours() * 60 + end.getMinutes();
      if (endMin < startMin) endMin = 1440;
      return { startMin, endMin, kw: s.avgPowerKw as number };
    });

  const visible = pts.filter((p) => p.min >= domain[0] && p.min <= domain[1]);
  const visibleCharge = chargePts.filter((c) => c.endMin >= domain[0] && c.startMin <= domain[1]);
  const ymax =
    Math.max(1, ...(visible.length ? visible : pts).map((p) => p.house), ...visibleCharge.map((c) => c.kw)) * 1.15;
  const x = (min: number) => padL + ((min - domain[0]) / (domain[1] - domain[0])) * (W - padL - padR);
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

  const nearest =
    hoverMin == null || pts.length === 0
      ? null
      : pts.reduce((a, b) => (Math.abs(b.min - hoverMin) < Math.abs(a.min - hoverMin) ? b : a));
  const activeCharge =
    hoverMin == null ? null : chargePts.find((c) => hoverMin >= c.startMin && hoverMin <= c.endMin) ?? null;

  return (
    <div className="relative">
      <ZoomControls isZoomed={isZoomed} onReset={resetZoom} />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none cursor-crosshair"
        role="img"
        aria-label="Grid reliance"
        {...bind}
      >
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
        {ticksFor(domain).map((t) => (
          <text key={t} x={x(t)} y={H - 8} fill="#737373" fontSize={10} textAnchor="middle" fontFamily="var(--font-geist-mono)">
            {minToTime(t)}
          </text>
        ))}
        {greenArea && <path d={greenArea} fill={C.self} fillOpacity={0.5} stroke="none" />}
        {redBand && <path d={redBand} fill={C.grid} fillOpacity={0.5} stroke="none" />}
        {pts.length === 1 && (
          <>
            <rect x={x(pts[0].min) - 2} y={y(pts[0].self)} width={4} height={base - y(pts[0].self)} fill={C.self} />
            <rect x={x(pts[0].min) - 2} y={y(pts[0].house)} width={4} height={y(pts[0].self) - y(pts[0].house)} fill={C.grid} />
          </>
        )}
        {chargePts.map((c, i) => (
          <path key={i} d={`M ${x(c.startMin)} ${y(c.kw)} L ${x(c.endMin)} ${y(c.kw)}`} stroke={C.charge} strokeWidth={2.5} strokeLinecap="round" />
        ))}
        {nearest && (
          <>
            <line x1={x(nearest.min)} x2={x(nearest.min)} y1={padT} y2={base} stroke="#737373" strokeWidth={1} strokeDasharray="2 3" />
            <circle cx={x(nearest.min)} cy={y(nearest.self)} r={3.5} fill={C.self} />
            <circle cx={x(nearest.min)} cy={y(nearest.house)} r={3.5} fill={C.grid} />
          </>
        )}
        {dragPreviewVX && (
          <rect x={dragPreviewVX[0]} y={padT} width={dragPreviewVX[1] - dragPreviewVX[0]} height={base - padT} fill="#f5f5f4" fillOpacity={0.1} />
        )}
      </svg>
      {nearest && !dragPreviewVX && (
        <Tooltip leftPct={(x(nearest.min) / W) * 100}>
          <div className="text-foreground mb-1">{minToTime(nearest.min)}</div>
          <TipRow color={C.self} label="Self" value={`${fmt2(nearest.self)} kW`} />
          <TipRow color={C.grid} label="Grid" value={`${fmt2(nearest.grid)} kW`} />
          {activeCharge && <TipRow color={C.charge} label="Charging" value={`${fmt2(activeCharge.kw)} kW`} />}
        </Tooltip>
      )}
    </div>
  );
}

// ---------- Range-mode charts (one bar per day, x = date) ----------

function DayLabels({ dates, x, H, padB }: { dates: string[]; x: (i: number) => number; H: number; padB: number }) {
  const n = dates.length;
  const show = [0, Math.floor(n / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <>
      {show.map((i) => (
        <text key={i} x={x(i)} y={H - padB + 16} fill="#737373" fontSize={9} textAnchor="middle" fontFamily="var(--font-geist-mono)">
          {dates[i]?.slice(5)}
        </text>
      ))}
    </>
  );
}

export function PowerChartRange({ daily }: { daily: DailyTotal[] }) {
  const W = 920;
  const H = 240;
  const padL = 10;
  const padR = 10;
  const padT = 18;
  const padB = 28;
  const n = daily.length;
  const { svgRef, hoverX, bind } = useChartHover(W);
  if (n === 0) return <p className="text-muted text-sm">No data in this range.</p>;

  const ymax = Math.max(1, ...daily.map((d) => Math.max(d.generatedKwh, d.consumedKwh))) * 1.15;
  const bw = (W - padL - padR) / n;
  const xCenter = (i: number) => padL + i * bw + bw / 2;
  const y = (v: number) => H - padB - (v / ymax) * (H - padT - padB);
  const base = y(0);

  const linePath = daily.map((d, i) => `${i === 0 ? "M" : "L"} ${xCenter(i)} ${y(d.consumedKwh)}`).join(" ");

  const nearestIdx =
    hoverX == null ? null : Math.min(n - 1, Math.max(0, Math.round((hoverX - padL) / bw - 0.5)));
  const nearest = nearestIdx == null ? null : daily[nearestIdx];

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Generated vs consumed by day" {...bind}>
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
            fillOpacity={nearestIdx === i ? 0.7 : 0.45}
          />
        ))}
        <path d={linePath} fill="none" stroke={C.house} strokeOpacity={0.9} strokeWidth={1.75} />
        {nearest && nearestIdx != null && (
          <>
            <line x1={xCenter(nearestIdx)} x2={xCenter(nearestIdx)} y1={padT} y2={base} stroke="#737373" strokeWidth={1} strokeDasharray="2 3" />
            <circle cx={xCenter(nearestIdx)} cy={y(nearest.consumedKwh)} r={3.5} fill={C.house} />
          </>
        )}
        <DayLabels dates={daily.map((d) => d.date)} x={xCenter} H={H} padB={padB} />
      </svg>
      {nearest && nearestIdx != null && (
        <Tooltip leftPct={(xCenter(nearestIdx) / W) * 100}>
          <div className="text-foreground mb-1">{nearest.date}</div>
          <TipRow color={C.solar} label="Generated" value={`${fmt2(nearest.generatedKwh)} kWh`} />
          <TipRow color={C.house} label="Consumed" value={`${fmt2(nearest.consumedKwh)} kWh`} />
        </Tooltip>
      )}
    </div>
  );
}

export function GridRelianceChartRange({ daily }: { daily: DailyTotal[] }) {
  const W = 920;
  const H = 240;
  const padL = 10;
  const padR = 10;
  const padT = 18;
  const padB = 28;
  const n = daily.length;
  const { svgRef, hoverX, bind } = useChartHover(W);
  if (n === 0) return <p className="text-muted text-sm">No data in this range.</p>;

  const ymax = Math.max(1, ...daily.map((d) => d.selfKwh + d.gridImportKwh), ...daily.map((d) => d.homeChargeKwh)) * 1.15;
  const bw = (W - padL - padR) / n;
  const xCenter = (i: number) => padL + i * bw + bw / 2;
  const y = (v: number) => H - padB - (v / ymax) * (H - padT - padB);
  const base = y(0);

  const chargeLine = daily.map((d, i) => `${i === 0 ? "M" : "L"} ${xCenter(i)} ${y(d.homeChargeKwh)}`).join(" ");
  const hasCharging = daily.some((d) => d.homeChargeKwh > 0);

  const nearestIdx =
    hoverX == null ? null : Math.min(n - 1, Math.max(0, Math.round((hoverX - padL) / bw - 0.5)));
  const nearest = nearestIdx == null ? null : daily[nearestIdx];

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Grid reliance by day" {...bind}>
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
          const op = nearestIdx === i ? 0.7 : 0.5;
          return (
            <g key={d.date}>
              <rect x={bx} y={y(d.selfKwh)} width={bwid} height={base - y(d.selfKwh)} fill={C.self} fillOpacity={op} />
              <rect
                x={bx}
                y={y(d.selfKwh + d.gridImportKwh)}
                width={bwid}
                height={y(d.selfKwh) - y(d.selfKwh + d.gridImportKwh)}
                fill={C.grid}
                fillOpacity={op}
              />
            </g>
          );
        })}
        {hasCharging && <path d={chargeLine} fill="none" stroke={C.charge} strokeWidth={2} />}
        {hasCharging &&
          daily.map((d, i) => (d.homeChargeKwh > 0 ? <circle key={d.date} cx={xCenter(i)} cy={y(d.homeChargeKwh)} r={2.5} fill={C.charge} /> : null))}
        {nearest && nearestIdx != null && (
          <line x1={xCenter(nearestIdx)} x2={xCenter(nearestIdx)} y1={padT} y2={base} stroke="#737373" strokeWidth={1} strokeDasharray="2 3" />
        )}
        <DayLabels dates={daily.map((d) => d.date)} x={xCenter} H={H} padB={padB} />
      </svg>
      {nearest && nearestIdx != null && (
        <Tooltip leftPct={(xCenter(nearestIdx) / W) * 100}>
          <div className="text-foreground mb-1">{nearest.date}</div>
          <TipRow color={C.self} label="Self" value={`${fmt2(nearest.selfKwh)} kWh`} />
          <TipRow color={C.grid} label="Grid" value={`${fmt2(nearest.gridImportKwh)} kWh`} />
          <TipRow color={C.charge} label="Tesla" value={`${fmt2(nearest.homeChargeKwh)} kWh`} />
        </Tooltip>
      )}
    </div>
  );
}

function minutesOfDayLocal(localTime: string): number {
  const [hh, mm] = localTime.split(":").map(Number);
  return hh * 60 + mm;
}
