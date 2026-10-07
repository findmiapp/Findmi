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
  /** No schema field for this exists yet (Journal V1 ships with one
   * editorial gallery, not per-photo categories — see the migration's own
   * note on why). Always null today; this prop exists so a future
   * category column can flow straight into grouped sections here without
   * replacing this component — see groupByCategory below. */
  category?: string | null;
  /** Global Media Viewer V1 — this photo's position within the full,
   * canonically-ordered (display_order ascending) Journal media
   * collection, including the cover — never this item's own position
   * within just the gallery subset. -1 when it couldn't be resolved
   * (e.g. a signed URL failed to generate), in which case the tile
   * renders as a plain, non-interactive photo rather than a dead button. */
  mediaIndex: number;
}

/** Journal V1 (visual convergence pass) — the Detail page's editorial
 * photo presentation: a deterministic, order-driven grid (never fake
 * AI/inferred categories) with one larger anchor photo once there are
 * enough images to make one, rather than a uniform database-grid of
 * identical squares. Captions render when the existing `caption` field on
 * a photo is set — never invented. Grouped by `category` so that once a
 * future migration adds real per-photo categories, this component already
 * renders them as labeled sections; with none set (today, always), every
 * photo collapses into one ungrouped, unlabeled section. */
export default function JournalPhotoGallery({ items }: { items: JournalGalleryItem[] }) {
  if (items.length === 0) return null;
  const groups = groupByCategory(items);

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.key}>
          {group.label && <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-ink/50">{group.label}</p>}
          <EditorialGrid items={group.items} />
        </div>
      ))}
    </div>
  );
}

function groupByCategory(items: JournalGalleryItem[]): { key: string; label: string | null; items: JournalGalleryItem[] }[] {
  const order: string[] = [];
  const byKey = new Map<string, JournalGalleryItem[]>();
  for (const item of items) {
    const key = item.category ?? "__uncategorized__";
    if (!byKey.has(key)) {
      order.push(key);
      byKey.set(key, []);
    }
    byKey.get(key)!.push(item);
  }
  // A single, uncategorized group (every item today) renders with no
  // label at all — a redundant "Photos" heading right under the gallery's
  // own section context would add nothing. A real future category renders
  // its own name as the label.
  if (order.length === 1 && order[0] === "__uncategorized__") {
    return [{ key: "all", label: null, items: byKey.get("__uncategorized__")! }];
  }
  return order.map((key) => ({ key, label: key === "__uncategorized__" ? null : key, items: byKey.get(key)! }));
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

/** Exported so JournalSectionCarousel (named-section horizontal carousel)
 * can reuse the EXACT same image/caption/click-to-open-viewer rendering
 * this flat editorial gallery already uses, rather than a second
 * reimplementation that could drift from it — only the surrounding
 * layout differs between the two. */
export function GalleryTile({ item, className, sizes, large = false }: { item: JournalGalleryItem; className: string; sizes: string; large?: boolean }) {
  const src = (large ? item.largeUrl : null) ?? item.url;
  const image = src && <Image src={src} alt={item.caption ?? ""} fill unoptimized sizes={sizes} className="object-cover" />;

  // No URL at all (nothing to view full-screen) — a plain, non-interactive
  // tile, same as before this pass.
  const tile =
    !item.url || item.mediaIndex < 0 ? (
      <div className={`relative overflow-hidden rounded-xl bg-mist ${className}`}>{image}</div>
    ) : (
      <JournalPhotoTrigger index={item.mediaIndex} label="View photo" className={`relative overflow-hidden rounded-xl bg-mist ${className}`}>
        {image}
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
