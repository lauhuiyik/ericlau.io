"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  alt: string;
  eager?: boolean;
};

export function GalleryImage({ src, alt, eager = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (eager) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [eager]);

  return (
    <div ref={ref} className="mb-3 break-inside-avoid bg-[#111] min-h-[4px]">
      {visible && (
        <img
          src={src}
          alt={alt}
          onLoad={() => setLoaded(true)}
          className="w-full block transition-opacity duration-500"
          style={{ opacity: loaded ? 1 : 0 }}
        />
      )}
    </div>
  );
}
