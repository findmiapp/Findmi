"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { updateJournalVisibility, deleteJournalEntryAction } from "@/app/(public)/my-world/journal/actions";

/** Journal V1 — the owner-only action row on a Journal Entry's own page:
 * Edit, a visibility toggle, and Delete (explicit confirmation required).
 * No social/engagement actions here — Journal V1 deliberately has none
 * (no comments, no reaction counts, no view counts) for any viewer,
 * owner included. */
export default function JournalOwnerActions({ entryId, visibility }: { entryId: string; visibility: "private" | "public" }) {
  const [currentVisibility, setCurrentVisibility] = useState(visibility);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
      <div className="flex flex-wrap items-center gap-1.5">
        <Link
          href={`/my-world/journal/${entryId}/edit`}
          className="flex h-9 items-center justify-center rounded-lg border border-black/10 px-3 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
        >
          Edit
        </Link>
        <button
          type="button"
          onClick={toggleVisibility}
          disabled={pending}
          className="flex h-9 items-center justify-center rounded-lg border border-black/10 px-3 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink disabled:opacity-60"
        >
          {currentVisibility === "private" ? "Make Public" : "Make Private"}
        </button>
        {confirmingDelete ? (
          <>
            <span className="text-xs text-ink/60">Delete this entry?</span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="flex h-9 items-center justify-center rounded-lg bg-red-600 px-3 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-red-700 disabled:opacity-60"
            >
              {pending ? "Deleting…" : "Confirm Delete"}
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} className="text-xs font-semibold text-ink/50 hover:text-ink">
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="flex h-9 items-center justify-center rounded-lg border border-black/10 px-3 text-xs font-bold uppercase tracking-wide text-red-600 transition hover:border-red-300 hover:bg-red-50"
          >
            Delete
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
