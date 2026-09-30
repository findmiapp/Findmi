"use client";

import Link from "next/link";
import { cityState, cityStateZip, formatDateShortInZone, formatTimeInZone } from "@/lib/format";
import { useEventOccurrence } from "./EventOccurrenceContext";
import type { EventLocationCardLocation } from "./EventLocationCard";
import LiveDot from "./LiveDot";

/** The recurring-event hero's date/time/location block — Recurring
 * Events V2. Reads ONLY the shared selectedOccurrence (never the parent
 * event's own start_at/end_at/venue fields, which stop being public
 * scheduling truth the moment occurrence rows exist), so this can never
 * show a stale parent date while occurrences exist. Renders in the
 * selected occurrence's own timezone.
 *
 * `canonicalLocation` is EventPublicView.tsx's own already-resolved
 * Location for the event as a whole (the nearest occurrence WITH a
 * linked Location, or the legacy exact-venue-match) — a fallback for when
 * the selected occurrence itself has no location_id of its own but the
 * event unambiguously has a real Location anyway. The occurrence's own
 * location still wins whenever it has one.
 *
 * Final Event Experience Polish pass — rebuilt for mobile density:
 * DATE (boldest line) / TIME (muted, directly beneath) / VENUE NAME
 * (a clickable link to the real Location page when one resolves) /
 * ADDRESS (muted), as one compact stack — no "LOCATION" eyebrow, no
 * large Location thumbnail (that richer treatment stays exactly where it
 * already lives — EventLocationCard on "About the Venue" further down
 * the page, and on Location pages themselves; this is a compact
 * text-only variant for the top logistics module only). The old
 * full-width "Happening Now"/"Next Event"/"Selected Date" pill above the
 * date is gone too — the hero already carries that signal prominently; a
 * genuinely live occurrence instead gets one small inline dot + label,
 * and a cancelled occurrence keeps a small inline tag, both far lighter
 * than the old pill row. */
export default function EventScheduleSummary({
  canonicalLocation,
}: {
  canonicalLocation: EventLocationCardLocation | null;
}) {
  const { selected, selectedState } = useEventOccurrence();

  if (!selected || selectedState === "none") {
    return <p className="mt-3 text-sm font-medium text-ink/50">No upcoming dates announced</p>;
  }

  const location = selected.location ?? canonicalLocation;
  const addressLine = location ? [location.address, cityState(location.city, location.state)].filter(Boolean).join(", ") : "";
  const manualVenueLine = [selected.venue_name, selected.address, cityStateZip(selected.city, selected.state, selected.postal_code)]
    .filter(Boolean)
    .join(" · ");

  const sameDay = formatDateShortInZone(selected.start_at, selected.timezone) === formatDateShortInZone(selected.end_at, selected.timezone);
  const dateLabel = sameDay
    ? formatDateShortInZone(selected.start_at, selected.timezone)
    : `${formatDateShortInZone(selected.start_at, selected.timezone)} – ${formatDateShortInZone(selected.end_at, selected.timezone)}`;
  const timeLabel = `${formatTimeInZone(selected.start_at, selected.timezone)} – ${formatTimeInZone(selected.end_at, selected.timezone)}`;

  return (
    <div className="mt-3 flex flex-col gap-0.5 text-sm">
      <p className="font-bold text-ink">{dateLabel}</p>
      {selectedState === "cancelled" ? (
        <span className="mt-0.5 inline-flex w-fit items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
          Cancelled
        </span>
      ) : (
        <p className="text-ink/55">{timeLabel}</p>
      )}
      {selectedState === "current" && (
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-red-600">
          <LiveDot className="animate-happening-now-glow rounded-full text-red-600" />
          Happening Now
        </span>
      )}
      {location ? (
        <Link href={`/location/${location.slug}`} className="group mt-1 w-fit">
          <span className="flex items-center gap-1 font-semibold text-ink transition group-hover:text-findmi-700">
            {location.name}
            <ChevronGlyph className="h-3 w-3 shrink-0 text-ink/30 transition group-hover:text-findmi-700" />
          </span>
          {addressLine && <span className="block text-xs text-ink/50">{addressLine}</span>}
        </Link>
      ) : (
        manualVenueLine && <p className="mt-1 text-xs text-ink/55">{manualVenueLine}</p>
      )}
    </div>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
