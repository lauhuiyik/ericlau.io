import { mediaUrl } from "@/lib/media";

/**
 * Each film is self-hosted on media.ericlau.io (src/lib/media.ts), named by
 * its slug: cinematography/<slug>.mp4, plus <slug>.jpg (poster, 1920x1080)
 * and <slug>-thumb.jpg (grid, 960x540). To add a film, upload those three
 * files and add an entry here.
 */
export type Project = {
  slug: string;
  title: string;
  client: string;
};

export const videoUrl = (p: Project) => mediaUrl(`cinematography/${p.slug}.mp4`);
export const posterUrl = (p: Project) => mediaUrl(`cinematography/${p.slug}.jpg`);
export const thumbUrl = (p: Project) => mediaUrl(`cinematography/${p.slug}-thumb.jpg`);

export const projects: Project[] = [
  {
    slug: "sidg-park-quarter",
    title: "Park Quarter",
    client: "SIDG",
  },
  {
    slug: "monash-healthy-working-lives",
    title: "Healthy Working Lives",
    client: "Monash University",
  },
  {
    slug: "gifta-kite-surfing",
    title: "Kite Surfing Experience",
    client: "GIFTA x Adrenaline",
  },
  {
    slug: "gifta-hot-air-balloon",
    title: "Hot Air Balloon Experience",
    client: "GIFTA x Adrenaline",
  },
  {
    slug: "bascon-monash-university",
    title: "Monash University",
    client: "Bascon Group",
  },
  {
    slug: "yum-sing-house-showcase",
    title: "Showcase",
    client: "Yum Sing House",
  },
  {
    slug: "lf-logistics-warehouse-walkthrough",
    title: "Warehouse Walkthrough",
    client: "LF Logistics",
  },
  {
    slug: "realestate-showreel",
    title: "Real Estate Showreel",
    client: "Showreel",
  },
  {
    slug: "property-developer-showreel",
    title: "Property Developer Showreel",
    client: "Showreel",
  },
  {
    slug: "private-home-sale-showreel",
    title: "Private Home Sale Showreel",
    client: "Showreel",
  },
  {
    slug: "home-builder-showreel",
    title: "Home Builder Showreel",
    client: "Showreel",
  },
];
