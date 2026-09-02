import Link from "next/link";
import type { EventOccurrenceWithLocation } from "@/lib/data";
import { cityState, formatTimeRange, getTemporalLabel } from "@/lib/format";
import { validateCustomDestination } from "@/lib/navigation";
import LiveDot from "./LiveDot";

// One card in the public event page's "Upcoming Dates" carousel — visual
// language mirrors AppearanceCard's date-tile + text-block + circular CTA
// pattern, adapted for an occurrence: cancelled state instead of
// "Tentative", and a ticket-link (occurrence override, else the parent
// event's own) instead of AppearanceCard's tiered click logic — an
// occurrence has no external_url/flyer of its own to fall back through.
export default function EventOccurrenceCard({
  occurrence,
  eventTicketsUrl,
}: {
  occurrence: EventOccurrenceWithLocation;
  /** The parent event's own Ticket Link — used when this occurrence has
   * no ticket_url_override of its own. */
  eventTicketsUrl: string | null;
}) {
  const cancelled = occurrence.status === "cancelled";
  const location = cityState(occurrence.location?.city, occurrence.location?.state);
  const { live } = !cancelled ? getTemporalLabel(occurrence.start_at, occurrence.end_at) : { live: false };

  const ticketUrl = occurrence.ticket_url_override ?? eventTicketsUrl;
  const destination =
    !cancelled && ticketUrl && validateCustomDestination(ticketUrl).ok ? ticketUrl : null;
  // Same internal-vs-external convention used everywhere else a founder-
  // entered destination is rendered (see Bulletin.tsx/AppearanceCard.tsx):
  // a bare "https://" URL opens in a new tab.
  const destinationIsAbsolute = destination ? /^https:\/\//i.test(destination) : false;

  const content = (
    <div
      className={`flex w-56 shrink-0 items-center gap-3 rounded-2xl border p-3 transition ${
        cancelled
          ? "border-black/5 bg-black/[0.02] opacity-70"
          : live
            ? "border-findmi/50 bg-findmi-50"
            : "border-black/5 bg-white hover:border-black/10 hover:shadow-sm"
      }`}
    >
      <div
        className={`flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 ${
          live ? "bg-findmi text-white" : "bg-black/[0.04] text-ink"
        }`}
      >
        {live ? (
          <>
            <LiveDot className="text-white" />
            <span className="text-[10px] font-bold uppercase tracking-wide">Now</span>
          </>
        ) : (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50">
              {new Date(occurrence.start_at).toLocaleDateString("en-US", { month: "short" })}
            </span>
            <span className="text-lg font-bold leading-none">{new Date(occurrence.start_at).getDate()}</span>
          </>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {cancelled ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Cancelled</p>
        ) : (
          <p className="truncate text-xs text-ink/55">{formatTimeRange(occurrence.start_at, occurrence.end_at)}</p>
        )}
        {(occurrence.location?.name || location) && (
          <p className="mt-0.5 truncate text-xs text-ink/45">
            {[occurrence.location?.name, location].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {destination && (
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-findmi text-white transition group-hover:bg-findmi-600"
        >
          <ArrowGlyph className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );

  if (!destination) return content;

  const ariaLabel = `${formatTimeRange(occurrence.start_at, occurrence.end_at)} — Get tickets`;
  if (destinationIsAbsolute) {
    return (
      <a href={destination} target="_blank" rel="noreferrer" className="group block" aria-label={ariaLabel}>
        {content}
      </a>
    );
  }
  return (
    <Link href={destination} className="group block" aria-label={ariaLabel}>
      {content}
    </Link>
  );
}

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
