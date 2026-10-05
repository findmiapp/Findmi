"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import ImageLightbox from "./ImageLightbox";
import SupabaseImage from "./SupabaseImage";

const PREVIEW_COUNT = 3;

/** Location Public Page Composition pass — a compact, early peek at the
 * Location's OWN gallery (location_images only — never Event/Business
 * imagery): up to 3 short tiles, the last showing "+N" when more exist.
 * Any tile opens the shared ImageLightbox at that photo, with the whole
 * gallery browsable. The full Gallery section further down is unchanged. */
export default function LocationPhotoPreview({ images, alt }: { images: string[]; alt: string }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  if (images.length === 0) return null;
  const tiles = images.slice(0, PREVIEW_COUNT);
  const extra = images.length - tiles.length;

  return (
    <>
      <ul className="grid grid-cols-3 gap-1.5 sm:gap-2" aria-label={`Photos of ${alt}`}>
        {tiles.map((src, i) => {
          const showMore = extra > 0 && i === tiles.length - 1;
          return (
            <li key={`${src}-${i}`}>
              <button
                type="button"
                onClick={(e) => {
                  lastTrigger.current = e.currentTarget;
                  setOpenIndex(i);
                }}
                aria-label={showMore ? `View all ${images.length} photos of ${alt}` : `View photo ${i + 1} of ${images.length} of ${alt}`}
                className="relative block aspect-[4/3] w-full overflow-hidden rounded-xl bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi sm:aspect-[16/9]"
              >
                <SupabaseImage src={src} alt="" fill sizes="(min-width: 640px) 280px, 33vw" className="object-cover" />
                {showMore && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-base font-bold text-white">+{extra}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {openIndex !== null &&
        createPortal(
          <ImageLightbox
            images={images}
            initialIndex={openIndex}
            alt={alt}
            onClose={() => {
              setOpenIndex(null);
              lastTrigger.current?.focus();
            }}
          />,
          document.body
        )}
    </>
  );
}
