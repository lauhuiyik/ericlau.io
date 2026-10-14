"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Props = {
  href: string;
  title: string;
  client: string;
  /** 16:9 thumbnail (see src/lib/films.ts). */
  thumb: string;
};

/** A film in a section grid (cinematography, activation, animation). */
export function FilmCard({ href, title, client, thumb }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  // A cached image can finish loading before React hydrates and attaches
  // onLoad, which would leave it faded out; catch that case here.
  useEffect(() => {
    if (imgRef.current?.complete) setLoaded(true);
  }, []);

  return (
    <div>
      <Link
        href={href}
        className="group block"
      >
        <div className="relative w-full aspect-video bg-[#111] overflow-hidden mb-3">
          <img
            ref={imgRef}
            src={thumb}
            alt={`${client} — ${title}`}
            width={960}
            height={540}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            className="w-full h-full object-cover transition-all duration-500 group-hover:scale-[1.03]"
            style={{ opacity: loaded ? 1 : 0 }}
          />
          <div className="absolute inset-0 flex items-end p-4 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/80">
              View project ↗
            </span>
          </div>
        </div>
        <div className="text-base font-medium tracking-tight group-hover:text-muted transition-colors">
          {title}
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          {client}
        </div>
      </Link>
    </div>
  );
}
