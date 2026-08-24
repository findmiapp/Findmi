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
          {items.map((item) => (
            <div key={item.value} className="flex items-center justify-between gap-2 rounded-xl border border-black/10 bg-white px-3 py-2">
              <input type="hidden" name="curated_id" value={item.value} />
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar url={item.image_url} label={item.label} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{item.label}</p>
                  {item.sublabel && <p className="truncate text-xs text-ink/45">{item.sublabel}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(item.value)}
                className="shrink-0 text-xs font-semibold text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
