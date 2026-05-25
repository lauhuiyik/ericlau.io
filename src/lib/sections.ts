export type Section = {
  slug: string;
  title: string;
  blurb: string;
  group: "visual" | "editorial" | "logs";
};

export const sections: Section[] = [
  {
    slug: "cinematography",
    title: "Cinematography",
    blurb: "Frames, light, motion.",
    group: "visual",
  },
  {
    slug: "photography",
    title: "Photography",
    blurb: "Stills that linger.",
    group: "visual",
  },
  {
    slug: "animation",
    title: "Animation",
    blurb: "Things that move with intent.",
    group: "visual",
  },
  {
    slug: "industrial-design",
    title: "Industrial Design",
    blurb: "Objects with a reason to exist.",
    group: "editorial",
  },
  {
    slug: "branding",
    title: "Branding",
    blurb: "Identity, voice, system.",
    group: "editorial",
  },
  {
    slug: "activation",
    title: "Activation",
    blurb: "Bringing ideas into the room.",
    group: "editorial",
  },
  {
    slug: "experiments",
    title: "Experiments",
    blurb: "One-off things worth sharing.",
    group: "logs",
  },
  {
    slug: "ai",
    title: "AI",
    blurb: "A log of one-off solutions to everyday problems.",
    group: "logs",
  },
];

export const groupLabels: Record<Section["group"], string> = {
  visual: "Visual",
  editorial: "Editorial",
  logs: "Logs",
};
