"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Live mode switch (POST /api/energy/live).
 *
 * Off: readings arrive about once an hour, which keeps the site's Worker well
 * inside the Free plan's CPU allowance. On: back to a reading every minute or
 * so (the collector runs every 5 min and takes 4 samples) and a 10 s page
 * refresh, for two hours, then it switches itself off.
 */
export function LiveToggle({ liveUntil }: { liveUntil: number }) {
  const router = useRouter();
  const [until, setUntil] = useState(liveUntil);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setUntil(liveUntil), [liveUntil]);

  // Flip back to "off" on screen when the two hours run out.
  useEffect(() => {
    if (!until) return;
    const ms = until - Date.now();
    if (ms <= 0) {
      setUntil(0);
      return;
    }
    const id = setTimeout(() => {
      setUntil(0);
      router.refresh();
    }, ms + 1000);
    return () => clearTimeout(id);
  }, [until, router]);

  async function set(on: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/energy/live", {
        method: "POST",
        headers: { "content-type": "application/json", "x-energy": "1" },
        body: JSON.stringify({ on }),
      });
      const data = (await r.json().catch(() => ({}))) as { liveUntil?: number; error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setUntil(data.liveUntil ?? 0);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const on = until > Date.now();
  const endsAt = on
    ? new Date(until).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" })
    : "";

  return (
    <span className="flex items-center gap-2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.1em] sm:tracking-[0.18em] text-muted">
      {on ? (
        <>
          <span className="text-foreground">Live until {endsAt}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => set(false)}
            title="Back to hourly readings"
            className="hover:text-foreground transition-colors underline decoration-rule underline-offset-4 disabled:opacity-50"
          >
            Stop
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => set(true)}
          title="Readings every minute for the next 2 hours (otherwise hourly)"
          className="hover:text-foreground transition-colors underline decoration-rule underline-offset-4 disabled:opacity-50"
        >
          {busy ? "Starting…" : "Go live"}
        </button>
      )}
      {error ? <span className="normal-case tracking-normal text-red-400">{error}</span> : null}
    </span>
  );
}
