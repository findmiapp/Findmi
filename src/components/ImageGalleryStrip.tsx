"use client";

import { useState } from "react";
import Image from "next/image";
import ImageLightbox from "./ImageLightbox";

// Shared compact thumbnail strip — used for both the Event Gallery and
// the About the Venue gallery (final refinement pass, items 9/10/15).
// Tapping any tile opens the same ImageLightbox, positioned at that
// tile's own index. Renders nothing with 0-1 images (nothing to browse).
export default function ImageGalleryStrip({ images, alt }: { images: string[]; alt: string }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (images.length < 2) return null;

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {images.map((src, i) => (
          <button
            key={`${src}-${i}`}
            type="button"
            onClick={() => setOpenIndex(i)}
            className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-black/10 bg-mist transition active:scale-95 sm:h-20 sm:w-20"
          >
            <Image src={src} alt={alt} fill sizes="80px" className="object-cover" />
          </button>
        ))}
      </div>
      {openIndex !== null && (
        <ImageLightbox images={images} initialIndex={openIndex} alt={alt} onClose={() => setOpenIndex(null)} />
      )}
    </>
  );
}
