import Link from "next/link";
import { projects } from "./_projects";

export default function Activation() {
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
          Activation
        </div>
      </header>

      <section className="px-6 sm:px-12 pt-16 pb-8 max-w-5xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">
          experiential
        </div>
        <h1 className="text-6xl sm:text-7xl md:text-8xl font-semibold tracking-[-0.03em] leading-[0.9]">
          Activation
        </h1>
        <p className="mt-8 max-w-xl text-lg text-muted leading-relaxed">
          Brand experiences, events, and moments that move people.
        </p>
      </section>

      <section className="border-t border-rule px-6 sm:px-12 py-12 pb-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12">
          {projects.map((p) => (
            <Link key={p.slug} href={`/activation/${p.slug}`} className="group block">
              <div className="relative w-full aspect-video bg-[#111] overflow-hidden mb-3">
                <img
                  src={`https://img.youtube.com/vi/${p.youtubeId}/maxresdefault.jpg`}
                  alt={`${p.client} — ${p.title}`}
                  className="w-full h-full object-cover transition-all duration-500 group-hover:scale-[1.03]"
                />
                <div className="absolute inset-0 flex items-end p-4 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/80">
                    View project ↗
                  </span>
                </div>
              </div>
              <div className="text-base font-medium tracking-tight group-hover:text-muted transition-colors">
                {p.title}
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                {p.client}
              </div>
            </Link>
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
