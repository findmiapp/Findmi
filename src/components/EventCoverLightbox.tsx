"use client";

import { useState } from "react";
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
export default function EventCoverLightbox({ images, alt }: { images: string[]; alt: string }) {
  const [open, setOpen] = useState(false);
  const cover = images[0];
  if (!cover) return null;

  return (
    <>
      <Image src={cover} alt={alt} fill priority sizes="(min-width: 1024px) 1024px, 100vw" className="object-cover" />
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
