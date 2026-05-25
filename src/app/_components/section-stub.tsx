import Link from "next/link";
import { sections } from "@/lib/sections";

type Props = {
  slug: string;
};

export function SectionStub({ slug }: Props) {
  const section = sections.find((s) => s.slug === slug);
  if (!section) return null;

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

      <section className="flex flex-1 flex-col justify-center px-6 sm:px-12 py-24 sm:py-32 max-w-5xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">
          {section.group}
        </div>
        <h1 className="text-6xl sm:text-7xl md:text-8xl font-semibold tracking-[-0.03em] leading-[0.9]">
          {section.title}
        </h1>
        <p className="mt-8 max-w-xl text-lg text-muted leading-relaxed">
          {section.blurb}
        </p>
        <p className="mt-12 max-w-xl text-sm text-muted leading-relaxed">
          Nothing here yet. Coming soon.
        </p>
      </section>

      <footer className="border-t border-rule px-6 sm:px-12 py-8 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        <Link href="/" className="hover:text-foreground transition-colors">
          ← Back to index
        </Link>
      </footer>
    </div>
  );
}
