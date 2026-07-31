"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Smart refresh. Polls a tiny KV-backed endpoint every `seconds` and only
 * re-renders the page when the reading's timestamp actually changes — so the
 * numbers are never more than ~`seconds` stale, without pointless re-renders.
 *
 * This endpoint only reads our own KV snapshot — it never touches Anker or
 * Growatt, so it costs nothing and cannot trip their rate limits, which is why
 * it can poll this often. Real freshness is set by the collector: a CI run
 * every 5 min that takes 4 samples 60s apart, giving ~1-minute data.
 */
export function AutoRefresh({
  seconds = 10,
  currentTs,
}: {
  seconds?: number;
  currentTs?: number | null;
}) {
  const router = useRouter();
  const latestSeen = useRef<number | null>(currentTs ?? null);
  const [ago, setAgo] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    latestSeen.current = currentTs ?? null;
  }, [currentTs]);

  const check = useCallback(
    async (force = false) => {
      setChecking(true);
      try {
        const r = await fetch("/api/energy/latest", { cache: "no-store" });
        const snap = (await r.json()) as { ts?: number } | null;
        if (snap?.ts) {
          if (latestSeen.current == null || snap.ts > latestSeen.current) {
            latestSeen.current = snap.ts;
            router.refresh();
          }
          setAgo(Math.max(0, Math.floor(Date.now() / 1000 - snap.ts)));
        }
        if (force) router.refresh();
      } catch {
        // transient network error — try again on the next tick
      } finally {
        setChecking(false);
      }
    },
    [router],
  );

  useEffect(() => {
    const id = setInterval(() => check(), seconds * 1000);
    return () => clearInterval(id);
  }, [check, seconds]);

  // Tick the "x s ago" label every second so it always reads live.
  useEffect(() => {
    const id = setInterval(() => setAgo((a) => (a == null ? null : a + 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const label =
    ago == null ? "live" : ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ${ago % 60}s ago`;

  return (
    <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{
            background: "#4ade80",
            opacity: checking ? 0.35 : 1,
            transition: "opacity 180ms",
          }}
        />
        Data {label}
      </span>
      <button
        type="button"
        onClick={() => check(true)}
        className="hover:text-foreground transition-colors underline decoration-rule underline-offset-4"
      >
        Refresh
      </button>
    </div>
  );
}
