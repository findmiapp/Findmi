"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

// Shared presentational lightbox/slider — final refinement pass, item 15:
// the Event Gallery, the Event Venue Gallery, and the event cover trigger
// all reuse this exact component rather than three parallel
// implementations. Previous vs Next only render when there's more than
// one image; Escape/Left/Right work whenever mounted, backdrop click and
// the close button both dismiss.
//
// Reliability fix — public gallery pass: two real gaps, both closed here
// without touching how index/images/alt ever get here (every caller —
// ImageGalleryStrip, EventCoverLightbox — already passes one consistent
// array + index, verified against production data; this component was
// never the source of a thumbnail/active-image mismatch):
//   1. No touch handling existed at all, so mobile swipe simply did
//      nothing — not "unreliable", just absent. See handleTouchStart/End.
//   2. No onError handling on the active <Image>, so a single failed URL
//      (bad data, a deleted Storage object, a transient network error —
//      any of those) rendered as a bare broken-image icon with no
//      indication and, worse, gave no way to tell "this exact image
//      failed" from "the whole lightbox is broken". failedIndices below
//      tracks exactly (and only) images that have actually failed to
//      load — never a guess/heuristic applied ahead of time — and swaps
//      in a small, clearly-labeled placeholder for just that index.
//      index/hasMultiple/counter/arrows are completely unaffected by a
//      failure, so prev/next/swipe/counter keep working through however
//      many good images surround one bad one.
export default function ImageLightbox({
  images,
  initialIndex,
  alt,
  onClose,
}: {
  images: string[];
  initialIndex: number;
  alt: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [failedIndices, setFailedIndices] = useState<Set<number>>(new Set());
  const hasMultiple = images.length > 1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (hasMultiple && e.key === "ArrowRight") setIndex((i) => (i + 1) % images.length);
      else if (hasMultiple && e.key === "ArrowLeft") setIndex((i) => (i - 1 + images.length) % images.length);
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [hasMultiple, images.length, onClose]);

  // Swipe — a plain touch-delta check, no gesture library. Tracked as a
  // ref (not state) since these coordinates never need to trigger a
  // render themselves. Horizontal movement has to clearly dominate
  // vertical (so a vertical scroll/drag is never mistaken for a swipe)
  // and clear a real minimum distance (so a stray tap never is either).
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  function handleTouchStart(e: React.TouchEvent) {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || !hasMultiple) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) setIndex((i) => (i + 1) % images.length); // swiped left -> next
    else setIndex((i) => (i - 1 + images.length) % images.length); // swiped right -> previous
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 sm:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
      >
        <CloseGlyph className="h-5 w-5" />
      </button>

      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => (i - 1 + images.length) % images.length);
            }}
            aria-label="Previous image"
            className="absolute left-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:left-4"
          >
            <ChevronGlyph className="h-5 w-5 rotate-180" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => (i + 1) % images.length);
            }}
            aria-label="Next image"
            className="absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:right-4"
          >
            <ChevronGlyph className="h-5 w-5" />
          </button>
        </>
      )}

      <div
        className="relative h-full max-h-[85vh] w-full max-w-4xl"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {failedIndices.has(index) ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/50">
            <BrokenImageGlyph className="h-10 w-10" />
            <p className="text-xs">Image unavailable</p>
          </div>
        ) : (
          <Image
            key={images[index]}
            src={images[index]}
            alt={alt}
            fill
            sizes="100vw"
            className="object-contain"
            onError={() => setFailedIndices((prev) => new Set(prev).add(index))}
          />
        )}
      </div>

      {hasMultiple && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
          {index + 1} / {images.length}
        </div>
      )}
    </div>
  );
}

function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
