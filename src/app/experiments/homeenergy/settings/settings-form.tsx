"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_TARIFF, type Tariff } from "@/lib/energy";

/** Only the numeric rates are editable here. */
type RateKey = "peakRate" | "shoulderRate" | "offPeakRate" | "supplyPerDay" | "feedIn";

type Field = {
  key: RateKey;
  label: string;
  unit: string;
  step: number;
  hint?: string;
};

const FIELDS: Field[] = [
  { key: "peakRate", label: "Peak rate", unit: "$/kWh", step: 0.0001 },
  { key: "shoulderRate", label: "Shoulder rate", unit: "$/kWh", step: 0.0001 },
  { key: "offPeakRate", label: "Off-peak rate", unit: "$/kWh", step: 0.0001 },
  { key: "supplyPerDay", label: "Daily supply charge", unit: "$/day", step: 0.0001 },
  { key: "feedIn", label: "Feed-in tariff", unit: "$/kWh", step: 0.001 },
];

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

export function SettingsForm() {
  const router = useRouter();
  const [tariff, setTariff] = useState<Tariff>(DEFAULT_TARIFF);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "saved" | "error">(
    "loading",
  );

  useEffect(() => {
    fetch("/api/energy/tariff")
      .then((r) => r.json() as Promise<Tariff>)
      .then((t) => {
        setTariff(t);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    try {
      // Not /api/energy/tariff: that requires a Bearer secret the browser
      // cannot hold, so every save 401'd. This path sits inside the Access gate.
      const r = await fetch("/experiments/homeenergy/settings/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tariff),
      });
      const j = (await r.json()) as { ok: boolean; tariff: Tariff };
      if (!j.ok) throw new Error();
      setTariff(j.tariff);
      setStatus("saved");
      router.refresh();
      setTimeout(() => setStatus("ready"), 2500);
    } catch {
      setStatus("error");
    }
  }

  const set = (k: RateKey, v: string) =>
    setTariff((t) => ({ ...t, [k]: v === "" ? 0 : Number(v) }));

  return (
    <form onSubmit={save} className="max-w-xl">
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-8">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              {f.label} · {f.unit}
            </span>
            <input
              type="number"
              step={f.step}
              min={0}
              value={String(tariff[f.key])}
              onChange={(e) => set(f.key, e.target.value)}
              className="bg-transparent border-b border-rule focus:border-foreground outline-none py-2 text-2xl font-medium tracking-[-0.01em] transition-colors"
            />
            {f.hint && <span className="text-xs text-muted">{f.hint}</span>}
          </label>
        ))}
      </div>

      <div className="mt-12 border-t border-rule pt-8">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          {tariff.label} · price windows
        </div>
        <div className="mt-3 flex flex-col gap-1 font-mono text-xs text-muted">
          {tariff.windows.map((w, i) => (
            <div key={i}>
              <span className="text-foreground">{w.band === "peak" ? "Peak" : "Shoulder"}</span>{" "}
              {hh(w.startHour)}–{hh(w.endHour)}, every day
            </div>
          ))}
          <div>
            <span className="text-foreground">Off-peak</span> all remaining hours
          </div>
        </div>
        <p className="mt-4 max-w-xl text-xs text-muted">
          Windows aren’t editable here. They belong to the plan, and plans are recorded as dated
          eras in <span className="font-mono">lib/energy.ts</span> so that past bills keep the
          rates they were actually charged at. Rates edited above apply to the CURRENT plan only —
          history is never repriced.
        </p>
      </div>

      <div className="mt-10 flex items-center gap-6">
        <button
          type="submit"
          disabled={status === "saving"}
          className="font-mono text-xs uppercase tracking-[0.18em] border border-rule px-6 py-3 hover:border-foreground hover:text-foreground text-muted transition-colors disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : "Save rates"}
        </button>
        <button
          type="button"
          onClick={() => setTariff(DEFAULT_TARIFF)}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          Reset to bill baseline
        </button>
        {status === "error" && <span className="text-sm text-[#f87171]">Couldn’t save.</span>}
      </div>
    </form>
  );
}
