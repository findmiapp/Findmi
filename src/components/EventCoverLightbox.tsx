"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import ImageLightbox from "./ImageLightbox";

// Final refinement pass, item 9 — now a real multi-image slider (not the
// previous single-image-only version): `images` is the full ordered list
// with the cover first (event.cover_image_url followed by any real
// event_images gallery rows). Clicking the cover opens ImageLightbox at
// index 0, with previous/next through everything else. With only a cover
// and no gallery, `images` has length 1 and the lightbox simply shows
// that one image with no prev/next controls — unchanged from the
// original single-image behavior.
export default function EventCoverLightbox({
  images,
  alt,
  parallax = false,
}: {
  images: string[];
  alt: string;
  /** Public Event V2.1 — opt-in scroll depth for the cover (see
   * .findmi-hero-parallax in globals.css: 48px over the first 320px of
   * scroll). The image sits in a wrapper 48px taller than the hero (extra
   * height above), so the drift never exposes an edge. Reduced motion →
   * static cover. Location pages don't pass it. */
  parallax?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const driftRef = useRef<HTMLDivElement>(null);
  const cover = images[0];

  // Fallback only for browsers WITHOUT CSS scroll-driven animations: the
  // same 48px / 320px drift written straight to style.transform from a
  // passive scroll listener, at most once per frame. No React state.
  useEffect(() => {
    const el = driftRef.current;
    if (!parallax || !el || typeof CSS === "undefined") return;
    if (CSS.supports("animation-timeline: scroll()")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const y = Math.min(48, Math.max(0, window.scrollY) * 0.15);
      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [parallax]);
  if (!cover) return null;

  return (
    <>
      {/* unoptimized — same fix as HomeEventCard: this cover is a valid
          Supabase Storage URL (root-caused against production data — the
          object itself is intact), but Vercel's next/image optimizer was
          failing to serve it. Bypassing the optimizer fetches the
          original file directly instead of relying on that failing
          pipeline. */}
      {parallax ? (
        <div ref={driftRef} className="findmi-hero-parallax absolute inset-x-0 -top-12 bottom-0">
          <Image src={cover} alt={alt} fill priority unoptimized sizes="100vw" className="object-cover" />
        </div>
      ) : (
        <Image
          src={cover}
          alt={alt}
          fill
          priority
          unoptimized
          sizes="(min-width: 1024px) 1024px, 100vw"
          className="object-cover"
        />
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="View larger image"
        className="absolute inset-0 z-[1] cursor-zoom-in"
      />
      {open && <ImageLightbox images={images} initialIndex={0} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
