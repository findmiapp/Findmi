import Link from "next/link";
import type { EventJournalCtaState } from "@/app/(public)/event/[slug]/journalCaptureActions";

/** Public Event V2 — Moments action. Public concept: MOMENTS (individual
 * pieces of an experience); the user's personal collection stays their
 * JOURNAL (one entry per Event). Additive, compact, never dominant:
 *
 *   no entry yet          → "+ Add Moment"
 *   draft or published    → "+ Add More"
 *
 * Both go to /event/[slug]/journal, which resolves (or creates) the one
 * entry for this user + event and always opens its editor — so Add More
 * can genuinely add more, even to a published entry. A published entry
 * also gets a quiet "View your Journal" link to its public page; a draft
 * links to the personal Journal list. Always rendered for every viewer
 * (signed-out visitors go through signup from the entry point). */
export default function DocumentExperienceCta({ eventSlug, state }: { eventSlug: string; state: EventJournalCtaState }) {
  const hasEntry = state.kind !== "none";
  const viewHref = state.kind === "published" ? `/journal/${state.id}` : state.kind === "draft" ? "/my-world/journal" : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link
          href={`/event/${eventSlug}/journal`}
          className="inline-flex h-10 items-center gap-1.5 rounded-full border border-findmi/40 bg-white px-4 text-button font-bold text-findmi-700 transition hover:border-findmi/60 hover:bg-findmi-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          {hasEntry ? "Add More" : "Add Moment"}
        </Link>
        {viewHref && (
          <Link href={viewHref} className="text-metadata font-semibold text-muted transition hover:text-primary">
            View your Journal
          </Link>
        )}
      </div>
      <p className="max-w-md text-microcopy leading-relaxed text-subtle">
        Add moments from your experience to your Journal. They may also be featured on this event or the brand&rsquo;s
        Findmi page.
      </p>
    </div>
  );
}
