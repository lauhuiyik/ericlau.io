import Link from "next/link";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-6 sm:px-12">
        <Link
          href="/experiments/homeenergy"
          className="font-mono text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          ← Home Energy
        </Link>
        <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted">Settings</div>
      </header>

      <section className="px-6 sm:px-12 pt-12 sm:pt-16 pb-8 max-w-5xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">
          Tariff
        </div>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-[-0.03em] leading-[0.95]">
          Rates &amp; times
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted leading-relaxed">
          Used to price your grid usage and project costs. Seeded from your Lumo bill (fixed until
          30 Sep 2026) — update here whenever your plan changes.
        </p>
      </section>

      <section className="border-t border-rule px-6 sm:px-12 py-12">
        <SettingsForm />
      </section>

      <footer className="border-t border-rule px-6 sm:px-12 py-8 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        <Link href="/experiments/homeenergy" className="hover:text-foreground transition-colors">
          ← Back to dashboard
        </Link>
      </footer>
    </div>
  );
}
