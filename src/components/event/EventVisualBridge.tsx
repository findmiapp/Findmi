"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ImageLightbox from "../ImageLightbox";

export interface VisualBridgeItem {
  src: string;
  /** Moments link to their public Journal entry; gallery images open the
   * existing lightbox instead. */
  href?: string;
  label?: string;
}

/** Public Event V2.1 — the early visual bridge between the facts and the
 * actions: a compact feature image plus up to two smaller ones. Uses only
 * imagery that already exists (Findmi Moments covers first, else the
 * Event's own gallery — chosen by the caller); renders nothing otherwise.
 * Tapping goes to the existing Moment page or the existing image
 * lightbox — no new media experience. */
export default function EventVisualBridge({ items, alt }: { items: VisualBridgeItem[]; alt: string }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const shown = items.slice(0, 3);
  if (shown.length === 0) return null;
  const lightboxImages = items.filter((i) => !i.href).map((i) => i.src);

  const tile = (item: VisualBridgeItem, index: number, className: string) => {
    const img = (
      <Image src={item.src} alt="" fill unoptimized sizes="(min-width: 1024px) 480px, 66vw" className="object-cover transition duration-300 group-hover:scale-[1.02]" />
    );
    const base = `group relative block overflow-hidden rounded-2xl bg-mist ${className}`;
    if (item.href) {
      return (
        <Link key={item.src + index} href={item.href} aria-label={item.label ?? "View moment"} className={base}>
          {img}
        </Link>
      );
    }
    return (
      <button
        key={item.src + index}
        type="button"
        onClick={() => setOpenIndex(lightboxImages.indexOf(item.src))}
        aria-label={`View photo ${index + 1} of ${alt}`}
        className={base}
      >
        {img}
      </button>
    );
  };

  return (
    <>
      {shown.length === 1 ? (
        tile(shown[0], 0, "h-40 w-full sm:h-52")
      ) : (
        <div className="grid h-40 grid-cols-[2fr_1fr] gap-1.5 sm:h-52">
          {tile(shown[0], 0, "h-full")}
          {shown.length === 2 ? (
            tile(shown[1], 1, "h-full")
          ) : (
            <div className="grid grid-rows-2 gap-1.5">
              {tile(shown[1], 1, "h-full")}
              {tile(shown[2], 2, "h-full")}
            </div>
          )}
        </div>
      )}
      {openIndex !== null && openIndex >= 0 && (
        <ImageLightbox images={lightboxImages} initialIndex={openIndex} alt={alt} onClose={() => setOpenIndex(null)} />
      )}
    </>
  );
}
