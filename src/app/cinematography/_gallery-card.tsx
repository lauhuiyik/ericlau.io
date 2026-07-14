"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Props = {
  slug: string;
  title: string;
  client: string;
  vimeoId: string;
};

export function GalleryCard({ slug, title, client, vimeoId }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    fetch(`https://vimeo.com/api/v2/video/${vimeoId}.json`)
      .then((r) => r.json())
      .then((data) => {
        const url: string = data[0]?.thumbnail_large ?? data[0]?.thumbnail_medium ?? "";
        if (url) setThumbnail(url);
      })
      .catch(() => {});
  }, [visible, vimeoId]);

  return (
    <div ref={ref}>
      <Link
        href={`/cinematography/${slug}`}
        className="group block"
      >
        <div className="relative w-full aspect-video bg-[#111] overflow-hidden mb-3">
          {thumbnail && (
            <img
              src={thumbnail}
              alt={`${client} — ${title}`}
              onLoad={() => setLoaded(true)}
              className="w-full h-full object-cover transition-all duration-500 group-hover:scale-[1.03]"
              style={{ opacity: loaded ? 1 : 0 }}
            />
          )}
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
