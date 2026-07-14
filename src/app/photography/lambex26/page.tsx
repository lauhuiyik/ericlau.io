import Link from "next/link";
import { GalleryImage } from "./_gallery-image";

const images = Array.from({ length: 37 }, (_, i) => ({
  src: `/photography/lambex26/LAMBEX26-${i + 1}.JPG`,
  alt: `LambEx 2026 — image ${i + 1}`,
}));

export default function LambEx26() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-6 sm:px-12">
        <Link
          href="/photography"
          className="font-mono text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          ← Photography
        </Link>
        <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
          2026
        </div>
      </header>

      <section className="px-6 sm:px-12 pt-12 pb-16 max-w-5xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">
          Event · Editorial
        </div>
        <h1 className="text-6xl sm:text-7xl md:text-8xl font-semibold tracking-[-0.03em] leading-[0.9]">
          LambEx 2026
        </h1>
        <p className="mt-8 max-w-xl text-lg text-muted leading-relaxed">
          Event coverage from Australia&apos;s national sheep and lamb industry expo.
        </p>
      </section>

      <section className="px-6 sm:px-12 pb-24">
        <div className="columns-1 sm:columns-2 gap-3">
          {images.map((img, i) => (
            <GalleryImage key={i} src={img.src} alt={img.alt} eager={i < 2} />
          ))}
        </div>
      </section>

      <footer className="border-t border-rule px-6 sm:px-12 py-8 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        <Link
          href="/photography"
          className="hover:text-foreground transition-colors"
        >
          ← Photography
        </Link>
      </footer>
    </div>
  );
}
