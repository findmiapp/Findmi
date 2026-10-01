import Link from "next/link";
import type { EventJournalCtaState } from "@/app/(public)/event/[slug]/journalCaptureActions";

const COPY: Record<EventJournalCtaState["kind"], { title: string; subtitle: string | null }> = {
  none: { title: "Document Your Experience", subtitle: "Create a Journal Entry" },
  draft: { title: "Continue Your Journal Entry", subtitle: "Keep documenting your experience" },
  published: { title: "View Your Journal Entry", subtitle: null },
};

/** Event Action UX + Universal Journal CTA pass — a large, permanent
 * FindMi-owned secondary CTA directly beneath the Event's primary
 * organizer action (RSVP/Tickets), never a small admin utility tucked
 * under the utility row. Always rendered, for every viewer — logged out,
 * logged in, or admin — per this pass's own instruction: auth state
 * decides what happens AFTER the tap (see the /event/[slug]/journal
 * entry point this links to), never whether the CTA exists. `state` only
 * changes the copy shown; the destination is always the same entry
 * point, which independently resolves (or re-resolves) the correct
 * existing entry — never a second, divergent lookup here. White/pale-
 * aqua background + aqua border/icon, never solid aqua, so it stays
 * visually substantial without competing with a solid-filled RSVP
 * button above it. */
export default function DocumentExperienceCta({ eventSlug, state }: { eventSlug: string; state: EventJournalCtaState }) {
  const copy = COPY[state.kind];
  return (
    <Link
      href={`/event/${eventSlug}/journal`}
      className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-findmi/40 bg-findmi-50/50 px-4 py-4 transition hover:border-findmi/60 hover:bg-findmi-50"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-findmi-700">
        <PencilGlyph className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold tracking-tight text-ink sm:text-base">{copy.title}</span>
        {copy.subtitle && <span className="mt-0.5 block text-xs text-ink/55">{copy.subtitle}</span>}
      </span>
    </Link>
  );
}

function PencilGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M17 3a2.1 2.1 0 013 3L8.5 17.5 4 19l1.5-4.5L17 3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
