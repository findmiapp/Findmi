"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { updateJournalVisibility, deleteJournalEntryAction } from "@/app/(public)/my-world/journal/actions";

/** Journal V1 (visual convergence pass) — the owner-only action row on a
 * Journal Entry's own page. Previously three equal-weight buttons
 * (EDIT / MAKE PRIVATE / DELETE) read as administratively dominant right
 * under the hero; Edit is now the one primary action, with the
 * visibility toggle and Delete tucked behind a "Manage" disclosure —
 * still one tap away, never removed, just not competing with the memory
 * itself for attention. No social/engagement actions here — Journal V1
 * deliberately has none (no comments, no reaction counts, no view
 * counts) for any viewer, owner included. */
export default function JournalOwnerActions({
  entryId,
  visibility,
  status,
}: {
  entryId: string;
  visibility: "private" | "public";
  status: "draft" | "published";
}) {
  const [currentVisibility, setCurrentVisibility] = useState(visibility);
  // Journal V2 Pass 1 — a draft entry with visibility="public" is not yet
  // anonymously resolvable (see JournalEditForm's own identical note), so
  // this pill must say so rather than the bare "Public" a published entry
  // correctly shows. `status` never changes from this component (Publish
  // lives in the Edit form) — it's read-only context here.
  const visibilityLabel = status === "draft" && currentVisibility === "public" ? "Public when published" : currentVisibility === "private" ? "Private" : "Public";
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function toggleVisibility() {
    const next = currentVisibility === "private" ? "public" : "private";
    setCurrentVisibility(next);
    setError(null);
    startTransition(async () => {
      const result = await updateJournalVisibility(entryId, next);
      if (result && "error" in result) {
        setCurrentVisibility(currentVisibility);
        setError(result.error);
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteJournalEntryAction(entryId);
      if (result && "error" in result) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs">
        <Link
          href={`/my-world/journal/${entryId}/edit`}
          className="flex h-8 items-center justify-center rounded-full bg-ink/5 px-3.5 font-bold uppercase tracking-wide text-ink/80 transition hover:bg-ink/10"
        >
          Edit
        </Link>
        {status === "draft" && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 font-bold uppercase tracking-wide text-amber-800">Draft</span>
        )}
        <span className="rounded-full bg-black/[0.04] px-2.5 py-1 font-semibold uppercase tracking-wide text-ink/40">{visibilityLabel}</span>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="ml-auto font-semibold text-ink/40 transition hover:text-ink/70"
        >
          Manage {expanded ? "▴" : "▾"}
        </button>
      </div>

      {expanded && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-black/[0.02] p-2.5">
          <button
            type="button"
            onClick={toggleVisibility}
            disabled={pending}
            className="flex h-8 items-center justify-center rounded-lg border border-black/10 px-3 text-[11px] font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink disabled:opacity-60"
          >
            {currentVisibility === "private" ? "Make Public" : "Make Private"}
          </button>
          {confirmingDelete ? (
            <>
              <span className="text-[11px] text-ink/60">Delete this entry?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                className="flex h-8 items-center justify-center rounded-lg bg-red-600 px-3 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {pending ? "Deleting…" : "Confirm Delete"}
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="text-[11px] font-semibold text-ink/50 hover:text-ink">
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="flex h-8 items-center justify-center rounded-lg px-3 text-[11px] font-bold uppercase tracking-wide text-red-600/80 transition hover:bg-red-50 hover:text-red-700"
            >
              Delete
            </button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
