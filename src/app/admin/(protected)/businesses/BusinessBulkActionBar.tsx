"use client";

import { useState } from "react";
import type { Category } from "@/lib/types";
import LifecycleBulkActionBar from "@/components/admin/LifecycleBulkActionBar";
import {
  bulkArchiveBusinesses,
  bulkPauseBusinesses,
  bulkPermanentDeleteBusinesses,
  bulkQuickEditBusinesses,
  bulkResumeBusinesses,
  bulkRestoreBusinessesFromArchive,
  bulkRestoreBusinessesFromTrash,
  bulkTrashBusinesses,
} from "./lifecycle-actions";

function QuickEditForm({ ids, categories }: { ids: string[]; categories: Category[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        disabled={ids.length === 0}
        onClick={() => setOpen(true)}
        className="rounded-full border border-black/15 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-black/25 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Quick Edit{ids.length > 0 ? ` (${ids.length})` : ""}
      </button>
    );
  }
  return (
    <form
      action={bulkQuickEditBusinesses}
      className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-black/10 bg-white px-3 py-2.5"
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
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
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

export default function BusinessBulkActionBar({
  view,
  selectedIds,
  categories,
}: {
  view: "active" | "paused" | "archived" | "trashed" | "other";
  selectedIds: string[];
  categories: Category[];
}) {
  return (
    <LifecycleBulkActionBar
      view={view}
      selectedIds={selectedIds}
      entityNoun="business"
      actions={{
        pause: bulkPauseBusinesses,
        resume: bulkResumeBusinesses,
        archive: bulkArchiveBusinesses,
        restoreFromArchive: bulkRestoreBusinessesFromArchive,
        trash: bulkTrashBusinesses,
        restoreFromTrash: bulkRestoreBusinessesFromTrash,
        permanentDelete: bulkPermanentDeleteBusinesses,
      }}
      quickEdit={(ids) => <QuickEditForm ids={ids} categories={categories} />}
    />
  );
}
