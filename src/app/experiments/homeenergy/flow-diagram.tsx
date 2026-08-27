"use client";

import { C } from "@/lib/colors";

/**
 * Live energy-flow diagram: a hub-and-spoke view of where power is moving right
 * now, with pulses travelling along each spoke.
 *
 * Modelled on the Anker app's home view, which Eric reads at a glance, but
 * extended to every source this dashboard knows about — Anker only sees its own
 * array, the battery, the grid and the house, so it can't show the original
 * Growatt array or the car.
 *
 * Two layouts share one renderer: a wide left→right strip on desktop, and a
 * compact radial (sources across the top, loads across the bottom) on mobile,
 * so a 375px screen doesn't shrink the wide frame down to unreadable text. CSS
 * picks one per breakpoint — both are in the DOM, no JS needed.
 *
 * Deliberately only draws what is actually measured. Per-sample the APIs report
 * an aggregate kW per source, NOT how it was routed, so each spoke carries one
 * signed magnitude and its direction comes from that sign.
 */

export type FlowInputs = {
  /** Anker array (#2), kW. */
  solarNewKw: number | null;
  /** Growatt array (#1), kW. Null when that inverter isn't reporting. */
  solarOldKw: number | null;
  /** Signed: positive = discharging to the house, negative = charging. */
  batteryKw: number;
  batterySoc: number | null;
  /** Signed: positive = importing, negative = exporting. */
  gridKw: number;
  /** Whole-house load, including the car. */
  houseKw: number;
  /** Live car charge power, 0 when not charging at home. */
  teslaKw: number;
  /** Shown under the Tesla node, e.g. "Charging" / "Complete". */
  teslaState: string | null;
};

type Pt = { x: number; y: number };
type Box = { w: number; h: number };
type Hub = Pt & Box;
type Layout = {
  vb: Box;
  box: Box;
  hub: Hub;
  solar: Pt;
  grid: Pt;
  battery: Pt;
  home: Pt;
  tesla: Pt;
  compact: boolean;
};

// Wide strip for desktop: supply on the left, total in the middle, loads right.
const WIDE: Layout = {
  vb: { w: 1000, h: 320 },
  box: { w: 168, h: 72 },
  hub: { x: 500, y: 158, w: 160, h: 78 },
  solar: { x: 90, y: 52 },
  grid: { x: 90, y: 158 },
  battery: { x: 90, y: 264 },
  home: { x: 910, y: 104 },
  tesla: { x: 910, y: 216 },
  compact: false,
};

// Radial for mobile: three sources across the top, total in the centre, two
// loads across the bottom — a near-square frame that fills a phone width at
// roughly 1:1, so the text stays legible.
const RADIAL: Layout = {
  vb: { w: 384, h: 470 },
  box: { w: 118, h: 66 },
  hub: { x: 192, y: 235, w: 150, h: 72 },
  solar: { x: 66, y: 55 },
  grid: { x: 192, y: 55 },
  battery: { x: 318, y: 55 },
  home: { x: 112, y: 415 },
  tesla: { x: 272, y: 415 },
  compact: true,
};

/** A spoke is "live" below this, in kW — under ~50 W is noise, not flow. */
const IDLE_KW = 0.05;

const fmtKw = (n: number) => (Math.abs(n) < IDLE_KW ? "0.0" : Math.abs(n).toFixed(1));

/** Pulse period for a given magnitude. Faster = more power. */
function pulseSeconds(kw: number): number {
  const frac = Math.min(1, Math.abs(kw) / 9);
  return 2.3 - 1.65 * frac; // 2.3s idle-ish -> 0.65s flat out
}

/** Line thickness scales with power so big flows read first. */
function pulseWidth(kw: number): number {
  return 2 + Math.min(1, Math.abs(kw) / 9) * 3.5;
}

/** Path from a node's edge to the hub's edge, along the line between centres,
 * trimmed by each box's half-extent (plus a gap) so a pulse never sits under
 * text. Works for any layout and either flow direction. */
function spokePath(n: Pt, box: Box, hub: Hub, gap = 6): string {
  const dx = hub.x - n.x;
  const dy = hub.y - n.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nHalf = Math.abs(ux) * (box.w / 2) + Math.abs(uy) * (box.h / 2) + gap;
  const hHalf = Math.abs(ux) * (hub.w / 2) + Math.abs(uy) * (hub.h / 2) + gap;
  return `M ${n.x + ux * nHalf} ${n.y + uy * nHalf} L ${hub.x - ux * hHalf} ${hub.y - uy * hHalf}`;
}

function Spoke({ d, kw, color, toHub }: { d: string; kw: number; color: string; toHub: boolean }) {
  const live = Math.abs(kw) >= IDLE_KW;
  return (
    <g>
      <path d={d} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth={2} />
      {live && (
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={pulseWidth(kw)}
          strokeLinecap="round"
          strokeDasharray="14 30"
          style={{
            animation: `${toHub ? "flowToHub" : "flowFromHub"} ${pulseSeconds(kw)}s linear infinite`,
          }}
        />
      )}
    </g>
  );
}

function Node({
  x,
  y,
  w,
  h,
  label,
  value,
  unit,
  sub,
  color,
  dim = false,
}: Pt &
  Box & {
    label: string;
    value: string;
    unit: string;
    sub?: string;
    color?: string;
    dim?: boolean;
  }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} fill="none" stroke="currentColor" strokeOpacity={0.22} />
      <text
        x={x}
        y={y - h / 2 + 18}
        textAnchor="middle"
        className="font-mono"
        fontSize={9.5}
        letterSpacing="2"
        fill="currentColor"
        opacity={0.55}
      >
        {label.toUpperCase()}
      </text>
      <text x={x} y={y + 8} textAnchor="middle" fill="currentColor">
        <tspan fontSize={26} fontWeight={550} fill={dim ? "currentColor" : (color ?? "currentColor")} opacity={dim ? 0.45 : 1}>
          {value}
        </tspan>
        <tspan fontSize={12} opacity={0.5} dx={4}>
          {unit}
        </tspan>
      </text>
      {sub && (
        <text x={x} y={y + h / 2 - 10} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.5}>
          {sub}
        </text>
      )}
    </g>
  );
}

function FlowSvg({ inputs, L }: { inputs: FlowInputs; L: Layout }) {
  const { solarNewKw, solarOldKw, batteryKw, batterySoc, gridKw, houseKw, teslaKw, teslaState } = inputs;
  const solarKw = (solarNewKw ?? 0) + (solarOldKw ?? 0);
  const houseExclTesla = Math.max(0, houseKw - teslaKw);
  const exporting = gridKw < -IDLE_KW;
  const charging = batteryKw < -IDLE_KW;

  const solarSub = L.compact
    ? `${fmtKw(solarNewKw ?? 0)} · ${solarOldKw == null ? "off" : fmtKw(solarOldKw)}`
    : solarOldKw == null
      ? `array 2 ${fmtKw(solarNewKw ?? 0)} · array 1 not reporting`
      : `array 2 ${fmtKw(solarNewKw ?? 0)} · array 1 ${fmtKw(solarOldKw)}`;

  return (
    <svg
      viewBox={`0 0 ${L.vb.w} ${L.vb.h}`}
      className="w-full h-auto text-foreground"
      role="img"
      aria-label={
        `Live energy flow. Solar ${fmtKw(solarKw)} kW. ` +
        `Grid ${exporting ? "exporting" : "importing"} ${fmtKw(gridKw)} kW. ` +
        `Battery ${charging ? "charging" : "discharging"} ${fmtKw(batteryKw)} kW at ${batterySoc ?? "unknown"}%. ` +
        `Total load ${fmtKw(houseKw)} kW, of which home ${fmtKw(houseExclTesla)} kW and car ${fmtKw(teslaKw)} kW.`
      }
    >
      <g data-flow-pulse>
        <Spoke d={spokePath(L.solar, L.box, L.hub)} kw={solarKw} color={C.solar} toHub />
        <Spoke d={spokePath(L.grid, L.box, L.hub)} kw={gridKw} color={exporting ? C.export : C.grid} toHub={!exporting} />
        <Spoke d={spokePath(L.battery, L.box, L.hub)} kw={batteryKw} color={C.battery} toHub={!charging} />
        <Spoke d={spokePath(L.home, L.box, L.hub)} kw={houseExclTesla} color={C.house} toHub={false} />
        <Spoke d={spokePath(L.tesla, L.box, L.hub)} kw={teslaKw} color={C.charge} toHub={false} />
      </g>

      <Node
        {...L.solar}
        {...L.box}
        label="Solar"
        value={solarKw < IDLE_KW ? "Standby" : fmtKw(solarKw)}
        unit={solarKw < IDLE_KW ? "" : "kW"}
        sub={solarSub}
        color={C.solar}
        dim={solarKw < IDLE_KW}
      />
      <Node
        {...L.grid}
        {...L.box}
        label="Grid"
        value={fmtKw(gridKw)}
        unit="kW"
        sub={exporting ? "exporting" : gridKw > IDLE_KW ? "importing" : "idle"}
        color={exporting ? C.export : C.grid}
        dim={Math.abs(gridKw) < IDLE_KW}
      />
      <Node
        {...L.battery}
        {...L.box}
        label="Battery"
        value={fmtKw(batteryKw)}
        unit="kW"
        sub={`${batterySoc == null ? "—" : Math.round(batterySoc)}% · ${charging ? "charging" : batteryKw > IDLE_KW ? "discharging" : "idle"}`}
        color={C.battery}
        dim={Math.abs(batteryKw) < IDLE_KW}
      />
      <Node
        {...L.tesla}
        {...L.box}
        label="Tesla"
        value={fmtKw(teslaKw)}
        unit="kW"
        sub={teslaKw >= IDLE_KW ? "charging" : (teslaState?.toLowerCase() ?? "not charging")}
        color={C.charge}
        dim={teslaKw < IDLE_KW}
      />
      <Node
        {...L.home}
        {...L.box}
        label="Home use"
        value={fmtKw(houseExclTesla)}
        unit="kW"
        sub={L.compact ? "excl. car" : "everything but the car"}
        color={C.house}
        dim={houseExclTesla < IDLE_KW}
      />
      <Node {...L.hub} label="Total load" value={fmtKw(houseKw)} unit="kW" sub="home + car" />
    </svg>
  );
}

export function FlowDiagram(inputs: FlowInputs) {
  return (
    <div className="w-full">
      <style>{`
        @keyframes flowToHub   { from { stroke-dashoffset: 44 } to { stroke-dashoffset: 0 } }
        @keyframes flowFromHub { from { stroke-dashoffset: 0 } to { stroke-dashoffset: 44 } }
        @media (prefers-reduced-motion: reduce) {
          [data-flow-pulse] path { animation: none !important }
        }
      `}</style>
      {/* Wide strip on desktop, compact radial on phones. */}
      <div className="hidden sm:block">
        <FlowSvg inputs={inputs} L={WIDE} />
      </div>
      <div className="sm:hidden mx-auto max-w-[22rem]">
        <FlowSvg inputs={inputs} L={RADIAL} />
      </div>
    </div>
  );
}
