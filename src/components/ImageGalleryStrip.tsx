"use client";

import { useState } from "react";
import SupabaseImage from "./SupabaseImage";
import ImageLightbox from "./ImageLightbox";

// Shared compact thumbnail strip — used for the Business Gallery, the
// Event Gallery, and the About the Venue gallery (final refinement pass,
// items 9/10/15). Tapping any tile opens the same ImageLightbox,
// positioned at that tile's own index. Renders nothing with 0-1 images
// (nothing to browse).
//
// Gallery thumbnails missing fix — this used next/image's <Image>
// directly, only bypassing Vercel's optimizer when a caller explicitly
// passed `unoptimized` (the event page's cover+gallery call did; the
// business Gallery section and the event page's own venue-photos call
// did not). Root-caused against production data (Madrina Vegana's
// business_images): the stored URLs are completely valid, intact
// Supabase Storage objects — the same optimizer failure already fixed
// everywhere else in the app (see SupabaseImage's own comment) was simply
// never applied here for those two callers, so their thumbnails rendered
// as permanently empty/gray tiles. Now uses SupabaseImage (the estab-
// lished drop-in fix), which auto-detects a Supabase Storage URL and
// bypasses the optimizer for it — every caller is fixed at this one
// shared layer, with no per-callsite opt-in required. The `unoptimized`
// prop below still works exactly as before for any caller that passes it
// explicitly; it's just no longer necessary for a Supabase-hosted image.
//
// 2x thumbnail size pass: tiles doubled from h-16/w-16 (sm:h-20/w-20) to
// h-32/w-32 (sm:h-40/w-40) — 128px mobile, 160px sm+ — so ~2-2.5 tiles
// show at once on a typical phone width instead of shrinking to fit.
// Everything else (one-row flex + overflow-x-auto scroll, gap, rounded
// corners, border, tap target, lightbox wiring) is unchanged.
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
export default function ImageGalleryStrip({
  images,
  alt,
  unoptimized,
}: {
  images: string[];
  alt: string;
  /** Forces bypassing next/image optimization for every thumbnail in this
   * strip, regardless of source. No longer required for a Supabase-hosted
   * image — SupabaseImage (used below) already detects and bypasses those
   * automatically. Kept only for a caller that needs to force it for a
   * non-Supabase URL too. */
  unoptimized?: boolean;
}) {
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
            className="relative h-32 w-32 shrink-0 overflow-hidden rounded-lg border border-black/10 bg-mist transition active:scale-95 sm:h-40 sm:w-40"
          >
            {failedIndices.has(i) ? (
              <div className="flex h-full w-full items-center justify-center text-ink/25">
                <BrokenImageGlyph className="h-5 w-5" />
              </div>
            ) : (
              <SupabaseImage
                src={src}
                alt={alt}
                fill
                unoptimized={unoptimized}
                sizes="(min-width: 640px) 160px, 128px"
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
