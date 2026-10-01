"use client";

import { useState, useTransition } from "react";
import { saveJournalBasics } from "@/app/(public)/my-world/journal/actions";

/** Journal Live Capture pass — one low-friction text field for jotting
 * thoughts while walking around an activation. Reuses the existing
 * saveJournalBasics Server Action (the same one JournalEditForm's own
 * Save already calls) rather than adding a new notes-only action or
 * table: title/entry_date are resubmitted unchanged (that action requires
 * both present) alongside the edited notes text. A simple type -> Save
 * interaction, no autosave, no block editor — the saved value comes back
 * on the next page load (entry.notes), so it survives leaving/reopening
 * the page. */
export default function JournalQuickNote({
  entryId,
  title,
  entryDate,
  entryTime,
  initialNotes,
}: {
  entryId: string;
  title: string;
  entryDate: string;
  entryTime: string | null;
  initialNotes: string;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("title", title);
      formData.set("entry_date", entryDate);
      if (entryTime) formData.set("entry_time", entryTime);
      if (notes.trim()) formData.set("notes", notes);
      const result = await saveJournalBasics(entryId, formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-findmi-700">Quick Note</p>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        rows={4}
        placeholder="What's happening here?"
        className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-findmi/50 focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="flex h-10 items-center justify-center rounded-xl bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && !pending && <span className="text-xs font-semibold text-findmi-700">Saved</span>}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
