import Link from "next/link";
import { notFound } from "next/navigation";
import { projects } from "../_projects";

type Props = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return projects.map((p) => ({ slug: p.slug }));
}

export default async function ActivationProjectPage({ params }: Props) {
  const { slug } = await params;
  const project = projects.find((p) => p.slug === slug);
  if (!project) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-6 sm:px-12">
        <Link
          href="/activation"
          className="font-mono text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          ← Activation
        </Link>
      </header>

      <section className="px-6 sm:px-12 pt-12 pb-10 max-w-5xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">
          {project.client}
        </div>
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-[-0.03em] leading-[0.9]">
          {project.title}
        </h1>
      </section>

      <section className="px-6 sm:px-12 pb-24">
        <div className="w-full aspect-video">
          <iframe
            src={`https://www.youtube.com/embed/${project.youtubeId}`}
            allow="autoplay; fullscreen; picture-in-picture"
            className="w-full h-full"
            title={`${project.client} — ${project.title}`}
          />
        </div>
      </section>

      <footer className="border-t border-rule px-6 sm:px-12 py-8 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        <Link
          href="/activation"
          className="hover:text-foreground transition-colors"
        >
          ← Activation
        </Link>
      </footer>
    </div>
  );
}
