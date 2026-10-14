import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/app/_components/site-footer";
import { type Film, type FilmSection, filmPoster, filmVideo } from "@/lib/films";

/**
 * The page for one film, shared by /cinematography, /activation and
 * /animation: client and title, an optional description, then the player
 * sized to the film's shape (vertical and square films don't fill the width).
 */

type Section = { slug: FilmSection; label: string; films: Film[] };

const findFilm = (section: Section, slug: string) => section.films.find((f) => f.slug === slug);

export function filmStaticParams(section: Section) {
  return section.films.map((f) => ({ slug: f.slug }));
}

export function filmMetadata(section: Section, slug: string): Metadata {
  const film = findFilm(section, slug);
  if (!film) return {};
  return {
    title: `${film.title} — ${film.client} — Eric Lau`,
    description: film.description,
  };
}

const PLAYER_BOX: Record<NonNullable<Film["aspect"]> | "landscape", string> = {
  landscape: "w-full aspect-video",
  // Fit the viewport height: 80vh tall at most, never wider than the column.
  portrait: "mx-auto w-full max-w-[calc(80vh*9/16)] aspect-[9/16]",
  square: "mx-auto w-full max-w-[80vh] aspect-square",
};

export function FilmPage({ section, slug }: { section: Section; slug: string }) {
  const film = findFilm(section, slug);
  if (!film) notFound();
  const label = `${film.client} — ${film.title}`;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-6 sm:px-12">
        <Link
          href={`/${section.slug}`}
          className="font-mono text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          ← {section.label}
        </Link>
      </header>

      <section className="px-6 sm:px-12 pt-12 pb-10 max-w-5xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">
          {film.client}
        </div>
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-[-0.03em] leading-[0.9]">
          {film.title}
        </h1>
        {film.description ? (
          <p className="mt-8 max-w-2xl text-lg text-muted leading-relaxed">{film.description}</p>
        ) : null}
      </section>

      <section className="px-6 sm:px-12 pb-24">
        <div className={`${PLAYER_BOX[film.aspect ?? "landscape"]} bg-black`}>
          {film.youtubeId ? (
            <iframe
              src={`https://www.youtube.com/embed/${film.youtubeId}`}
              allow="autoplay; fullscreen; picture-in-picture"
              className="w-full h-full"
              title={label}
            />
          ) : (
            // Self-hosted (src/lib/films.ts); only metadata loads until play.
            <video
              src={filmVideo(section.slug, film)}
              poster={filmPoster(section.slug, film)}
              controls
              playsInline
              preload="metadata"
              aria-label={label}
              className="w-full h-full"
            />
          )}
        </div>
      </section>

      <SiteFooter backHref={`/${section.slug}`} backLabel={`← ${section.label}`} />
    </div>
  );
}
