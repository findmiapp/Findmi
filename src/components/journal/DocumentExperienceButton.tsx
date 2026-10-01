"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startOrResumeEventJournalCapture } from "@/app/(public)/event/[slug]/journalCaptureActions";

/** Journal Live Capture pass — the Event page's entry point into the
 * create-or-resume Journal capture flow. Visibility is already gated by
 * the caller (EventPublicView only renders this when isAdminSession() is
 * true server-side); the Server Action this calls independently
 * re-verifies that same session before doing anything, so this component
 * itself carries no authorization logic of its own — same split
 * AdminEditButton/the Journal pencil already establish (a Server Component
 * decides visibility, the mutation re-checks itself).
 *
 * One tap resolves (or creates) the one draft Journal Entry for this
 * event and navigates straight to its lightweight mobile capture surface
 * — never the full editor, never a blank intermediate step. */
export default function DocumentExperienceButton({ eventSlug }: { eventSlug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await startOrResumeEventJournalCapture(eventSlug);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(`/admin/journal/${result.id}/capture`);
    });
  }

  return (
    <span className="shrink-0">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-findmi/40 px-3 text-xs font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50 disabled:opacity-60"
      >
        {pending ? "Opening…" : "Document this experience"}
      </button>
      {error && <p className="mt-1 max-w-[220px] text-[11px] text-red-600">{error}</p>}
    </span>
  );
}
