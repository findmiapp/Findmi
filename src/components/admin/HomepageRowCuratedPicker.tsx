"use client";

import { useState } from "react";
import { Avatar, EntitySearchAdd, type SearchResult } from "./RelationPicker";

/** Curated-mode item picker for one Homepage Row — same search-and-add
 * pattern as ParticipationRoster (event rosters), reused rather than
 * reinvented. Renders hidden `curated_id` inputs in the founder's chosen
 * order, which the row's Server Action reads via formData.getAll and
 * saves as-is into homepage_rows.curated_ids. */
export default function HomepageRowCuratedPicker({
  entity,
  initialItems,
}: {
  entity: "businesses" | "events" | "products";
  initialItems: SearchResult[];
}) {
  const [items, setItems] = useState<SearchResult[]>(initialItems);

  const add = (r: SearchResult) => setItems((prev) => [...prev, r]);
  const remove = (value: string) => setItems((prev) => prev.filter((i) => i.value !== value));
  // Account/Business Create-Strip precedent's move-up/down language,
  // applied here to the founder's own display order — the hidden
  // curated_id inputs already submit in array order (see the doc
  // comment above), so reordering this client-side state is the whole
  // fix: no separate action, no round trip, Save persists whatever
  // order is on screen.
  function move(index: number, direction: "up" | "down") {
    setItems((prev) => {
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">Items</span>
      <EntitySearchAdd
        entity={entity}
        placeholder={`Search ${entity}…`}
        excludeIds={new Set(items.map((i) => i.value))}
        onAdd={add}
      />
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-ink/45">Nothing picked yet — search above to add items, in the order you want them shown.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {items.map((item, index) => (
            <div key={item.value} className="flex items-center justify-between gap-2 rounded-xl border border-black/10 bg-white px-3 py-2">
              <input type="hidden" name="curated_id" value={item.value} />
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar url={item.image_url} label={item.label} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{item.label}</p>
                  {item.sublabel && <p className="truncate text-xs text-ink/45">{item.sublabel}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, "up")}
                  disabled={index === 0}
                  aria-label={`Move ${item.label} up`}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-black/10 text-ink/60 transition hover:bg-black/[0.03] disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, "down")}
                  disabled={index === items.length - 1}
                  aria-label={`Move ${item.label} down`}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-black/10 text-ink/60 transition hover:bg-black/[0.03] disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(item.value)}
                  className="ml-1 text-xs font-semibold text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
