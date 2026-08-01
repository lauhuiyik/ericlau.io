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
 * Deliberately only draws what is actually measured. Per-sample the APIs report
 * an aggregate kW per source, NOT how it was routed (Anker splits
 * solar-to-home / solar-to-battery only in daily totals). So each spoke carries
 * one signed magnitude and its direction comes from that sign — no invented
 * "solar is charging the battery" line, which would be a guess.
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

const VB_W = 1000;
const VB_H = 320;

/**
 * Left-to-right layout: the three things that can SUPPLY power on the left, the
 * combined total in the middle, and the two things that CONSUME it on the right.
 * Reading order matches the physics, and a wide-and-short frame keeps this a
 * glanceable strip rather than a full screen of diagram.
 *
 * Splitting the load side matters because Anker meters the house as one figure
 * with the car buried inside it — home consumption on its own is only visible by
 * subtracting the car.
 */
const HUB = { x: 500, y: 158, w: 160, h: 78 };
const BOX = { w: 168, h: 72 };
const NODES = {
  solar: { x: 90, y: 52 },
  grid: { x: 90, y: 158 },
  battery: { x: 90, y: 264 },
  home: { x: 910, y: 104 },
  tesla: { x: 910, y: 216 },
};

/** A spoke is "live" below this, in kW — under ~50 W is noise, not flow. */
const IDLE_KW = 0.05;

const fmtKw = (n: number) => (Math.abs(n) < IDLE_KW ? "0.0" : Math.abs(n).toFixed(1));

/**
 * Pulse period for a given magnitude. Faster = more power, which is the whole
 * point of the animation, but clamped at both ends: a trickle still has to
 * visibly move, and 15 kW mustn't strobe.
 */
function pulseSeconds(kw: number): number {
  const frac = Math.min(1, Math.abs(kw) / 9);
  return 2.3 - 1.65 * frac; // 2.3s idle-ish -> 0.65s flat out
}

/** Line thickness scales with power so big flows read first. */
function pulseWidth(kw: number): number {
  return 2 + Math.min(1, Math.abs(kw) / 9) * 3.5;
}

function Spoke({
  d,
  kw,
  color,
  /** True when the flow runs from the outer node toward the hub. */
  toHub,
}: {
  d: string;
  kw: number;
  color: string;
  toHub: boolean;
}) {
  const live = Math.abs(kw) >= IDLE_KW;
  return (
    <g>
      {/* Static rail, always visible so the topology is readable when idle. */}
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
  w = BOX.w,
  h = BOX.h,
  label,
  value,
  unit,
  sub,
  color,
  dim = false,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  label: string;
  value: string;
  unit: string;
  sub?: string;
  color?: string;
  dim?: boolean;
}) {
  return (
    <g>
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.22}
      />
      <text
        x={x}
        y={y - h / 2 + 19}
        textAnchor="middle"
        className="font-mono"
        fontSize={9.5}
        letterSpacing="2.2"
        fill="currentColor"
        opacity={0.55}
      >
        {label.toUpperCase()}
      </text>
      <text x={x} y={y + 8} textAnchor="middle" fill="currentColor">
        <tspan
          fontSize={26}
          fontWeight={550}
          fill={dim ? "currentColor" : (color ?? "currentColor")}
          opacity={dim ? 0.45 : 1}
        >
          {value}
        </tspan>
        <tspan fontSize={12} opacity={0.5} dx={4}>
          {unit}
        </tspan>
      </text>
      {sub && (
        <text
          x={x}
          y={y + h / 2 - 11}
          textAnchor="middle"
          fontSize={10.5}
          fill="currentColor"
          opacity={0.5}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

export function FlowDiagram({
  solarNewKw,
  solarOldKw,
  batteryKw,
  batterySoc,
  gridKw,
  houseKw,
  teslaKw,
  teslaState,
}: FlowInputs) {
  const solarKw = (solarNewKw ?? 0) + (solarOldKw ?? 0);
  const houseExclTesla = Math.max(0, houseKw - teslaKw);

  // Spoke endpoints: from each node's inner edge to the hub, with a small gap so
  // a pulse never sits under the text. Supply spokes run left -> hub, load
  // spokes are defined node -> hub too (so `toHub: false` reverses them) which
  // keeps every path's geometry consistent.
  const gap = 6;
  const srcX = NODES.solar.x + BOX.w / 2 + gap;
  const hubL = HUB.x - HUB.w / 2 - gap;
  const loadX = NODES.home.x - BOX.w / 2 - gap;
  const hubR = HUB.x + HUB.w / 2 + gap;

  const solarToHub = `M ${srcX} ${NODES.solar.y} L ${hubL} ${HUB.y}`;
  const gridToHub = `M ${srcX} ${NODES.grid.y} L ${hubL} ${HUB.y}`;
  const batteryToHub = `M ${srcX} ${NODES.battery.y} L ${hubL} ${HUB.y}`;
  const homeToHub = `M ${loadX} ${NODES.home.y} L ${hubR} ${HUB.y}`;
  const teslaToHub = `M ${loadX} ${NODES.tesla.y} L ${hubR} ${HUB.y}`;

  const exporting = gridKw < -IDLE_KW;
  const charging = batteryKw < -IDLE_KW;

  const solarSub =
    solarOldKw == null
      ? `array 2 ${fmtKw(solarNewKw ?? 0)} · array 1 not reporting`
      : `array 2 ${fmtKw(solarNewKw ?? 0)} · array 1 ${fmtKw(solarOldKw)}`;

  return (
    <div className="w-full">
      <style>{`
        @keyframes flowToHub   { from { stroke-dashoffset: 44 } to { stroke-dashoffset: 0 } }
        @keyframes flowFromHub { from { stroke-dashoffset: 0 } to { stroke-dashoffset: 44 } }
        /* Respect users who don't want motion: the rails and every number stay,
           only the travelling pulse stops. */
        @media (prefers-reduced-motion: reduce) {
          [data-flow-pulse] path { animation: none !important }
        }
      `}</style>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full h-auto text-foreground"
        role="img"
        aria-label={
          `Live energy flow. Solar ${fmtKw(solarKw)} kW. ` +
          `Grid ${exporting ? "exporting" : "importing"} ${fmtKw(gridKw)} kW. ` +
          `Battery ${charging ? "charging" : "discharging"} ${fmtKw(batteryKw)} kW at ${batterySoc ?? "unknown"}%. ` +
          `Total load ${fmtKw(houseKw)} kW, of which home ${fmtKw(houseExclTesla)} kW ` +
          `and car ${fmtKw(teslaKw)} kW.`
        }
      >
        <g data-flow-pulse>
          {/* Solar can only ever supply, so this spoke is one-directional. */}
          <Spoke d={solarToHub} kw={solarKw} color={C.solar} toHub />
          <Spoke
            d={gridToHub}
            kw={gridKw}
            color={exporting ? C.export : C.grid}
            toHub={!exporting}
          />
          <Spoke d={batteryToHub} kw={batteryKw} color={C.battery} toHub={!charging} />
          {/* Loads only ever draw, so flow runs away from the hub. */}
          <Spoke d={homeToHub} kw={houseExclTesla} color={C.house} toHub={false} />
          <Spoke d={teslaToHub} kw={teslaKw} color={C.charge} toHub={false} />
        </g>

        <Node
          {...NODES.solar}
          label="Solar"
          value={solarKw < IDLE_KW ? "Standby" : fmtKw(solarKw)}
          unit={solarKw < IDLE_KW ? "" : "kW"}
          sub={solarSub}
          color={C.solar}
          dim={solarKw < IDLE_KW}
        />
        <Node
          {...NODES.grid}
          label="Grid"
          value={fmtKw(gridKw)}
          unit="kW"
          sub={exporting ? "exporting" : gridKw > IDLE_KW ? "importing" : "idle"}
          color={exporting ? C.export : C.grid}
          dim={Math.abs(gridKw) < IDLE_KW}
        />
        <Node
          {...NODES.battery}
          label="Battery"
          value={fmtKw(batteryKw)}
          unit="kW"
          sub={`${batterySoc == null ? "—" : Math.round(batterySoc)}% · ${
            charging ? "charging" : batteryKw > IDLE_KW ? "discharging" : "idle"
          }`}
          color={C.battery}
          dim={Math.abs(batteryKw) < IDLE_KW}
        />
        <Node
          {...NODES.tesla}
          label="Tesla"
          value={fmtKw(teslaKw)}
          unit="kW"
          sub={teslaKw >= IDLE_KW ? "charging at home" : (teslaState?.toLowerCase() ?? "not charging")}
          color={C.charge}
          dim={teslaKw < IDLE_KW}
        />
        <Node
          {...NODES.home}
          label="Home use"
          value={fmtKw(houseExclTesla)}
          unit="kW"
          sub="everything but the car"
          color={C.house}
          dim={houseExclTesla < IDLE_KW}
        />
        <Node
          x={HUB.x}
          y={HUB.y}
          w={HUB.w}
          h={HUB.h}
          label="Total load"
          value={fmtKw(houseKw)}
          unit="kW"
          sub="home + car"
        />
      </svg>
    </div>
  );
}
