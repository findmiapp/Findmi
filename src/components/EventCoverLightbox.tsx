"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

// Event Detail V2 polish pass, item 14 — events have no gallery/multi-
// image field today (only a single cover_image_url; see the pass report
// for what a real gallery would need), so this is the smallest real
// feature consistent with existing media handling: the one real cover
// image becomes clickable and opens a lightbox instead of building a
// fabricated multi-image gallery out of a single photo. Closes on the
// backdrop click, the close button, or Escape.
export default function EventCoverLightbox({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <Image src={src} alt={alt} fill priority sizes="(min-width: 1024px) 1024px, 100vw" className="object-cover" />
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="View larger image"
        className="absolute inset-0 z-[1] cursor-zoom-in"
      />
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 sm:p-8"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <CloseGlyph className="h-5 w-5" />
          </button>
          <div className="relative h-full max-h-[85vh] w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <Image src={src} alt={alt} fill sizes="100vw" className="object-contain" />
          </div>
        </div>
      )}
    </>
  );
}

function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
