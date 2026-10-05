"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ChevronIcon from "@/components/ChevronIcon";
import { publishJournalEntry, saveJournalAsDraft, deleteJournalEntryAction } from "@/app/(public)/my-world/journal/actions";

/** The owner-only action row on a Moment's own page: Edit is the one
 * primary action; Publish / Unpublish and Delete sit behind "Manage".
 * Moments V2 — one simple state for people: Published (published +
 * public) or Not Published (anything else). Publish = published + public;
 * Unpublish = draft + private. No social/engagement actions here. */
export default function JournalOwnerActions({
  entryId,
  visibility,
  status,
}: {
  entryId: string;
  visibility: "private" | "public";
  status: "draft" | "published";
}) {
  const router = useRouter();
  const isPublished = status === "published" && visibility === "public";
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function togglePublished() {
    setError(null);
    startTransition(async () => {
      if (isPublished) {
        const result = await saveJournalAsDraft(entryId);
        if ("error" in result) return setError(result.error);
        router.refresh();
        return;
      }
      // Redirects back to this Moment on success.
      const result = await publishJournalEntry(entryId, "public");
      if (result && "error" in result) setError(result.error);
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
        <span
          className={`rounded-full px-2.5 py-1 font-bold uppercase tracking-wide ${isPublished ? "bg-black/[0.04] text-ink/40" : "bg-amber-100 text-amber-800"}`}
        >
          {isPublished ? "Published" : "Not Published"}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="ml-auto flex items-center gap-1 font-semibold text-ink/40 transition hover:text-ink/70"
        >
          Manage
          <ChevronIcon direction={expanded ? "up" : "down"} className="h-3.5 w-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-black/[0.02] p-2.5">
          <button
            type="button"
            onClick={togglePublished}
            disabled={pending}
            className="flex h-8 items-center justify-center rounded-lg border border-black/10 px-3 text-[11px] font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink disabled:opacity-60"
          >
            {isPublished ? "Unpublish" : "Publish"}
          </button>
          {confirmingDelete ? (
            <>
              <span className="text-[11px] text-ink/60">Delete this Moment?</span>
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
