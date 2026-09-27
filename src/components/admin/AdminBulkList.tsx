"use client";

import { useState } from "react";

/** Admin Content Lifecycle + Bulk Management V1 — the shared bulk-selection
 * primitive every entity's admin list can reuse (Products is the first;
 * Businesses/Events/Locations/People are designed to plug into this same
 * component later without a second, incompatible selection system).
 * Generalizes the exact selection pattern already proven in
 * AppearanceReviewList (Admin Where I'll Be Review Inbox V1): a plain
 * `Set<string>` of selected ids, "select all VISIBLE" that can only ever
 * select ids this component was actually handed as props (never a
 * server-side "everything matching the filter" — this component has no
 * way to select anything it wasn't given, by construction, which is what
 * makes "select all filtered results" truthful rather than a lie about
 * what's actually selected), and a selected-count display.
 *
 * This component owns ONLY selection state and the row/bulk-bar slots —
 * it knows nothing about what "Archive," "Trash," or "quick edit" mean
 * for any particular entity. That logic lives in each entity's own bulk
 * action bar (e.g. ProductBulkActionBar), passed in via `renderBulkBar`. */
export default function AdminBulkList<T extends { id: string }>({
  items,
  renderRow,
  renderBulkBar,
  emptyMessage = "No results for this view.",
}: {
  items: T[];
  renderRow: (item: T, selected: boolean, toggle: () => void) => React.ReactNode;
  /** Receives the live selected-id array and a clear-selection callback.
   * Omit entirely for a read-only list with no bulk actions available. */
  renderBulkBar?: (selectedIds: string[], clearSelection: () => void) => React.ReactNode;
  emptyMessage?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = items.length > 0 && selected.size === items.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  return (
    <div className="flex flex-col gap-2">
      {renderBulkBar && items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-2.5">
          <label className="flex items-center gap-2 text-xs font-semibold text-ink/70">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4" />
            Select all visible ({items.length})
            {selected.size > 0 && (
              <span className="text-ink/40">
                · {selected.size} selected
                <button type="button" onClick={clearSelection} className="ml-1 underline hover:text-ink">
                  clear
                </button>
              </span>
            )}
          </label>
          {renderBulkBar(Array.from(selected), clearSelection)}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-ink/50">{emptyMessage}</p>
      ) : (
        items.map((item) => renderRow(item, selected.has(item.id), () => toggle(item.id)))
      )}
    </div>
  );
}
