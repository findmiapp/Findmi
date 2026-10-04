import Link from "next/link";
import type { EventJournalCtaState } from "@/app/(public)/event/[slug]/journalCaptureActions";

/** Public Event V2.1 — the Moments contribution row, rendered INSIDE the
 * Findmi Moments section (no longer a block at the top of the page).
 * Public concept: MOMENTS; the user's personal collection stays their
 * JOURNAL (one entry per Event).
 *
 *   no entry yet          → "+ Add yours"
 *   draft or published    → "+ Add more"
 *
 * Both go to /event/[slug]/journal, which resolves (or creates) the one
 * entry for this user + event and always opens its editor — so Add more
 * can genuinely add more, even to a published entry. A published entry
 * also gets a quiet "View your Journal" link to its public page; a draft
 * links to the personal Journal list. Always rendered for every viewer
 * (signed-out visitors go through signup from the entry point). */
export default function DocumentExperienceCta({ eventSlug, state }: { eventSlug: string; state: EventJournalCtaState }) {
  const hasEntry = state.kind !== "none";
  const viewHref = state.kind === "published" ? `/journal/${state.id}` : state.kind === "draft" ? "/my-world/journal" : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <Link
        href={`/event/${eventSlug}/journal`}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-findmi/40 bg-white px-3.5 text-button font-bold text-findmi-700 transition hover:border-findmi/60 hover:bg-findmi-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        {hasEntry ? "Add more" : "Add yours"}
      </Link>
      <p className="min-w-0 flex-1 basis-48 text-microcopy leading-relaxed text-subtle">
        Share a moment from your experience. Saved to your Journal and may be featured here.
        {viewHref && (
          <>
            {" "}
            <Link href={viewHref} className="font-semibold text-muted underline-offset-2 transition hover:text-primary hover:underline">
              View your Journal
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
