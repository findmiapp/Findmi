"use client";

import { GalleryTile, type JournalGalleryItem } from "./JournalPhotoGallery";

/** Public Moment Named-Section Carousel pass — media explicitly assigned
 * to a named section ("The Place", "The Experience", etc.) gets a
 * horizontally scrollable row of consistent square cards instead of
 * JournalPhotoGallery's mixed-size editorial grid (anchor photo + grid)
 * that flat/unassigned media still uses. The visual distinction is
 * intentional: a named section reads as a curated set of a kind ("here
 * are the drink photos"), so a uniform swipeable row communicates that
 * more directly than a grid that visually competes with the main photo
 * story — and keeps a section from consuming a large vertical span on
 * mobile, where several sections can otherwise push real content far down
 * the page.
 *
 * Reuses GalleryTile (image rendering, captions, click-to-open the shared
 * Global Media Viewer at the photo's real canonical index) verbatim from
 * JournalPhotoGallery — same image sources/optimization/ordering/caption/
 * click behavior as every other photo on this page, only the surrounding
 * layout differs. Ordering is preserved exactly as given (the caller
 * already passes photos in their stored display_order — see page.tsx).
 *
 * Sizing: ~70% of the mobile content width per card (within the 68-72%
 * range), so the next card visibly peeks in to signal swipeability,
 * without needing pagination dots or arrow controls. `-mx-4 px-4` cancels
 * the page body's own 16px mobile gutter (see page.tsx's `px-4 sm:px-0`
 * wrapper) so cards can bleed to the viewport edge while staying aligned
 * with the rest of the page's content on the left. At `sm:` (640px) and
 * up, the page's own content column is already capped at 672px (see
 * page.tsx's `max-w-2xl` / `sm:px-0`) — 70% of that would be ~470px per
 * card, far too large, so this switches to a fixed, modest card width
 * instead (`sm:w-60`, 240px) that still shows a clear next-card peek
 * within that column, rather than scaling with the viewport. No
 * pagination dots, no prev/next buttons at any size — native scroll/swipe
 * plus CSS scroll-snap is the entire interaction, same restrained-
 * affordance principle JournalPhotoTrigger's own doc already states. A
 * single-item section renders as one bounded, non-stretched square card —
 * the same component, nothing faked or special-cased for that count. */
export default function JournalSectionCarousel({ items }: { items: JournalGalleryItem[] }) {
  if (items.length === 0) return null;
  return (
    <div
      className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => (
        <div key={item.id} className="w-[70%] shrink-0 snap-start sm:w-60">
          <GalleryTile item={item} className="aspect-square w-full" sizes="(min-width: 640px) 240px, 70vw" />
        </div>
      ))}
    </div>
  );
}
