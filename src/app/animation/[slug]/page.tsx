import { FilmPage, filmMetadata, filmStaticParams } from "@/app/_components/film-page";
import { projects } from "../_projects";

type Props = {
  params: Promise<{ slug: string }>;
};

const section = { slug: "animation", label: "Animation", films: projects } as const;

export function generateStaticParams() {
  return filmStaticParams(section);
}

export async function generateMetadata({ params }: Props) {
  return filmMetadata(section, (await params).slug);
}

export default async function AnimationProjectPage({ params }: Props) {
  return <FilmPage section={section} slug={(await params).slug} />;
}
