"use client";

import { useRef, useState } from "react";
import { bandRanges } from "@/lib/energy";
import type { ChargeSession, DailyTotal, Reading, Tariff, TeslaSample } from "@/lib/energy";
import { C } from "@/lib/colors";

export { C };


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

/** Tick spacing (minutes) that keeps the axis readable as the visible window
 * narrows — down to 5-minute marks when zoomed right in, since the underlying
 * samples are ~1 minute apart. */
function tickStepFor(spanMin: number): number {
  if (spanMin <= 30) return 5;
  if (spanMin <= 60) return 10;
  if (spanMin <= 120) return 15;
  if (spanMin <= 240) return 30;
  if (spanMin <= 480) return 60;
  if (spanMin <= 960) return 120;
  return 240;
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

// ---------- Day-mode chart (one merged view, x = minutes of day) ----------

/**
 * The single live view for a day. Three series, all on one kW axis:
 *
 *   • red    — Tesla charging
 *   • orange — grid draw, flipping GREEN and going NEGATIVE while exporting
 *   • blue   — home consumption EXCLUDING the car, so the car's draw isn't
 *              counted twice when you read the two together
 *   • violet — battery: ABOVE zero while it powers the house, BELOW zero
 *              while it charges (same sign convention as the grid line)
 *
 * Solar sits behind as a faint yellow area purely for context — without it the
 * grid line dipping negative has no visible cause.
 *
 * Sample spacing is whatever the collector recorded (~1 min while it's
 * running); the axis and hover snap to real samples rather than interpolating,
 * so gaps stay visible instead of being smoothed over.
 */
export function LiveChartDay({
  series,
  sessions,
  tariff,
  teslaSamples = [],
}: {
  series: Reading[];
  sessions: ChargeSession[];
  tariff: Tariff;
  /** Live Fleet API samples. When present these are used for the charging line
   * instead of `sessions`, giving actual measured power per sample rather than
   * a session average held flat. */
  teslaSamples?: TeslaSample[];
}) {
  const W = 920;
  const H = 300;
  const padL = 10;
  const padR = 10;
  const padT = 18;
  const padB = 26;
  const { svgRef, domain, isZoomed, resetZoom, bind, hoverMin, dragPreviewVX } =
    useDayChartInteraction(W, padL, padR);

  // Tesla charging power per minute-of-day, expanded from session windows.
  // Live per-minute charge power needs the Tesla Fleet API; until that's
  // connected this is each completed session's average power (energy ÷
  // duration) held flat across the session, which is why it reads as steps.
  // Live samples, keyed by minute-of-day, for nearest-sample lookup.
  const livePoints = teslaSamples
    .filter((s) => s.at_home !== 0)
    .map((s) => ({
      min: minutesOfDayLocal(s.local_time),
      // Only count power while the car says it is actually charging. A plugged-in
      // but idle car reports a small non-zero charge_power_kw (observed 1 kW at
      // "Stopped" with zero energy added), which would otherwise draw a phantom
      // charging line.
      kw: s.charging_state === "Charging" ? (s.charge_power_kw ?? 0) : 0,
    }))
    .sort((a, b) => a.min - b.min);
  const hasLive = livePoints.length > 0;

  const chargeAt = (min: number): number => {
    if (hasLive) {
      // Snap to the closest live sample within ~6 min (one collector cycle);
      // beyond that treat it as no data rather than smearing a stale value.
      let best: { min: number; kw: number } | null = null;
      for (const p of livePoints) {
        if (best === null || Math.abs(p.min - min) < Math.abs(best.min - min)) best = p;
      }
      return best && Math.abs(best.min - min) <= 6 ? best.kw : 0;
    }
    for (const s of sessions) {
      if (s.avgPowerKw == null) continue;
      const start = new Date(s.started_ts * 1000);
      const end = new Date((s.ended_ts ?? s.started_ts) * 1000);
      const a = start.getHours() * 60 + start.getMinutes();
      let b = end.getHours() * 60 + end.getMinutes();
      if (b < a) b = 1440; // ran past local midnight
      if (min >= a && min <= b) return s.avgPowerKw;
    }
    return 0;
  };

  const pts = series
    .map((r) => {
      const min = minutesOfDayLocal(r.local_time);
      const house = r.house_kw ?? 0;
      // The house meter includes the car, so the car can never exceed it. Tesla
      // samples are up to 5 min apart against the meter's ~1 min, so without
      // this a just-ended charge draws above the house line.
      const tesla = Math.min(chargeAt(min), Math.max(0, house));
      // Positive = importing, negative = exporting.
      const grid = Math.max(0, r.grid_import_kw ?? 0) - Math.max(0, r.grid_export_kw ?? 0);
      const bChg = Math.max(0, r.battery_charge_kw ?? 0);
      const bDis = Math.max(0, r.battery_discharge_kw ?? 0);
      const solar = r.solar_total_kw ?? 0;
      return {
        min,
        time: r.local_time,
        tesla,
        grid,
        // Positive = battery powering the house, negative = battery charging.
        battery: bDis - bChg,
        bChg,
        bDis,
        // Whether a charge is being covered by solar. Anker only splits
        // solar-vs-grid charging in DAILY totals, not per sample, so this
        // compares instantaneous solar against the charge rate instead of
        // claiming a measured split.
        chargeFromSolar: bChg > 0.05 ? solar >= bChg - 0.05 : null,
        // Never let rounding push this below zero.
        houseExclTesla: Math.max(0, house - tesla),
        house,
        solar,
      };
    })
    .sort((a, b) => a.min - b.min);

  const inView = pts.filter((p) => p.min >= domain[0] && p.min <= domain[1]);
  const scaleSet = inView.length ? inView : pts;

  const ymax =
    Math.max(
      1,
      ...scaleSet.map((p) => Math.max(p.tesla, p.grid, p.houseExclTesla, p.solar, p.battery)),
    ) * 1.12;
  // Only give up axis room to negatives if something actually went negative
  // (grid exporting, or the battery charging).
  const minNeg = Math.min(0, ...scaleSet.map((p) => Math.min(p.grid, p.battery)));
  const ymin = minNeg < 0 ? minNeg * 1.15 : 0;

  const x = (min: number) => padL + ((min - domain[0]) / (domain[1] - domain[0])) * (W - padL - padR);
  const y = (v: number) => H - padB - ((v - ymin) / (ymax - ymin)) * (H - padT - padB);
  const zeroY = y(0);

  const linePath = (key: "tesla" | "grid" | "houseExclTesla" | "solar" | "battery") =>
    pts.length
      ? pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.min)} ${y(p[key])}`).join(" ")
      : "";

  const solarArea = pts.length
    ? `M ${x(pts[0].min)} ${zeroY} ` +
      pts.map((p) => `L ${x(p.min)} ${y(p.solar)}`).join(" ") +
      ` L ${x(pts[pts.length - 1].min)} ${zeroY} Z`
    : "";

  // The grid line is drawn per-segment so it can switch colour at zero
  // (orange while importing, green while exporting).
  const gridSegments = pts.slice(1).map((p, i) => {
    const prev = pts[i];
    const exporting = (p.grid + prev.grid) / 2 < 0;
    return {
      d: `M ${x(prev.min)} ${y(prev.grid)} L ${x(p.min)} ${y(p.grid)}`,
      color: exporting ? C.export : C.grid,
      key: `${prev.min}-${p.min}`,
    };
  });

  // Shaded price windows. Off-peak is the unshaded residual, so it needs no band.
  const peakBands = bandRanges("peak", tariff);
  const shoulderBands = bandRanges("shoulder", tariff);

  const nearest =
    hoverMin == null || pts.length === 0
      ? null
      : pts.reduce((a, b) => (Math.abs(b.min - hoverMin) < Math.abs(a.min - hoverMin) ? b : a));

  // Gridline values, always including zero so the export boundary is obvious.
  const yTicks = Array.from(new Set([ymin, 0, ymax / 2, ymax].filter((v) => v >= ymin && v <= ymax)));

  return (
    <div className="relative">
      <ZoomControls isZoomed={isZoomed} onReset={resetZoom} />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none cursor-crosshair"
        role="img"
        aria-label="Live power: Tesla charging, grid, and home consumption"
        {...bind}
      >
        {shoulderBands.map(([s, e], i) => (
          <rect
            key={`sh-${i}`}
            x={x(s)}
            y={padT}
            width={Math.max(0, x(e) - x(s))}
            height={H - padB - padT}
            fill={C.export}
            fillOpacity={0.05}
          />
        ))}
        {peakBands.map(([s, e], i) => (
          <rect
            key={`pk-${i}`}
            x={x(s)}
            y={padT}
            width={Math.max(0, x(e) - x(s))}
            height={H - padB - padT}
            fill={C.solar}
            fillOpacity={0.06}
          />
        ))}
        {shoulderBands.length > 0 && (
          <text
            x={x((shoulderBands[0][0] + shoulderBands[0][1]) / 2)}
            y={padT + 11}
            fill={C.export}
            fillOpacity={0.55}
            fontSize={9}
            textAnchor="middle"
            fontFamily="var(--font-geist-mono)"
          >
            SHOULDER
          </text>
        )}
        {peakBands.length > 0 && (
          <text
            x={x((peakBands[0][0] + peakBands[0][1]) / 2)}
            y={padT + 11}
            fill={C.solar}
            fillOpacity={0.6}
            fontSize={9}
            textAnchor="middle"
            fontFamily="var(--font-geist-mono)"
          >
            PEAK
          </text>
        )}

        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(v)}
              y2={y(v)}
              stroke={Math.abs(v) < 1e-9 ? "#3f3f3f" : "#1f1f1f"}
              strokeWidth={1}
            />
            <text
              x={padL}
              y={y(v) - 4}
              fill="#737373"
              fontSize={10}
              fontFamily="var(--font-geist-mono)"
            >
              {v.toFixed(1)} kW
            </text>
          </g>
        ))}

        {ticksFor(domain).map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={padT}
              y2={H - padB}
              stroke="#1f1f1f"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
            <text
              x={x(t)}
              y={H - 8}
              fill="#737373"
              fontSize={10}
              textAnchor="middle"
              fontFamily="var(--font-geist-mono)"
            >
              {minToTime(t)}
            </text>
          </g>
        ))}

        {/* solar, faint, purely as context for why grid goes negative */}
        {solarArea && <path d={solarArea} fill={C.solar} fillOpacity={0.1} stroke="none" />}
        {pts.length > 1 && (
          <path d={linePath("solar")} fill="none" stroke={C.solar} strokeOpacity={0.35} strokeWidth={1} />
        )}

        {gridSegments.map((s) => (
          <path key={s.key} d={s.d} fill="none" stroke={s.color} strokeWidth={1.75} />
        ))}

        {pts.length > 1 && (
          <path d={linePath("battery")} fill="none" stroke={C.battery} strokeWidth={1.75} />
        )}
        {pts.length > 1 && (
          <path d={linePath("houseExclTesla")} fill="none" stroke={C.house} strokeWidth={1.75} />
        )}
        {pts.length > 1 && (
          <path d={linePath("tesla")} fill="none" stroke={C.charge} strokeWidth={1.75} />
        )}

        {/* single-sample day: dots, since a line needs two points */}
        {pts.length === 1 && (
          <>
            <circle cx={x(pts[0].min)} cy={y(pts[0].grid)} r={3} fill={pts[0].grid < 0 ? C.export : C.grid} />
            <circle cx={x(pts[0].min)} cy={y(pts[0].houseExclTesla)} r={3} fill={C.house} />
            {pts[0].tesla > 0 && <circle cx={x(pts[0].min)} cy={y(pts[0].tesla)} r={3} fill={C.charge} />}
          </>
        )}

        {nearest && (
          <>
            <line
              x1={x(nearest.min)}
              x2={x(nearest.min)}
              y1={padT}
              y2={H - padB}
              stroke="#737373"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <circle cx={x(nearest.min)} cy={y(nearest.grid)} r={3.5} fill={nearest.grid < 0 ? C.export : C.grid} />
            <circle cx={x(nearest.min)} cy={y(nearest.houseExclTesla)} r={3.5} fill={C.house} />
            {Math.abs(nearest.battery) > 0.05 && (
              <circle cx={x(nearest.min)} cy={y(nearest.battery)} r={3.5} fill={C.battery} />
            )}
            {nearest.tesla > 0 && <circle cx={x(nearest.min)} cy={y(nearest.tesla)} r={3.5} fill={C.charge} />}
          </>
        )}

        {dragPreviewVX && (
          <rect
            x={dragPreviewVX[0]}
            y={padT}
            width={dragPreviewVX[1] - dragPreviewVX[0]}
            height={H - padB - padT}
            fill="#f5f5f4"
            fillOpacity={0.1}
          />
        )}
      </svg>

      {nearest && !dragPreviewVX && (
        <Tooltip leftPct={(x(nearest.min) / W) * 100}>
          <div className="text-foreground mb-1">{nearest.time}</div>
          <TipRow color={C.charge} label="Tesla" value={`${fmt2(nearest.tesla)} kW`} />
          <TipRow
            color={nearest.grid < 0 ? C.export : C.grid}
            label={nearest.grid < 0 ? "Exporting" : "Grid"}
            value={`${fmt2(Math.abs(nearest.grid))} kW`}
          />
          <TipRow color={C.house} label="Home (excl. car)" value={`${fmt2(nearest.houseExclTesla)} kW`} />
          <TipRow
            color={C.battery}
            label={
              nearest.bDis > 0.05
                ? "Battery → home"
                : nearest.bChg > 0.05
                  ? nearest.chargeFromSolar
                    ? "Charging (solar)"
                    : "Charging (some grid)"
                  : "Battery idle"
            }
            value={`${fmt2(Math.abs(nearest.battery))} kW`}
          />
          <TipRow color={C.solar} label="Solar" value={`${fmt2(nearest.solar)} kW`} />
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

/** Range view as lines (default): one line per series across the days. */
export function RangeLineChart({ daily }: { daily: DailyTotal[] }) {
  const W = 920;
  const H = 240;
  const padL = 10;
  const padR = 10;
  const padT = 18;
  const padB = 28;
  const n = daily.length;
  const { svgRef, hoverX, bind } = useChartHover(W);
  if (n === 0) return <p className="text-muted text-sm">No data in this range.</p>;

  const series = [
    { key: "consumedKwh" as const, label: "Consumed", color: C.house },
    { key: "generatedKwh" as const, label: "Generated", color: C.solar },
    { key: "gridImportKwh" as const, label: "Grid import", color: C.grid },
    { key: "homeChargeKwh" as const, label: "Tesla", color: C.charge },
  ];
  const ymax = Math.max(1, ...daily.flatMap((d) => series.map((s) => d[s.key]))) * 1.15;
  const bw = (W - padL - padR) / n;
  const xCenter = (i: number) => (n === 1 ? W / 2 : padL + i * bw + bw / 2);
  const y = (v: number) => H - padB - (v / ymax) * (H - padT - padB);

  const path = (key: (typeof series)[number]["key"]) =>
    daily.map((d, i) => `${i === 0 ? "M" : "L"} ${xCenter(i)} ${y(d[key])}`).join(" ");

  const nearestIdx =
    hoverX == null ? null : Math.min(n - 1, Math.max(0, Math.round((hoverX - padL) / bw - 0.5)));
  const nearest = nearestIdx == null ? null : daily[nearestIdx];

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Energy by day" {...bind}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={padL} x2={W - padR} y1={y(ymax * f)} y2={y(ymax * f)} stroke="#1f1f1f" strokeWidth={1} />
        ))}
        {[0, 0.5, 1].map((f) => (
          <text key={`l${f}`} x={padL} y={y(ymax * f) - 4} fill="#737373" fontSize={10} fontFamily="var(--font-geist-mono)">
            {Math.round(ymax * f)} kWh
          </text>
        ))}
        {series.map((s) => (
          <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={1.75} strokeLinejoin="round" />
        ))}
        {nearest && nearestIdx != null && (
          <>
            <line x1={xCenter(nearestIdx)} x2={xCenter(nearestIdx)} y1={padT} y2={y(0)} stroke="#737373" strokeWidth={1} strokeDasharray="2 3" />
            {series.map((s) => (
              <circle key={s.key} cx={xCenter(nearestIdx)} cy={y(nearest[s.key])} r={3} fill={s.color} />
            ))}
          </>
        )}
        <DayLabels dates={daily.map((d) => d.date)} x={xCenter} H={H} padB={padB} />
      </svg>
      {nearest && nearestIdx != null && (
        <Tooltip leftPct={(xCenter(nearestIdx) / W) * 100}>
          <div className="text-foreground mb-1">{nearest.date}</div>
          {series.map((s) => (
            <TipRow key={s.key} color={s.color} label={s.label} value={`${fmt2(nearest[s.key])} kWh`} />
          ))}
        </Tooltip>
      )}
    </div>
  );
}

/** Range chart with a Line (default) / Bar view toggle. Pure client state, so
 * switching is instant and never navigates or scrolls the page. */
export function RangeChart({ daily }: { daily: DailyTotal[] }) {
  const [mode, setMode] = useState<"line" | "bar">("line");
  const legend =
    mode === "line"
      ? [
          { c: C.house, t: "Consumed" },
          { c: C.solar, t: "Generated" },
          { c: C.grid, t: "Grid import" },
          { c: C.charge, t: "Tesla" },
        ]
      : [
          { c: C.self, t: "Self · solar+battery" },
          { c: C.grid, t: "Grid" },
          { c: C.charge, t: "Tesla charging" },
        ];
  const tab = (m: "line" | "bar", label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`px-2.5 py-1 border transition-colors ${
        mode === m ? "border-foreground text-foreground" : "border-rule text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted flex-wrap">
        <div className="flex items-center gap-1">
          {tab("line", "Line")}
          {tab("bar", "Bar")}
        </div>
        {legend.map((l) => (
          <span key={l.t} className="flex items-center gap-2">
            <span className="inline-block w-3 h-0.5" style={{ background: l.c }} /> {l.t}
          </span>
        ))}
        <span className="ml-auto normal-case tracking-normal text-muted">kWh/day</span>
      </div>
      {mode === "line" ? (
        <RangeLineChart daily={daily} />
      ) : (
        <div className="flex flex-col gap-6">
          <GridRelianceChartRange daily={daily} />
          <PowerChartRange daily={daily} />
        </div>
      )}
    </div>
  );
}

function minutesOfDayLocal(localTime: string): number {
  const [hh, mm] = localTime.split(":").map(Number);
  return hh * 60 + mm;
}

// ---------- Share-of-consumption bar ----------

export type ShareSlice = { label: string; kwh: number; color: string; note?: string };

/**
 * Horizontal bar showing what share of the period's consumption came from each
 * source, with grid split by tariff. Hovering a segment surfaces its exact kWh
 * and share; the legend below always lists them too, so the information isn't
 * hover-only.
 */
export function ShareBar({ slices }: { slices: ShareSlice[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = slices.filter((s) => s.kwh > 0);
  const total = shown.reduce((sum, s) => sum + s.kwh, 0);
  if (total <= 0) return <p className="text-sm text-muted">No consumption recorded yet.</p>;

  const pct = (v: number) => (v / total) * 100;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <div className="flex h-8 w-full overflow-hidden bg-rule">
          {shown.map((s, i) => (
            <div
              key={s.label}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className="transition-opacity cursor-default"
              style={{
                width: `${pct(s.kwh)}%`,
                background: s.color,
                opacity: hover === null || hover === i ? 1 : 0.4,
              }}
            />
          ))}
        </div>
        {hover !== null && shown[hover] && (
          <div
            className="absolute -top-1 -translate-y-full -translate-x-1/2 bg-background border border-rule px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] whitespace-nowrap pointer-events-none z-10 shadow-lg"
            style={{
              left: `${
                shown.slice(0, hover).reduce((a, s) => a + pct(s.kwh), 0) + pct(shown[hover].kwh) / 2
              }%`,
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ background: shown[hover].color }}
              />
              <span className="text-muted">{shown[hover].label}</span>
              <span className="text-foreground ml-1">
                {pct(shown[hover].kwh).toFixed(1)}% · {shown[hover].kwh.toFixed(1)} kWh
              </span>
            </div>
            {shown[hover].note && (
              <div className="mt-1 text-muted/80 normal-case tracking-normal">
                {shown[hover].note}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-2">
        {shown.map((s) => (
          <div key={s.label} className="flex items-baseline gap-2">
            <span className="inline-block w-2 h-2 shrink-0 translate-y-[-1px]" style={{ background: s.color }} />
            <span className="text-sm text-muted">{s.label}</span>
            <span className="font-mono text-xs text-foreground/90">
              {Math.round(pct(s.kwh))}% · {s.kwh.toFixed(1)} kWh
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
