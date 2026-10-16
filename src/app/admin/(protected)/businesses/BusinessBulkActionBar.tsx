"use client";

import { useState } from "react";
import type { Category } from "@/lib/types";
import LifecycleBulkActionBar from "@/components/admin/LifecycleBulkActionBar";
import BulkLifecycleToolbar, { pillClass } from "@/components/admin/BulkLifecycleToolbar";
import { businessEligibility, type BusinessTransition } from "@/lib/admin/lifecycle-eligibility";
import {
  bulkArchiveBusinesses,
  bulkPauseBusinesses,
  bulkPermanentDeleteBusinesses,
  bulkQuickEditBusinesses,
  bulkResumeBusinesses,
  bulkRestoreBusinessesFromArchive,
  bulkRestoreBusinessesFromTrash,
  bulkTransitionBusinesses,
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
        className={`${pillClass} col-span-2 border border-black/15 text-ink/70 hover:border-black/25 sm:col-span-1`}
      >
        Quick Edit{ids.length > 0 ? ` (${ids.length})` : ""}
      </button>
    );
  }
  return (
    <form
      action={bulkQuickEditBusinesses}
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

export type BusinessRowState = { id: string; publication_status?: string | null; archived_at?: string | null; trashed_at?: string | null };

const plural = (n: number) => `${n} ${n === 1 ? "Business" : "Businesses"}`;

export default function BusinessBulkActionBar({
  view,
  selectedIds,
  categories,
  selectedRows = [],
  keepSelected,
}: {
  view: "active" | "paused" | "archived" | "trashed" | "other";
  selectedIds: string[];
  categories: Category[];
  /** The selected rows' current states (for per-action eligible counts). */
  selectedRows?: BusinessRowState[];
  keepSelected?: (ids: string[]) => void;
}) {
  // Archived / Trash views keep the existing shared bar (Restore, Trash,
  // Permanent Delete) unchanged.
  if (view === "archived" || view === "trashed") {
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
      />
    );
  }
  const eligible = (op: BusinessTransition) => selectedRows.filter((r) => businessEligibility(op, r) === "change").length;
  // Approve / Reject (moderation) apply to Needs Review rows, Pause to Published ones,
  // Resume to Paused ones — each appears only when the selection has a row
  // it applies to, and mixed selections are safe (others are skipped).
  return (
    <BulkLifecycleToolbar
      selectedIds={selectedIds}
      keepSelected={keepSelected}
      transitions={[
        { key: "approve", label: "Approve", tone: "primary", eligible: eligible("approve"), confirm: (n) => `Approve ${plural(n)}?\n\nNeeds Review Businesses become Published on Findmi and their team members are notified. Nothing else changes.`, run: (ids) => bulkTransitionBusinesses(ids, "approve") },
        { key: "resume", label: "Resume", tone: "primary", eligible: eligible("resume"), confirm: (n) => `Resume ${plural(n)}?\n\nPaused Businesses become Published on Findmi again and their team members are notified.`, run: (ids) => bulkTransitionBusinesses(ids, "resume") },
        { key: "pause", label: "Pause", tone: "secondary", eligible: eligible("pause"), confirm: (n) => `Pause ${plural(n)}?\n\nPublished Businesses stop showing on Findmi until resumed and their team members are notified. Nothing is deleted.`, run: (ids) => bulkTransitionBusinesses(ids, "pause") },
        { key: "reject", label: "Reject", tone: "destructive", eligible: eligible("reject"), confirm: (n) => `Reject ${plural(n)}?\n\nNeeds Review Businesses are marked Rejected (not public) and their team members are notified. Records are kept.`, run: (ids) => bulkTransitionBusinesses(ids, "reject") },
      ]}
      formActions={[
        { key: "archive", label: "Archive", tone: "secondary", action: bulkArchiveBusinesses },
        { key: "trash", label: "Move To Trash", tone: "destructive", action: bulkTrashBusinesses, confirm: (n) => `Move ${n} business(es) to Trash? They'll be hidden everywhere until restored.` },
      ]}
      quickEdit={<QuickEditForm ids={selectedIds} categories={categories} />}
    />
  );
}
