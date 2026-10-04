"use client";

import { useState } from "react";
import SupabaseImage from "@/components/SupabaseImage";
import ImageLightbox from "@/components/ImageLightbox";

const MAX_VISIBLE = 5;

/** Event Gallery / Photos (Public Event V2 Next Body pass) — editorial
 * Event imagery (event_images, kind='event'), distinct from Findmi Moments
 * (community Journal content). A curated mosaic, never a full image dump:
 * at most 5 tiles show; a "+N" overlay on the last tile opens the shared
 * ImageLightbox with the COMPLETE image set so prev/next reaches every
 * remaining photo — no second route needed for "see the rest". */
export default function EventGalleryMosaic({ images, alt }: { images: string[]; alt: string }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (images.length === 0) return null;
  const visible = images.slice(0, MAX_VISIBLE);
  const remaining = images.length - visible.length;

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:grid-rows-2">
        {visible.map((src, i) => {
          const isFeature = i === 0;
          const isLast = i === visible.length - 1;
          return (
            <button
              key={`${src}-${i}`}
              type="button"
              onClick={() => setOpenIndex(i)}
              className={`group relative overflow-hidden rounded-2xl border border-black/5 bg-mist transition active:scale-[0.99] ${
                isFeature ? "col-span-2 aspect-[16/10] sm:row-span-2 sm:aspect-auto" : "aspect-square"
              }`}
            >
              <SupabaseImage
                src={src}
                alt={alt}
                fill
                unoptimized
                sizes="(min-width: 640px) 25vw, 50vw"
                className="object-cover transition duration-300 group-hover:scale-[1.02]"
              />
              {isLast && remaining > 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-lg font-bold text-white">
                  +{remaining}
                </div>
              )}
            </button>
          );
        })}
      </div>
      {openIndex !== null && (
        <ImageLightbox images={images} initialIndex={openIndex} alt={alt} onClose={() => setOpenIndex(null)} />
      )}
    </>
  );
}
