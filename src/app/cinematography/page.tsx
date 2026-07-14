import Link from "next/link";
import { projects } from "./_projects";

export default function Cinematography() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-6 sm:px-12">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          ← Eric Lau
        </Link>
        <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
          Cinematography
        </div>
      </header>

      <section className="px-6 sm:px-12 pt-16 pb-8 max-w-5xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">
          visual
        </div>
        <h1 className="text-6xl sm:text-7xl md:text-8xl font-semibold tracking-[-0.03em] leading-[0.9]">
          Cinematography
        </h1>
        <p className="mt-8 max-w-xl text-lg text-muted leading-relaxed">
          Frames, light, motion.
        </p>
      </section>

      <section className="border-t border-rule px-6 sm:px-12 py-8">
        <ul className="flex flex-col divide-y divide-rule">
          {projects.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/cinematography/${p.slug}`}
                className="group flex items-baseline justify-between gap-8 py-8"
              >
                <div>
                  <div className="text-2xl sm:text-3xl font-medium tracking-tight group-hover:text-muted transition-colors">
                    {p.title}
                  </div>
                  <div className="mt-2 text-sm text-muted">{p.client}</div>
                </div>
                <div className="font-mono text-xs text-muted shrink-0">
                  ↗
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-rule px-6 sm:px-12 py-8 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        <Link href="/" className="hover:text-foreground transition-colors">
          ← Back to index
        </Link>
      </footer>
    </div>
  );
}
