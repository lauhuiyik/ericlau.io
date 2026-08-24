"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Prev / label / next navigator for the billing cycle. Pushes a prebuilt href
 * (query string, computed server-side so it preserves range+date) without
 * resetting scroll, so the page doesn't jump to the top on change. */
export function CycleNav({
  label,
  prevHref,
  nextHref,
}: {
  label: string;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const router = useRouter();
  const go = (href: string | null) => href && router.push(href, { scroll: false });
  const btn =
    "px-2 py-1 transition-colors disabled:opacity-25 disabled:hover:text-muted hover:text-foreground";
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
      <button type="button" className={btn} onClick={() => go(prevHref)} disabled={!prevHref} aria-label="Earlier cycle">
        ←
      </button>
      <span className="min-w-[9.5rem] text-center text-foreground normal-case tracking-normal">{label}</span>
      <button type="button" className={btn} onClick={() => go(nextHref)} disabled={!nextHref} aria-label="Later cycle">
        →
      </button>
    </div>
  );
}

/** A small toggle that reveals today's running cost in dollars, replacing the
 * old static caption. Pure client state — no navigation. */
export function TodayCostToggle({ costToday }: { costToday: number }) {
  const [show, setShow] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setShow((s) => !s)}
      className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
      aria-pressed={show}
    >
      {show ? (
        <>
          cost so far today · <span className="text-foreground">${costToday.toFixed(2)}</span> · hide
        </>
      ) : (
        <>show cost so far today →</>
      )}
    </button>
  );
}
