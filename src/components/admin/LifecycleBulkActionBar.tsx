"use client";

import { useState } from "react";

/** Admin Content Lifecycle + Bulk Management — the shared, entity-agnostic
 * bulk action bar (V2: extracted from V1's Products-only ProductBulkActionBar
 * so Businesses/Events/Locations render the exact same interaction pattern
 * instead of a fourth near-duplicate). Which buttons appear is driven
 * ENTIRELY by `view` (the current lifecycle tab) and which action
 * functions the caller actually supplies — an entity with no Pause concept
 * (Locations) simply omits `pause`/`resume` and those buttons never
 * render, rather than showing a meaningless disabled button.
 *
 * Per-view action sets (never all shown together regardless of state):
 *  - active:   Pause (if supported) · Archive · Move to Trash · quickEdit
 *  - paused:   Resume · Archive · Move to Trash · quickEdit
 *  - other (moderation-style queues layered on top of active/paused):
 *              same as active/paused, decided by `pausedByDefault`
 *  - archived: Restore · Move to Trash
 *  - trashed:  Restore · Permanent Delete (high-friction, typed confirm)
 */
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

function PermanentDeleteForm({
  ids,
  action,
}: {
  ids: string[];
  action: (formData: FormData) => void | Promise<void>;
}) {
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
    <form action={action} className="flex flex-wrap items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2">
      <HiddenIds ids={ids} />
      <span className="text-xs font-semibold text-red-800">
        Type <span className="font-mono">{expected}</span> to permanently delete. This cannot be undone.
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

export interface LifecycleActionSet {
  /** Omit entirely for an entity with no existing Pause concept
   * (Locations) — the button then never renders, rather than rendering
   * disabled/meaningless. */
  pause?: (formData: FormData) => void | Promise<void>;
  resume?: (formData: FormData) => void | Promise<void>;
  archive: (formData: FormData) => void | Promise<void>;
  restoreFromArchive: (formData: FormData) => void | Promise<void>;
  trash: (formData: FormData) => void | Promise<void>;
  restoreFromTrash: (formData: FormData) => void | Promise<void>;
  permanentDelete: (formData: FormData) => void | Promise<void>;
}

export default function LifecycleBulkActionBar({
  view,
  selectedIds,
  actions,
  entityNoun,
  quickEdit,
}: {
  view: "active" | "paused" | "archived" | "trashed" | "other";
  selectedIds: string[];
  actions: LifecycleActionSet;
  /** Lowercase singular, used only in confirm()/type-to-confirm copy — e.g. "product". */
  entityNoun: string;
  /** Entity-specific Quick Edit trigger+form (category pickers, featured
   * toggle, etc. differ per entity) — rendered only on active/paused/other,
   * never on archived/trashed. Omit for an entity with no safe bulk-edit
   * fields yet. */
  quickEdit?: (selectedIds: string[]) => React.ReactNode;
}) {
  if (view === "archived") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton action={actions.restoreFromArchive} ids={selectedIds} label="Restore" />
        <ActionButton
          action={actions.trash}
          ids={selectedIds}
          label="Move to Trash"
          tone="destructive"
          confirmMessage={`Move ${selectedIds.length} ${entityNoun}(s) to Trash? They'll be hidden everywhere until restored.`}
        />
      </div>
    );
  }

  if (view === "trashed") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton action={actions.restoreFromTrash} ids={selectedIds} label="Restore" />
        <PermanentDeleteForm ids={selectedIds} action={actions.permanentDelete} />
      </div>
    );
  }

  // active / paused / other — exactly the ONE state-appropriate pause
  // action, never both together.
  return (
    <div className="flex flex-wrap items-center gap-2">
      {view === "paused" && actions.resume && <ActionButton action={actions.resume} ids={selectedIds} label="Resume" />}
      {view !== "paused" && actions.pause && <ActionButton action={actions.pause} ids={selectedIds} label="Pause" />}
      <ActionButton action={actions.archive} ids={selectedIds} label="Archive" />
      <ActionButton
        action={actions.trash}
        ids={selectedIds}
        label="Move to Trash"
        tone="destructive"
        confirmMessage={`Move ${selectedIds.length} ${entityNoun}(s) to Trash? They'll be hidden everywhere until restored.`}
      />
      {quickEdit?.(selectedIds)}
    </div>
  );
}
