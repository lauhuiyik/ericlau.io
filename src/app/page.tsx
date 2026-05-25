import Link from "next/link";
import { sections, groupLabels, type Section } from "@/lib/sections";

export default function Home() {
  const grouped = sections.reduce<Record<Section["group"], Section[]>>(
    (acc, s) => {
      (acc[s.group] ??= []).push(s);
      return acc;
    },
    { visual: [], editorial: [], logs: [] }
  );

  return (
    <div className="flex flex-1 flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-6 sm:px-12">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          Eric Lau
        </Link>
        <a
          href="mailto:hello@ericlau.io"
          className="font-mono text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          Contact
        </a>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col justify-center px-6 sm:px-12 py-24 sm:py-32">
        <h1 className="text-[20vw] sm:text-[18vw] md:text-[15vw] leading-[0.85] font-semibold tracking-[-0.04em]">
          Creative.
        </h1>
        <p className="mt-8 max-w-xl text-base sm:text-lg text-muted leading-relaxed">
          The work, experiments and notes of Eric Lau.
        </p>
      </section>

      {/* Section index */}
      <section className="border-t border-rule px-6 sm:px-12 py-16 sm:py-24">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-16">
          {(Object.keys(grouped) as Section["group"][]).map((group) => (
            <div key={group} className="flex flex-col gap-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                {groupLabels[group]}
              </div>
              <ul className="flex flex-col gap-4">
                {grouped[group].map((s) => (
                  <li key={s.slug}>
                    <Link
                      href={`/${s.slug}`}
                      className="group block"
                    >
                      <div className="text-2xl sm:text-3xl tracking-tight font-medium text-foreground/90 group-hover:text-foreground transition-colors">
                        {s.title}
                      </div>
                      <div className="text-sm text-muted mt-1">
                        {s.blurb}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-rule px-6 sm:px-12 py-8 flex flex-col sm:flex-row gap-4 sm:gap-8 items-start sm:items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          ericlau.io · {new Date().getFullYear()}
        </div>
        <div className="flex gap-6 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          <a
            href="mailto:hello@ericlau.io"
            className="hover:text-foreground transition-colors"
          >
            Email
          </a>
          <a
            href="https://github.com/lauhuiyik"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
