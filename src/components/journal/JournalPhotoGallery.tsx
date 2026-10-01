import Image from "next/image";

export interface JournalGalleryItem {
  id: string;
  url: string | null;
  caption: string | null;
  /** No schema field for this exists yet (Journal V1 ships with one
   * editorial gallery, not per-photo categories — see the migration's own
   * note on why). Always null today; this prop exists so a future
   * category column can flow straight into grouped sections here without
   * replacing this component — see groupByCategory below. */
  category?: string | null;
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
    return <GalleryTile item={items[0]} className="aspect-[4/3] w-full" sizes="(min-width: 640px) 672px, 100vw" />;
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
        <GalleryTile item={anchor} className="aspect-[16/10] w-full" sizes="(min-width: 640px) 672px, 100vw" />
      </div>
      {rest.map((item) => (
        <GalleryTile key={item.id} item={item} className="aspect-square" sizes="(min-width: 640px) 33vw, 50vw" />
      ))}
    </div>
  );
}

function GalleryTile({ item, className, sizes }: { item: JournalGalleryItem; className: string; sizes: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-mist ${className}`}>
      {item.url && <Image src={item.url} alt={item.caption ?? ""} fill unoptimized sizes={sizes} className="object-cover" />}
      {item.caption && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 p-2"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 70%)" }}
        >
          <p className="truncate text-[11px] font-medium text-white">{item.caption}</p>
        </div>
      )}
    </div>
  );
}
