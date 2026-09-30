"use client";

import Link from "next/link";
import { cityState, cityStateZip, formatDateShortInZone, formatTimeInZone } from "@/lib/format";
import { useEventOccurrence } from "./EventOccurrenceContext";
import type { EventLocationCardLocation } from "./EventLocationCard";
import LiveDot from "./LiveDot";

/** The recurring-event hero's date/time/location block — Recurring
 * Events V2. Reads the shared selectedOccurrence context (never the
 * parent event's own start_at/end_at/venue fields, which stop being
 * public scheduling truth the moment occurrence rows exist).
 *
 * `canonicalLocation` is EventPublicView.tsx's own already-resolved
 * Location for the event as a whole (the nearest occurrence WITH a
 * linked Location, or the legacy exact-venue-match) — a fallback for when
 * the selected occurrence itself has no location_id of its own but the
 * event unambiguously has a real Location anyway. The occurrence's own
 * location still wins whenever it has one.
 *
 * Event Page Final Compression pass — the top row now shows the EVENT'S
 * OWN overall date range (earliest real occurrence's start -> latest
 * real occurrence's end, from the shared context's own `occurrences`
 * list — already the real, effective schedule this page fetched once;
 * no new data) rather than repeating the currently selected occurrence's
 * single date. The specific-date experience (which date is selected,
 * that date's own status/venue/RSVP/lineup) lives in the Dates & Lineup
 * rail, which this pass moves to sit directly beneath the actions below
 * this card. Time is shown only when every real occurrence genuinely
 * shares the same local start/end time-of-day — inventing one universal
 * time for a schedule that doesn't actually share one would misrepresent
 * it, so a non-uniform schedule instead shows the SELECTED occurrence's
 * own real time (still accurate, just specific to that date). Status
 * (Happening Now / Cancelled) and venue stay tied to the SELECTED
 * occurrence, same as before. */
export default function EventScheduleSummary({
  canonicalLocation,
}: {
  canonicalLocation: EventLocationCardLocation | null;
}) {
  const { occurrences, selected, selectedState } = useEventOccurrence();

  if (!selected || selectedState === "none") {
    return <p className="mt-3 text-sm font-medium text-ink/50">No upcoming dates announced</p>;
  }

  const location = selected.location ?? canonicalLocation;
  const addressLine = location ? [location.address, cityState(location.city, location.state)].filter(Boolean).join(", ") : "";
  const manualVenueLine = [selected.venue_name, selected.address, cityStateZip(selected.city, selected.state, selected.postal_code)]
    .filter(Boolean)
    .join(" · ");

  const first = occurrences[0] ?? selected;
  const last = occurrences[occurrences.length - 1] ?? selected;
  const sameDay = formatDateShortInZone(first.start_at, first.timezone) === formatDateShortInZone(last.end_at, first.timezone);
  const dateRangeLabel = sameDay
    ? formatDateShortInZone(first.start_at, first.timezone)
    : `${formatDateShortInZone(first.start_at, first.timezone)} – ${formatDateShortInZone(last.end_at, first.timezone)}`;

  const firstStartTime = formatTimeInZone(first.start_at, first.timezone);
  const firstEndTime = formatTimeInZone(first.end_at, first.timezone);
  const hasUniformTime = occurrences.every(
    (o) => formatTimeInZone(o.start_at, o.timezone) === firstStartTime && formatTimeInZone(o.end_at, o.timezone) === firstEndTime
  );
  const timeLabel = hasUniformTime
    ? `${firstStartTime} – ${firstEndTime}`
    : `${formatTimeInZone(selected.start_at, selected.timezone)} – ${formatTimeInZone(selected.end_at, selected.timezone)}`;

  return (
    <div className="mt-3 flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <p className="font-bold text-ink">{dateRangeLabel}</p>
        <p className="shrink-0 text-right text-ink/55">{timeLabel}</p>
      </div>
      {selectedState === "cancelled" ? (
        <span className="inline-flex w-fit items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
          Cancelled
        </span>
      ) : (
        selectedState === "current" && (
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-red-600">
            <LiveDot className="animate-happening-now-glow rounded-full text-red-600" />
            Happening Now
          </span>
        )
      )}
      {location ? (
        <Link href={`/location/${location.slug}`} className="group w-fit">
          <span className="flex items-center gap-1 font-semibold text-ink transition group-hover:text-findmi-700">
            {location.name}
            <ChevronGlyph className="h-3 w-3 shrink-0 text-ink/30 transition group-hover:text-findmi-700" />
          </span>
          {addressLine && <span className="block text-xs text-ink/50">{addressLine}</span>}
        </Link>
      ) : (
        manualVenueLine && <p className="text-xs text-ink/55">{manualVenueLine}</p>
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
