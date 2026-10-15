"use client";

import { useState } from "react";
import type { Category } from "@/lib/types";
import { EVENT_FORMAT_IDS_FIELD, EVENT_FORMATS_PRESENT_FIELD } from "@/lib/event-formats";

/** Event Formats V1 — zero-to-many "how is this Event experienced?" picker
 * (kind='event_format' categories), separate from the single Category →
 * Subcategory field. In a form it submits `format_ids` (one per selected
 * Format) plus a `format_ids_present` marker, so a save only touches
 * Formats when this field was on the page. State-driven screens (Event
 * Import Review) pass `onChange` instead. Optional — nothing is required. */
export default function EventFormatField({
  formats,
  defaultSelectedIds = [],
  onChange,
  emptyText = "No Event Formats yet.",
}: {
  formats: Category[];
  defaultSelectedIds?: readonly string[];
  onChange?: (ids: string[]) => void;
  emptyText?: string;
}) {
  const [selected, setSelected] = useState<string[]>(() => formats.filter((f) => defaultSelectedIds.includes(f.id)).map((f) => f.id));
  const sorted = [...formats].sort((a, b) => a.name.localeCompare(b.name));

  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    onChange?.(next);
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 block text-sm font-medium text-ink">Format</legend>
      <input type="hidden" name={EVENT_FORMATS_PRESENT_FIELD} value="1" />
      {sorted.length === 0 ? (
        <p className="text-sm text-ink/45">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sorted.map((f) => {
            const on = selected.includes(f.id);
            return (
              <label
                key={f.id}
                className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  on ? "bg-findmi text-white" : "border border-black/10 text-ink/70 hover:border-black/20"
                }`}
              >
                <input type="checkbox" name={EVENT_FORMAT_IDS_FIELD} value={f.id} checked={on} onChange={() => toggle(f.id)} className="sr-only" />
                {f.name}
              </label>
            );
          })}
        </div>
      )}
      <p className="text-xs text-ink/40">How people experience it. Choose any that genuinely apply — or none.</p>
    </fieldset>
  );
}
