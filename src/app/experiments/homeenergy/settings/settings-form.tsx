"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_TARIFF, type Tariff } from "@/lib/energy";

type Field = {
  key: keyof Tariff;
  label: string;
  unit: string;
  step: number;
  hint?: string;
};

const FIELDS: Field[] = [
  { key: "peakRate", label: "Peak rate", unit: "$/kWh", step: 0.0001 },
  { key: "offPeakRate", label: "Off-peak rate", unit: "$/kWh", step: 0.0001 },
  { key: "peakStartHour", label: "Peak starts", unit: "h (0–24)", step: 1, hint: "24-hour clock" },
  { key: "peakEndHour", label: "Peak ends", unit: "h (0–24)", step: 1 },
  { key: "supplyPerDay", label: "Daily supply charge", unit: "$/day", step: 0.0001 },
  { key: "feedIn", label: "Feed-in tariff", unit: "$/kWh", step: 0.001 },
];

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

  const set = (k: keyof Tariff, v: string) =>
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

      <div className="mt-12 flex items-center gap-6">
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
