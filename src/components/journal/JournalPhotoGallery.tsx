"use client";

import Image from "next/image";
import { JournalPhotoTrigger } from "./JournalMediaViewer";

export interface JournalGalleryItem {
  id: string;
  /** Card-size (800px) display URL — the original when no variant exists. */
  url: string | null;
  /** Large (1600px) display URL for the full-width anchor/single photo. */
  largeUrl?: string | null;
  caption: string | null;
  /** Public Moment continuous gallery — the photo's visible category (its
   * section's label), shown as a small bottom-right badge. Null/absent for
   * an uncategorized photo or an untitled `other` section: no badge. */
  badge?: string | null;
  /** Global Media Viewer V1 — this photo's position within the full,
   * canonically-ordered (display_order ascending) Journal media
   * collection, including the cover — never this item's own position
   * within just the gallery subset — or, when the gallery sits inside its
   * own nested JournalMediaViewerRoot (the continuous Moment gallery), its
   * position within that root's items. -1 when it couldn't be resolved
   * (e.g. a signed URL failed to generate), in which case the tile
   * renders as a plain, non-interactive photo rather than a dead button. */
  mediaIndex: number;
}

/** Journal V1 (visual convergence pass) — the Detail page's editorial
 * photo presentation: a deterministic, order-driven grid (never fake
 * AI/inferred categories) with one larger anchor photo once there are
 * enough images to make one, rather than a uniform database-grid of
 * identical squares. Captions render when the existing `caption` field on
 * a photo is set — never invented. Public Moment continuous gallery: ONE
 * continuous stream in the order given (no grouping, no headings); a
 * photo's category shows only as its own small badge. */
export default function JournalPhotoGallery({ items }: { items: JournalGalleryItem[] }) {
  if (items.length === 0) return null;
  return <EditorialGrid items={items} />;
}

function EditorialGrid({ items }: { items: JournalGalleryItem[] }) {
  if (items.length === 1) {
    return <GalleryTile item={items[0]} large className="aspect-[4/3] w-full" sizes="(min-width: 640px) 672px, 100vw" />;
  }
  if (items.length === 2) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <GalleryTile key={item.id} item={item} className="aspect-square" sizes="(min-width: 640px) 33vw, 50vw" />
        ))}
      </div>
    );
  }
  const [anchor, ...rest] = items;
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="col-span-2">
        <GalleryTile item={anchor} large className="aspect-[16/10] w-full" sizes="(min-width: 640px) 672px, 100vw" />
      </div>
      {rest.map((item) => (
        <GalleryTile key={item.id} item={item} className="aspect-square" sizes="(min-width: 640px) 33vw, 50vw" />
      ))}
    </div>
  );
}

/** One gallery photo: image, optional category badge, click-to-open
 * viewer, and its caption underneath. */
export function GalleryTile({ item, className, sizes, large = false }: { item: JournalGalleryItem; className: string; sizes: string; large?: boolean }) {
  const src = (large ? item.largeUrl : null) ?? item.url;
  const image = src && <Image src={src} alt={item.caption ?? ""} fill unoptimized sizes={sizes} className="object-cover" />;
  // Category badge — quiet metadata, not a control: dark translucent
  // neutral chip, bottom-right, no icon. aria-hidden: the category is
  // already conveyed by the filter strip, so screen readers aren't told
  // it again on every photo.
  const badge = item.badge ? (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-2 right-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white/90 backdrop-blur-sm"
    >
      {item.badge}
    </span>
  ) : null;

  // No URL at all (nothing to view full-screen) — a plain, non-interactive
  // tile, same as before this pass.
  const tile =
    !item.url || item.mediaIndex < 0 ? (
      <div className={`relative overflow-hidden rounded-xl bg-mist ${className}`}>
        {image}
        {badge}
      </div>
    ) : (
      <JournalPhotoTrigger index={item.mediaIndex} label="View photo" className={`relative overflow-hidden rounded-xl bg-mist ${className}`}>
        {image}
        {badge}
      </JournalPhotoTrigger>
    );

  // Public Moment V2 — the author's own photo note reads as supporting
  // text directly under its photo (in full), not a one-line truncated
  // overlay; no label, no field name.
  if (!item.caption) return tile;
  return (
    <figure className="min-w-0">
      {tile}
      <figcaption className="mt-1.5 whitespace-pre-line text-sm leading-snug text-ink/70">{item.caption}</figcaption>
    </figure>
  );
}
