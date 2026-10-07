"use client";

import { GalleryTile, type JournalGalleryItem } from "./JournalPhotoGallery";

/** Public Moment Named-Section Carousel pass — media explicitly assigned
 * to a named section ("The Place", "The Experience", etc.) gets a
 * horizontally scrollable row instead of JournalPhotoGallery's mixed-size
 * editorial grid (anchor photo + grid) that flat/unassigned media still
 * uses. Reuses GalleryTile (image rendering, captions, click-to-open the
 * shared Global Media Viewer at the photo's real canonical index) verbatim
 * from JournalPhotoGallery — same image sources/optimization/ordering/
 * caption/click behavior as every other photo on this page, only the
 * surrounding layout differs. Ordering is preserved exactly as given (the
 * caller already passes photos in their stored display_order).
 *
 * Mixed-aspect editorial pass — an uncorrected uniform aspect-square rail
 * reads as repetitive/mechanical once several sections appear down the
 * page, so cards now vary in width (landscape wider, portrait narrower,
 * square medium) at one consistent CARD_HEIGHT, rather than forcing every
 * item into the same square box.
 *
 * Widths are a DETERMINISTIC pattern keyed to each item's own position
 * (EDITORIAL_RATIOS, cycled by index) — never the photo's own real aspect
 * ratio. This was a deliberate choice, not an oversight: no natural width/
 * height/aspect-ratio is stored anywhere upstream of this component today
 * (checked JournalEntryMediaRow/JournalMediaWithUrl in lib/journal.ts, the
 * journal_foundation and journal_entry_sections migrations, and the
 * image-variants pipeline — sharp computes real width/height during
 * upload-time variant generation in image-variants-server.ts, but
 * storePublicImage/storePrivateVariants only return whether variants were
 * stored, not the dimensions themselves, so nothing persists them). An
 * earlier version of this pass read the real ratio off the loaded <img> at
 * runtime (naturalWidth/naturalHeight via an onLoad handler), but that
 * meant every card started at a square default and then visibly resized
 * once its image finished loading — a real, user-visible horizontal
 * layout shift, worse the more out-of-bounds the real ratio was (as much
 * as CARD_HEIGHT - MIN_WIDTH ≈ 74px of shrink, or MAX_WIDTH - CARD_HEIGHT
 * ≈ 96px of growth, per card) and capable of moving a card out from under
 * a user mid-scroll. This pass replaces that with a width computed purely
 * from the item's index, so every card has its final, correct width on
 * first render, server or client, with no load-time dependency at all.
 * widthForRatio still clamps between MIN_WIDTH (so a very tall portrait
 * ratio could never collapse a card into an illegibly thin sliver) and
 * MAX_WIDTH (so a very wide landscape ratio could never swallow the whole
 * viewport and erase the next-card peek) — GalleryTile's own
 * `object-cover` absorbs the crop whenever a clamped box doesn't exactly
 * match a ratio, so nothing is ever stretched/distorted. */
const CARD_HEIGHT_CLASS = "h-56"; // Tailwind h-56 = 224px — keep in sync with CARD_HEIGHT below.
const CARD_HEIGHT = 224;
const MIN_WIDTH = 150; // portrait floor
const MAX_WIDTH = 320; // landscape ceiling — still leaves a next-card peek within a ~360px mobile content column

// landscape, portrait, square — repeating by position, never by the
// photo's own content, so the sequence is stable regardless of which
// images are assigned to a section or in what order they're reassigned.
const EDITORIAL_RATIOS = [4 / 3, 3 / 4, 1] as const;

function widthForRatio(ratio: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(CARD_HEIGHT * ratio)));
}

function widthForIndex(index: number): number {
  return widthForRatio(EDITORIAL_RATIOS[index % EDITORIAL_RATIOS.length]);
}

/** Left-gutter pass — the page's own content wrapper is `px-4 sm:px-0`
 * (see page.tsx), so without any correction this row would already start
 * flush with the section heading/relationship card above it. Only the
 * RIGHT edge is bled past that gutter (`-mr-4 pr-4`, undone again at
 * `sm:` once the page's own gutter itself goes to zero) so later cards
 * can keep extending/peeking toward the viewport edge — the usual
 * horizontal-scroll affordance — while the FIRST card's left edge never
 * moves from the page's normal gutter. */
export default function JournalSectionCarousel({ items }: { items: JournalGalleryItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="-mr-4 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 pr-4 sm:mr-0 sm:pr-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item, index) => (
        <div key={item.id} className="shrink-0 snap-start" style={{ width: widthForIndex(index) }}>
          <GalleryTile item={item} className={`${CARD_HEIGHT_CLASS} w-full`} sizes={`${MAX_WIDTH}px`} />
        </div>
      ))}
    </div>
  );
}
