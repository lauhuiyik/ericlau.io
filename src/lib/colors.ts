/**
 * Shared colour palette for the home energy dashboard — one colour per
 * concept, used by both the server-rendered tiles and the client-rendered
 * charts.
 *
 * This deliberately lives in its own plain module rather than in charts.tsx.
 * charts.tsx is a `"use client"` module, and when a SERVER component imports a
 * non-component value from a client module, React hands back a client-reference
 * stub instead of the real object — so `C.solar` silently evaluates to
 * `undefined` on the server and every tile loses its colour. Keeping the
 * palette in a neutral module means both sides get the actual values.
 */
export const C = {
  solar: "#f5b301", // yellow  — solar generation
  grid: "#fb923c", // orange  — drawing FROM the grid
  export: "#4ade80", // green   — feeding TO the grid (grid line goes negative)
  house: "#60a5fa", // blue    — home consumption, excluding the car
  charge: "#f87171", // red     — Tesla charging
  battery: "#c084fc", // violet  — battery state of charge
  /** Alias so the range-mode "self-supplied" bars stay green. */
  self: "#4ade80",
  /** Problem text (stale source, missing array). Never a data-series colour. */
  warn: "#f87171",
} as const;
