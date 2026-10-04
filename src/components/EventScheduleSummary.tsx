"use client";

import {
  cityState,
  cityStateZip,
  formatDateShortInZone,
  formatDayOfMonthInZone,
  formatMonthAbbrevInZone,
  formatTimeInZone,
} from "@/lib/format";
import { useEventOccurrence } from "./EventOccurrenceContext";
import type { EventLocationCardLocation } from "./EventLocationCard";
import { EndedStatus, FactsBand, LiveStatus, QuietStatus, WhenFact, WhereFact, factLinkClass } from "./event/KeyFacts";
import { trackEvent } from "@/lib/analytics/track";

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
 * Event Page Final Compression pass — the top row shows the EVENT'S OWN
 * overall date range (earliest real occurrence's start -> latest real
 * occurrence's end, from the shared context's own `occurrences` list —
 * already the real, effective schedule this page fetched once; no new
 * data) rather than repeating the currently selected occurrence's single
 * date. Time is shown only when every real occurrence genuinely shares
 * the same local start/end time-of-day — inventing one universal time
 * for a schedule that doesn't actually share one would misrepresent it,
 * so a non-uniform schedule instead shows the SELECTED occurrence's own
 * real time (still accurate, just specific to that date). Venue stays
 * tied to the SELECTED occurrence, same as before.
 *
 * Event Hero / Logistics Final Micro-pass — date and time now read as
 * ONE compact schedule line ("date · time"), not two ends of a
 * justify-between row.
 *
 * Event Top Hierarchy Final Micro-pass — "Happening Now" is back on this
 * card (the hero no longer shows any live-status pill at all — see
 * FeaturedEventHeroOverlay — so this is now the ONE live-status
 * presentation on the page), directly beneath the schedule line: a small
 * glowing red dot + red text, never a large pill. A genuinely cancelled
 * selected occurrence shows its own compact tag in the same spot instead
 * (mutually exclusive with Happening Now — never both). A thin divider
 * separates that top "when/status" group from the venue/address group
 * beneath it, only when there's real venue content to separate from.
 *
 * Public Event V2 — rendered as the borderless Key Facts (WHEN / WHERE
 * rows, components/event/KeyFacts) instead of a bordered card: date range,
 * time and number of dates on the When row with a quiet status line
 * (Happening now · until …, the next date, or Cancelled); the selected
 * date's place, linked, with its address on the Where row. Same data and
 * selection logic as before.
 *
 * Public Event V2.1 — the two facts sit side by side in one compact band
 * (FactsBand); Directions moved here from the old utility toolbar. */
export interface HistoricalSchedule {
  dateLabel: string;
  detail: string | null;
  count: string | null;
  where: { name: string | null; href: string | null; line: string | null } | null;
}

export default function EventScheduleSummary({
  canonicalLocation,
  historical,
  eventId,
  directionsEnabled,
}: {
  canonicalLocation: EventLocationCardLocation | null;
  /** Public Event V2.1 — when no date is upcoming any more, the event's
   * real historical schedule (resolved server-side from its past dates)
   * stays the headline, qualified by a subtle Ended tag — never replaced
   * by a "no upcoming dates" message. Null only when nothing is known. */
  historical: HistoricalSchedule | null;
  eventId: string;
  directionsEnabled: boolean;
}) {
  const { occurrences, selected, selectedState } = useEventOccurrence();

  if (!selected || selectedState === "none") {
    if (!historical) {
      return <WhenFact dateLabel="No upcoming dates announced" detail="Follow to hear about new dates." />;
    }
    return (
      <FactsBand
        when={<WhenFact dateLabel={historical.dateLabel} detail={historical.detail} count={historical.count} status={<EndedStatus />} />}
        where={historical.where ? <WhereFact name={historical.where.name} href={historical.where.href} line={historical.where.line} /> : null}
      />
    );
  }

  const location = selected.location ?? canonicalLocation;
  const addressLine = location ? [location.address, cityState(location.city, location.state)].filter(Boolean).join(", ") : "";
  const manualVenueName = selected.venue_name ?? null;
  const manualVenueLine = [selected.address, cityStateZip(selected.city, selected.state, selected.postal_code)].filter(Boolean).join(", ");

  const first = occurrences[0] ?? selected;
  const last = occurrences[occurrences.length - 1] ?? selected;
  const sameDay = formatDateShortInZone(first.start_at, first.timezone) === formatDateShortInZone(last.end_at, first.timezone);
  // A range drops weekdays ("Oct 10 – Dec 26") so it fits one line of the
  // half-width band; a single day keeps its weekday.
  const monthDay = (iso: string) => `${formatMonthAbbrevInZone(iso, first.timezone)} ${formatDayOfMonthInZone(iso, first.timezone)}`;
  const dateRangeLabel = sameDay
    ? formatDateShortInZone(first.start_at, first.timezone)
    : `${monthDay(first.start_at)} – ${monthDay(last.end_at)}`;

  const firstStartTime = formatTimeInZone(first.start_at, first.timezone);
  const firstEndTime = formatTimeInZone(first.end_at, first.timezone);
  const hasUniformTime = occurrences.every(
    (o) => formatTimeInZone(o.start_at, o.timezone) === firstStartTime && formatTimeInZone(o.end_at, o.timezone) === firstEndTime
  );
  const timeLabel = hasUniformTime
    ? `${firstStartTime} – ${firstEndTime}`
    : `${formatTimeInZone(selected.start_at, selected.timezone)} – ${formatTimeInZone(selected.end_at, selected.timezone)}`;
  const dateCount = occurrences.length;
  const countLabel = dateCount > 1 ? `${dateCount} dates` : null;

  let status: React.ReactNode = null;
  if (selectedState === "cancelled") {
    status = <QuietStatus tone="red">This date is cancelled</QuietStatus>;
  } else if (selectedState === "current") {
    status = <LiveStatus until={formatTimeInZone(selected.end_at, selected.timezone)} />;
  } else if (dateCount > 1) {
    status = <QuietStatus>Next: {formatDateShortInZone(selected.start_at, selected.timezone)}</QuietStatus>;
  }

  // Directions — the selected date's place (same query EventUtilityActions
  // used to build for its "Get Here" cell, same click_directions payload).
  const mapQuery = location
    ? [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(", ")
    : [manualVenueName, manualVenueLine].filter(Boolean).join(", ");
  const directions =
    directionsEnabled && selectedState !== "cancelled" && mapQuery ? (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
        target="_blank"
        rel="noreferrer"
        className={factLinkClass}
        onClick={() =>
          trackEvent({
            event_name: "click_directions",
            subject_type: "event_occurrence",
            subject_id: selected.id,
            event_id: eventId,
            event_occurrence_id: selected.id,
            location_id: location && "id" in location ? (location.id as string) : undefined,
          })
        }
      >
        Directions
      </a>
    ) : null;

  return (
    <FactsBand
      when={<WhenFact dateLabel={dateRangeLabel} detail={timeLabel} count={countLabel} status={status} />}
      where={
        location ? (
          <WhereFact name={location.name} href={`/location/${location.slug}`} line={addressLine || null} action={directions} />
        ) : (
          <WhereFact name={manualVenueName} line={manualVenueLine || null} action={directions} />
        )
      }
    />
  );
}
