import type { Film } from "@/lib/films";

/** Films on /animation, in page order. Self-hosted under animation/ on media.ericlau.io (see src/lib/films.ts). */
export const projects: Film[] = [
  {
    slug: "fifa-animation-showcase",
    title: "Stage Panel Animation",
    client: "FIFA Women's World Cup 2023",
    description:
      "Behind the scenes of the animated stage panels for the FIFA Women's World Cup 2023: from first concept drafts to the approved artwork, live on stage.",
  },
  {
    slug: "roger-dubuis-excalibur",
    title: "Excalibur Flyback Chronograph",
    client: "Roger Dubuis",
    aspect: "square",
    description:
      "Square-format 3D product animation of the Excalibur flyback chronograph, highlighting the flyback function and 120° rotating minute counter.",
  },
  {
    slug: "otherpay",
    title: "DUO",
    client: "OtherPay",
    description:
      "3D product animation for OtherPay DUO, a card-sized device that generates one-time six-digit codes in place of static passwords and codes sent by text, email or app.",
  },
  {
    slug: "haileybury-hub",
    title: "Haileybury Hub",
    client: "Haileybury",
    description:
      "Animated explainer introducing Haileybury Hub, the staff portal for news, staff happenings and discussion boards.",
  },
  {
    slug: "gifta-memorable-gifts",
    title: "Memorable Gifts",
    client: "GIFTA",
    description:
      "Animated explainer for GIFTA's gifting platform, from pooled contributions to travel packages and one-of-a-kind experiences.",
  },
  {
    slug: "baker-boy-hype-reel",
    title: "Hype Reel",
    client: "Baker Boy",
    description: "A 16:9 hype reel for Baker Boy, cut from live performances including St Kilda Festival.",
  },
];
