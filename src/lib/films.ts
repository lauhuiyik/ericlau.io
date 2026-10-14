import { mediaUrl } from "@/lib/media";

/**
 * A film in one of the portfolio's video sections (cinematography, activation,
 * animation). Self-hosted films live on media.ericlau.io (src/lib/media.ts)
 * under <section>/, named by slug:
 *
 *   <slug>.mp4        web version (1080p H.264, or 1080x1920 / 1440x1440)
 *   <slug>.jpg        poster, at the video's own resolution
 *   <slug>-thumb.jpg  960x540 grid thumbnail (vertical/square films sit on a
 *                     blurred fill so every card is 16:9)
 *
 * A film with a youtubeId is embedded from YouTube instead.
 */
export type Film = {
  slug: string;
  title: string;
  client: string;
  /** One or two sentences shown under the title on the film's page. */
  description?: string;
  /** Frame shape; landscape (16:9) unless set. */
  aspect?: "portrait" | "square";
  youtubeId?: string;
};

export type FilmSection = "cinematography" | "activation" | "animation";

export const filmVideo = (section: FilmSection, f: Film) => mediaUrl(`${section}/${f.slug}.mp4`);
export const filmPoster = (section: FilmSection, f: Film) => mediaUrl(`${section}/${f.slug}.jpg`);

export function filmThumb(section: FilmSection, f: Film): string {
  if (f.youtubeId) return `https://img.youtube.com/vi/${f.youtubeId}/maxresdefault.jpg`;
  return mediaUrl(`${section}/${f.slug}-thumb.jpg`);
}
