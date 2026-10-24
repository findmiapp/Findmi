"use client";

import { useState } from "react";
import type { Category } from "@/lib/types";
import { EVENT_FORMAT_IDS_FIELD, EVENT_FORMATS_PRESENT_FIELD } from "@/lib/event-formats";
import PickerSheet, { matchesQuery } from "./PickerSheet";

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
  variant = "pills",
}: {
  formats: Category[];
  defaultSelectedIds?: readonly string[];
  onChange?: (ids: string[]) => void;
  emptyText?: string;
  /** "compact" (Business-facing Event screens): selected Formats summarized
   * on one line; the full list opens in a searchable multi-select sheet.
   * Same zero-to-many `format_ids` + presence marker either way. */
  variant?: "pills" | "compact";
}) {
  const [selected, setSelected] = useState<string[]>(() => formats.filter((f) => defaultSelectedIds.includes(f.id)).map((f) => f.id));
  const sorted = [...formats].sort((a, b) => a.name.localeCompare(b.name));

  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    onChange?.(next);
  }

  if (variant === "compact") return <CompactFormats sorted={sorted} selected={selected} toggle={toggle} emptyText={emptyText} />;

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

/** "Pop-Up, Tasting +2" — the selected Formats in a short line. */
export function formatSummary(names: readonly string[], max = 2): string | null {
  if (names.length === 0) return null;
  return names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} +${names.length - max}`;
}

function CompactFormats({ sorted, selected, toggle, emptyText }: { sorted: Category[]; selected: string[]; toggle: (id: string) => void; emptyText: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const names = sorted.filter((f) => selected.includes(f.id)).map((f) => f.name);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="block text-sm font-medium text-ink">Format</span>
      <input type="hidden" name={EVENT_FORMATS_PRESENT_FIELD} value="1" />
      {selected.map((id) => (
        <input key={id} type="hidden" name={EVENT_FORMAT_IDS_FIELD} value={id} />
      ))}
      {sorted.length === 0 ? (
        <p className="text-sm text-ink/45">{emptyText}</p>
      ) : (
        <PickerSheet
          label="Format"
          summary={formatSummary(names)}
          placeholder="How do people experience it? (optional)"
          title="Format"
          searchPlaceholder={sorted.length > 8 ? "Search formats" : undefined}
          query={query}
          onQuery={setQuery}
          open={open}
          onOpenChange={setOpen}
        >
          <ul className="flex flex-col gap-0.5 py-1">
            {sorted
              .filter((f) => matchesQuery(f.name, query))
              .map((f) => {
                const on = selected.includes(f.id);
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(f.id)}
                      className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm transition ${on ? "bg-findmi-50 font-semibold text-findmi-700" : "text-ink hover:bg-black/[0.03]"}`}
                    >
                      <span className="min-w-0 truncate">{f.name}</span>
                      <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs ${on ? "border-findmi bg-findmi text-white" : "border-black/20"}`}>
                        {on ? "✓" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </PickerSheet>
      )}
    </div>
  );
}
