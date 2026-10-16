"use client";

import { useState } from "react";
import type { Category } from "@/lib/types";
import { groupEventCategories } from "@/lib/event-categories";
import LifecycleBulkActionBar from "@/components/admin/LifecycleBulkActionBar";
import BulkLifecycleToolbar, { pillClass } from "@/components/admin/BulkLifecycleToolbar";
import { eventEligibility, type EventTransition } from "@/lib/admin/lifecycle-eligibility";
import {
  bulkArchiveEvents,
  bulkPermanentDeleteEvents,
  bulkQuickEditEvents,
  bulkRestoreEventsFromArchive,
  bulkRestoreEventsFromTrash,
  bulkTransitionEvents,
  bulkTrashEvents,
} from "./lifecycle-actions";

function QuickEditForm({ ids, categories }: { ids: string[]; categories: Category[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        disabled={ids.length === 0}
        onClick={() => setOpen(true)}
        className={`${pillClass} col-span-2 border border-black/15 text-ink/70 hover:border-black/25 sm:col-span-1`}
      >
        Quick Edit{ids.length > 0 ? ` (${ids.length})` : ""}
      </button>
    );
  }
  return (
    <form
      action={bulkQuickEditEvents}
      className="col-span-2 flex w-full flex-wrap items-center gap-3 rounded-xl border border-black/10 bg-white px-3 py-2.5"
    >
      {ids.map((id) => (
        <input key={id} type="hidden" name="ids" value={id} />
      ))}
      <label className="flex items-center gap-1.5 text-xs font-semibold text-ink/70">
        <input type="checkbox" name="apply_category" className="h-3.5 w-3.5" />
        Category
      </label>
      <select name="category_id" className="rounded-lg border border-black/10 px-2 py-1.5 text-xs">
        <option value="">— None —</option>
        {groupEventCategories(categories).map(({ category, children }) =>
          children.length === 0 ? (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ) : (
            <optgroup key={category.id} label={category.name}>
              <option value={category.id}>{category.name}</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )
        )}
      </select>

      <label className="flex items-center gap-1.5 text-xs font-semibold text-ink/70">
        <input type="checkbox" name="apply_featured" className="h-3.5 w-3.5" />
        Featured
      </label>
      <select name="is_featured" className="rounded-lg border border-black/10 px-2 py-1.5 text-xs">
        <option value="true">On</option>
        <option value="false">Off</option>
      </select>

      <button
        type="submit"
        className="rounded-full bg-findmi px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        Apply
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-ink/50 hover:text-ink">
        Cancel
      </button>
    </form>
  );
}

export type EventRowState = { id: string; is_demo: boolean; publication_status?: string | null; archived_at?: string | null; trashed_at?: string | null };

const plural = (n: number) => `${n} Event${n === 1 ? "" : "s"}`;

export default function EventBulkActionBar({
  view,
  selectedIds,
  categories,
  selectedRows = [],
  keepSelected,
}: {
  // No "paused" view — see lifecycle-actions.ts's note: events have no
  // Pause concept (DB CHECK constraint), unlike Businesses/Products.
  view: "active" | "archived" | "trashed" | "other";
  selectedIds: string[];
  categories: Category[];
  /** The selected rows' current states (for per-action eligible counts). */
  selectedRows?: EventRowState[];
  keepSelected?: (ids: string[]) => void;
}) {
  // Archived / Trash views keep the existing shared bar:
  // Restore, Move to Trash, Permanent Delete — unchanged.
  if (view === "archived" || view === "trashed") {
    return (
      <LifecycleBulkActionBar
        view={view}
        selectedIds={selectedIds}
        entityNoun="event"
        actions={{
          archive: bulkArchiveEvents,
          restoreFromArchive: bulkRestoreEventsFromArchive,
          trash: bulkTrashEvents,
          restoreFromTrash: bulkRestoreEventsFromTrash,
          permanentDelete: bulkPermanentDeleteEvents,
        }}
      />
    );
  }
  const eligible = (op: EventTransition) => selectedRows.filter((r) => eventEligibility(op, r) === "change").length;
  // Archive is the single archived_at change (formerly labelled "Shut
  // Down") — one button. Ops keys are unchanged; labels use the shared
  // Admin vocabulary (Publish / Unpublish / Archive).
  return (
    <BulkLifecycleToolbar
      selectedIds={selectedIds}
      keepSelected={keepSelected}
      transitions={[
        { key: "live", label: "Publish", tone: "primary", eligible: eligible("live"), confirm: (n) => `Publish ${plural(n)}?\n\nThey'll be public on Findmi (Event pages, Events, Location and Business activity).`, run: (ids) => bulkTransitionEvents(ids, "live") },
        { key: "hide", label: "Unpublish", tone: "secondary", eligible: eligible("hide"), confirm: (n) => `Unpublish ${plural(n)}?\n\nThey return to Draft and leave public pages and listings. Nothing is deleted — dates, places and Businesses are kept, and Publish brings them back.`, run: (ids) => bulkTransitionEvents(ids, "hide") },
        { key: "shutdown", label: "Archive", tone: "secondary", eligible: eligible("shutdown"), confirm: (n) => `Archive ${plural(n)}?\n\nThey're hidden everywhere along with their dates and linked schedule items, and move to Archived. Records are kept; Restore reopens them.`, run: (ids) => bulkTransitionEvents(ids, "shutdown") },
      ]}
      formActions={[
        { key: "trash", label: "Move To Trash", tone: "destructive", action: bulkTrashEvents, confirm: (n) => `Move ${n} event(s) to Trash? They'll be hidden everywhere until restored.` },
      ]}
      quickEdit={<QuickEditForm ids={selectedIds} categories={categories} />}
    />
  );
}
