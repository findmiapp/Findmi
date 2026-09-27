"use client";

import { useState } from "react";
import type { Category } from "@/lib/types";
import {
  bulkArchiveProducts,
  bulkPauseProducts,
  bulkPermanentDeleteProducts,
  bulkQuickEditProducts,
  bulkResumeProducts,
  bulkRestoreFromArchive,
  bulkRestoreFromTrash,
  bulkTrashProducts,
} from "./lifecycle-actions";

/** Admin Content Lifecycle + Bulk Management V1 — the products-specific
 * bulk action bar (paired with the generic AdminBulkList selection
 * primitive). Which actions render depends entirely on which lifecycle
 * view is currently open — Permanent Delete only ever renders inside the
 * Trash view, never alongside Active/Paused/Archived actions, per the
 * "never a casual action in Active lists" requirement. */
function HiddenIds({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((id) => (
        <input key={id} type="hidden" name="ids" value={id} />
      ))}
    </>
  );
}

function ActionButton({
  action,
  ids,
  label,
  tone = "default",
  confirmMessage,
}: {
  action: (formData: FormData) => void | Promise<void>;
  ids: string[];
  label: string;
  tone?: "default" | "destructive";
  confirmMessage?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (confirmMessage && !confirm(confirmMessage)) e.preventDefault();
      }}
    >
      <HiddenIds ids={ids} />
      <button
        type="submit"
        disabled={ids.length === 0}
        className={`rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40 ${
          tone === "destructive"
            ? "border border-red-200 text-red-600 hover:bg-red-50"
            : "bg-findmi text-white hover:bg-findmi-600"
        }`}
      >
        {label}
        {ids.length > 0 ? ` (${ids.length})` : ""}
      </button>
    </form>
  );
}

function PermanentDeleteForm({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const expected = `DELETE ${ids.length}`;

  if (!open) {
    return (
      <button
        type="button"
        disabled={ids.length === 0}
        onClick={() => setOpen(true)}
        className="rounded-full border border-red-300 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Permanently Delete{ids.length > 0 ? ` (${ids.length})` : ""}
      </button>
    );
  }

  return (
    <form action={bulkPermanentDeleteProducts} className="flex flex-wrap items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2">
      <HiddenIds ids={ids} />
      <span className="text-xs font-semibold text-red-800">
        Type <span className="font-mono">{expected}</span> to permanently delete — this cannot be undone.
      </span>
      <input
        type="text"
        name="confirmText"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={expected}
        className="w-40 rounded-lg border border-red-300 bg-white px-2 py-1 text-xs font-mono text-red-900 focus:outline-none"
      />
      <button
        type="submit"
        disabled={confirmText !== expected}
        className="rounded-full bg-red-600 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Confirm Delete
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setConfirmText("");
        }}
        className="text-xs font-semibold text-ink/50 hover:text-ink"
      >
        Cancel
      </button>
    </form>
  );
}

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
      action={bulkQuickEditProducts}
      className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-black/10 bg-white px-3 py-2.5"
    >
      <HiddenIds ids={ids} />
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

export default function ProductBulkActionBar({
  view,
  selectedIds,
  categories,
}: {
  /** Which lifecycle tab is currently open — decides which actions are
   * even offered. Mirrors AdminProductsPage's own `status` param. */
  view: "active" | "paused" | "archived" | "trashed" | "other";
  selectedIds: string[];
  categories: Category[];
}) {
  if (view === "archived") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton action={bulkRestoreFromArchive} ids={selectedIds} label="Restore" />
        <ActionButton
          action={bulkTrashProducts}
          ids={selectedIds}
          label="Move to Trash"
          tone="destructive"
          confirmMessage={`Move ${selectedIds.length} product(s) to Trash? They'll be hidden everywhere until restored.`}
        />
      </div>
    );
  }

  if (view === "trashed") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton action={bulkRestoreFromTrash} ids={selectedIds} label="Restore" />
        <PermanentDeleteForm ids={selectedIds} />
      </div>
    );
  }

  // active / paused / other (needs_review, marketplace_review)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton action={bulkPauseProducts} ids={selectedIds} label="Pause" />
      <ActionButton action={bulkResumeProducts} ids={selectedIds} label="Resume" />
      <ActionButton action={bulkArchiveProducts} ids={selectedIds} label="Archive" />
      <ActionButton
        action={bulkTrashProducts}
        ids={selectedIds}
        label="Move to Trash"
        tone="destructive"
        confirmMessage={`Move ${selectedIds.length} product(s) to Trash? They'll be hidden everywhere until restored.`}
      />
      <QuickEditForm ids={selectedIds} categories={categories} />
    </div>
  );
}
