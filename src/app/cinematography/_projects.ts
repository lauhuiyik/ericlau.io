export type Project = {
  slug: string;
  title: string;
  client: string;
  vimeoId: string;
};

export const projects: Project[] = [
  {
    slug: "sidg-park-quarter",
    title: "Park Quarter",
    client: "SIDG",
    vimeoId: "819020901",
  },
  {
    slug: "monash-healthy-working-lives",
    title: "Healthy Working Lives",
    client: "Monash University",
    vimeoId: "710593048",
  },
  {
    slug: "gifta-kite-surfing",
    title: "Kite Surfing Experience",
    client: "GIFTA x Adrenaline",
    vimeoId: "530166912",
  },
  {
    slug: "gifta-hot-air-balloon",
    title: "Hot Air Balloon Experience",
    client: "GIFTA x Adrenaline",
    vimeoId: "530165743",
  },
  {
    slug: "bascon-monash-university",
    title: "Monash University",
    client: "Bascon Group",
    vimeoId: "852899696",
  },
  {
    slug: "yum-sing-house-showcase",
    title: "Showcase",
    client: "Yum Sing House",
    vimeoId: "819035681",
  },
  {
    slug: "lf-logistics-warehouse-walkthrough",
    title: "Warehouse Walkthrough",
    client: "LF Logistics",
    vimeoId: "851513368",
  },
];
