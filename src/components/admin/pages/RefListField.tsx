"use client";

import { useState } from "react";
import { Avatar, EntitySearchAdd } from "@/components/admin/RelationPicker";

export interface RefItem {
  /** What the hidden input submits: "kind:id" (references) or a bare id
   * (Brand / Place filters). */
  value: string;
  label: string;
  sublabel?: string;
  image_url?: string | null;
}

/** Pages + Sections V1B — one ordered list of entity references inside a
 * Section form (Picked, Pinned, Excluded, Brand / Place filters). Search
 * reuses the bounded Admin search (EntitySearchAdd → /admin/api/search);
 * items submit as hidden inputs in on-screen order, so Save persists the
 * order. Reordering is plain ↑ / ↓ (no drag-and-drop). */
export default function RefListField({
  name,
  label,
  hint,
  search,
  refKind,
  initial,
  ordered = false,
  emptyText = "Nothing added yet.",
}: {
  name: string;
  label: string;
  hint?: string;
  /** Admin search entity, or null for a list only fed from Preview Results. */
  search: "businesses" | "events" | "products" | "locations" | null;
  /** Prefix for search results ("event" → "event:<id>"); null submits ids. */
  refKind: string | null;
  initial: RefItem[];
  ordered?: boolean;
  emptyText?: string;
}) {
  const [items, setItems] = useState<RefItem[]>(initial);
  const valueOf = (id: string) => (refKind ? `${refKind}:${id}` : id);
  const move = (i: number, d: -1 | 1) =>
    setItems((prev) => {
      const t = i + d;
      if (t < 0 || t >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[t]] = [next[t], next[i]];
      return next;
    });
  const btn = "flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-ink/60 transition hover:bg-black/[0.03] disabled:opacity-30";

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      {hint && <p className="mb-1.5 text-xs text-ink/45">{hint}</p>}
      {search && (
        <EntitySearchAdd
          entity={search}
          placeholder="Search to add…"
          excludeIds={new Set(items.map((i) => (refKind ? i.value.slice(refKind.length + 1) : i.value)))}
          onAdd={(r) => setItems((prev) => [...prev, { value: valueOf(r.value), label: r.label, sublabel: r.sublabel, image_url: r.image_url }])}
        />
      )}
      {items.length === 0 ? (
        <p className="mt-1.5 text-xs text-ink/40">{emptyText}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {items.map((item, i) => (
            <li key={item.value} className="flex items-center justify-between gap-2 rounded-xl border border-black/10 bg-white px-3 py-2">
              <input type="hidden" name={name} value={item.value} />
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar url={item.image_url ?? null} label={item.label} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{item.label}</p>
                  {item.sublabel && <p className="truncate text-xs text-ink/45">{item.sublabel}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {ordered && (
                  <>
                    <button type="button" className={btn} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${item.label} up`}>
                      ↑
                    </button>
                    <button type="button" className={btn} onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`Move ${item.label} down`}>
                      ↓
                    </button>
                  </>
                )}
                <button type="button" className={btn} onClick={() => setItems((prev) => prev.filter((p) => p.value !== item.value))} aria-label={`Remove ${item.label}`}>
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
