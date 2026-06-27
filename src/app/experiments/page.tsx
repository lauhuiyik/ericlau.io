import Link from "next/link";
import { sections } from "@/lib/sections";

// Hand-curated list of HTML experiments living in /public/experiments/<slug>/.
// To add one: drop an index.html into public/experiments/<slug>/, then add an entry here.
const entries: { slug: string; title: string; note: string }[] = [
  {
    slug: "japan2026",
    title: "Japan 2026",
    note: "A private trip itinerary — Tokyo & Osaka, Aug 2026. Login required.",
  },
  {
    slug: "hello",
    title: "Hello, world",
    note: "A demo of dropping a raw HTML file into the site.",
  },
];

export default function Page() {
  const section = sections.find((s) => s.slug === "experiments")!;

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
          {section.title}
        </div>
      </header>

      <section className="px-6 sm:px-12 pt-16 sm:pt-24 pb-12 max-w-5xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">
          {section.group}
        </div>
        <h1 className="text-6xl sm:text-7xl md:text-8xl font-semibold tracking-[-0.03em] leading-[0.9]">
          {section.title}
        </h1>
        <p className="mt-8 max-w-xl text-lg text-muted leading-relaxed">
          {section.blurb}
        </p>
      </section>

      <section className="border-t border-rule px-6 sm:px-12 py-16">
        <ul className="flex flex-col divide-y divide-rule">
          {entries.map((e) => (
            <li key={e.slug}>
              <a
                href={`/experiments/${e.slug}/`}
                className="group flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 py-6"
              >
                <div>
                  <div className="text-2xl font-medium text-foreground/90 group-hover:text-foreground transition-colors">
                    {e.title}
                  </div>
                  <div className="text-sm text-muted mt-1">{e.note}</div>
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted group-hover:text-foreground transition-colors">
                  /{e.slug} →
                </div>
              </a>
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
