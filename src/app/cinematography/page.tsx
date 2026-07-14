import Link from "next/link";
import { projects } from "./_projects";
import { GalleryCard } from "./_gallery-card";

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

      <section className="border-t border-rule px-6 sm:px-12 py-12 pb-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12">
          {projects.map((p) => (
            <GalleryCard
              key={p.slug}
              slug={p.slug}
              title={p.title}
              client={p.client}
              vimeoId={p.vimeoId}
            />
          ))}
        </div>
      </section>

      <footer className="border-t border-rule px-6 sm:px-12 py-8 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        <Link href="/" className="hover:text-foreground transition-colors">
          ← Back to index
        </Link>
      </footer>
    </div>
  );
}
