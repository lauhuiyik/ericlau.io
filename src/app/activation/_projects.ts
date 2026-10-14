import type { Film } from "@/lib/films";

/**
 * Films on /activation, in page order. Self-hosted under activation/ on
 * media.ericlau.io (see src/lib/films.ts), except where a youtubeId is set.
 */
export const projects: Film[] = [
  {
    slug: "defender-house-usa",
    title: "Defender House USA",
    client: "JLR USA",
    youtubeId: "0dyHdv8-Qiw",
  },
  {
    slug: "sma-all-energy-australia",
    title: "All-Energy Australia",
    client: "SMA Australia",
    description:
      "A gamified spin-to-win screen on SMA's stand at All-Energy Australia, built to draw attendees in and capture lead data.",
  },
  {
    slug: "roger-dubuis-case-study",
    title: "Holographic Display",
    client: "Roger Dubuis",
    description:
      "Behind the scenes of the holographic display created for Roger Dubuis, with the watch rendered in 3D and its key mechanisms called out.",
  },
];
