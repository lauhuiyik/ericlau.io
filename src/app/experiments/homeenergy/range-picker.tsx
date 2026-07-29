"use client";

import { useRouter } from "next/navigation";
import type { DateRange } from "@/lib/energy";

const RANGES: { key: DateRange; label: string; days: number }[] = [
  { key: "day", label: "Day", days: 1 },
  { key: "week", label: "Week", days: 7 },
  { key: "month", label: "Month", days: 30 },
];

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function RangePicker({
  range,
  date,
  today,
}: {
  range: DateRange;
  date: string;
  today: string;
}) {
  const router = useRouter();

  const go = (r: DateRange, d: string) => router.push(`?range=${r}&date=${d}`);
  const step = RANGES.find((r) => r.key === range)?.days ?? 1;
  const canGoForward = date < today;

  return (
    <div className="flex flex-wrap items-center gap-4 sm:gap-6">
      <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em]">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => go(r.key, date)}
            className={`px-3 py-1.5 border transition-colors ${
              r.key === range
                ? "border-foreground text-foreground"
                : "border-rule text-muted hover:text-foreground hover:border-foreground"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
        <button
          type="button"
          onClick={() => go(range, shiftDate(date, -step))}
          className="hover:text-foreground transition-colors px-1"
          aria-label="Earlier"
        >
          ←
        </button>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && go(range, e.target.value)}
          className="bg-transparent border border-rule px-2 py-1 text-foreground [color-scheme:dark]"
        />
        <button
          type="button"
          onClick={() => canGoForward && go(range, shiftDate(date, step))}
          disabled={!canGoForward}
          className="hover:text-foreground transition-colors px-1 disabled:opacity-30 disabled:hover:text-muted"
          aria-label="Later"
        >
          →
        </button>
        {date !== today && (
          <button
            type="button"
            onClick={() => go(range, today)}
            className="hover:text-foreground transition-colors underline decoration-rule underline-offset-4 ml-1"
          >
            Today
          </button>
        )}
      </div>
    </div>
  );
}
