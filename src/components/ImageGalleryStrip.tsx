"use client";

import { useState } from "react";
import Image from "next/image";
import ImageLightbox from "./ImageLightbox";

// Shared compact thumbnail strip — used for both the Event Gallery and
// the About the Venue gallery (final refinement pass, items 9/10/15).
// Tapping any tile opens the same ImageLightbox, positioned at that
// tile's own index. Renders nothing with 0-1 images (nothing to browse).
//
// Reliability fix — public gallery pass: failedIndices tracks only
// thumbnails that have actually failed to load (a real onError, never a
// guess ahead of time) and swaps in a small placeholder tile for just
// that one — same size/position/border as a normal thumbnail, so the
// strip's layout never shifts. The tile stays tappable either way: even
// a broken thumbnail still opens the lightbox at its own exact index
// (which shows the same graceful "Image unavailable" state there — see
// ImageLightbox), so a bad tile never blocks reaching the good ones
// around it.
export default function ImageGalleryStrip({ images, alt }: { images: string[]; alt: string }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [failedIndices, setFailedIndices] = useState<Set<number>>(new Set());
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
            {failedIndices.has(i) ? (
              <div className="flex h-full w-full items-center justify-center text-ink/25">
                <BrokenImageGlyph className="h-5 w-5" />
              </div>
            ) : (
              <Image
                src={src}
                alt={alt}
                fill
                sizes="80px"
                className="object-cover"
                onError={() => setFailedIndices((prev) => new Set(prev).add(i))}
              />
            )}
          </button>
        ))}
      </div>
      {openIndex !== null && (
        <ImageLightbox images={images} initialIndex={openIndex} alt={alt} onClose={() => setOpenIndex(null)} />
      )}
    </>
  );
}

function BrokenImageGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 16l5-5 3 3 4-4 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 4.5l16 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
