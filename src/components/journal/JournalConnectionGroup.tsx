"use client";

import Image from "next/image";
import JournalSearchSelect, { type JournalSearchResult } from "./JournalSearchSelect";

/** Journal V1 — one searchable, multi-select connection group (Businesses/
 * Products/Events), shared by the Create wizard's Step 3 and the Edit
 * form so both build the exact same connection set the exact same way. */
export default function JournalConnectionGroup({
  label,
  entity,
  placeholder,
  selected,
  onAdd,
  onRemove,
}: {
  label: string;
  entity: "businesses" | "products" | "events";
  placeholder: string;
  selected: JournalSearchResult[];
  onAdd: (r: JournalSearchResult) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold uppercase tracking-wide text-ink/50">{label}</span>
      <JournalSearchSelect entity={entity} placeholder={placeholder} onSelect={onAdd} excludeIds={selected.map((r) => r.value)} />
      {selected.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {selected.map((r) => (
            <div key={r.value} className="flex items-center gap-2.5 rounded-xl border border-black/10 bg-white p-2.5">
              <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-black/5">
                {r.image_url && <Image src={r.image_url} alt="" fill unoptimized sizes="32px" className="object-cover" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{r.label}</span>
              <button type="button" onClick={() => onRemove(r.value)} className="shrink-0 text-xs font-semibold text-ink/50 hover:text-ink">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
