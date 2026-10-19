"use client";

import { calendarDate, calendarDayOfMonth, calendarEndDate, calendarMonthAbbrev, formatCalendarDate } from "@/lib/event-time";
import { publicLocationHref } from "@/lib/location-links";
import {
  cityState,
  cityStateZip,
  formatDateShortInZone,
  formatTimeInZone,
} from "@/lib/format";
import { useEventOccurrence } from "./EventOccurrenceContext";
import type { EventLocationCardLocation } from "./EventLocationCard";
import { EndedStatus, FactsBand, QuietStatus, WhenFact, WhereFact } from "./event/KeyFacts";
import { HIDDEN_LOCATION_COPY } from "@/lib/event-attendance";

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
  locationHidden = false,
}: {
  /** The organizer shares the address only after registration. */
  locationHidden?: boolean;
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
  const locationZip = location && "postal_code" in location ? ((location as { postal_code?: string | null }).postal_code ?? null) : null;
  const addressLines = location ? [location.address, cityStateZip(location.city, location.state, locationZip)] : [];
  const manualVenueName = selected.venue_name ?? null;
  const manualAddressLines = [selected.address, cityStateZip(selected.city, selected.state, selected.postal_code)];
  const manualVenueLine = manualAddressLines.filter(Boolean).join(", ");

  const first = occurrences[0] ?? selected;
  const last = occurrences[occurrences.length - 1] ?? selected;
  // Event date/time precision: the range comes from real calendar dates;
  // times only where published (never a closing time that isn't known).
  const firstDate = calendarDate(first) ?? "";
  const lastDate = calendarEndDate(last) ?? firstDate;
  const sameDay = firstDate === lastDate;
  // A range drops weekdays ("Oct 10 – Dec 26") so it fits one line of the
  // half-width band; a single day keeps its weekday.
  const monthDay = (date: string) => `${calendarMonthAbbrev(date)} ${calendarDayOfMonth(date)}`;
  const dateRangeLabel = sameDay
    ? first.start_at
      ? formatDateShortInZone(first.start_at, first.timezone)
      : formatCalendarDate(firstDate, "short")
    : `${monthDay(firstDate)} – ${monthDay(lastDate)}`;

  const timeOfDay = (o: typeof first) =>
    !o.start_at ? "" : o.end_at ? `${formatTimeInZone(o.start_at, o.timezone)} – ${formatTimeInZone(o.end_at, o.timezone)}` : formatTimeInZone(o.start_at, o.timezone);
  const firstTime = timeOfDay(first);
  const hasUniformTime = occurrences.every((o) => timeOfDay(o) === firstTime);
  const timeLabel = hasUniformTime ? firstTime : timeOfDay(selected);
  // `occurrences` is the upcoming schedule (end_at > now — a date that is
  // live right now is included), never the Event's lifetime count; the
  // same list feeds the Upcoming Dates section below.
  const dateCount = occurrences.length;
  // Event Detail Compression pass — with a single upcoming occurrence,
  // this WHEN block's own date/time already says everything a count
  // would add; repeating that count (and the full-size Upcoming Dates
  // section beneath it) would be redundant. Two or more dates still need
  // the count, since the WHEN block only shows a range, not every
  // individual date.
  const countLabel = dateCount > 1 ? `${dateCount} upcoming dates` : null;

  let status: React.ReactNode = null;
  if (selectedState === "cancelled") {
    status = <QuietStatus tone="red">This date is cancelled</QuietStatus>;
  } else if (dateCount > 1 && selectedState !== "current") {
    // Live status is NOT repeated here — the hero's glass indicator is the
    // page-level "Happening now", and the occurrence card marks the date.
    status = <QuietStatus>Next: {selected.start_at ? formatDateShortInZone(selected.start_at, selected.timezone) : formatCalendarDate(calendarDate(selected) ?? "", "short")}</QuietStatus>;
  }

  // Directions — the selected date's place (same query EventUtilityActions
  // used to build for its "Get Here" cell, same click_directions payload).
  const mapQuery = location
    ? [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(", ")
    : [manualVenueName, manualVenueLine].filter(Boolean).join(", ");
  // This date's own details (event_occurrences.details) — only the
  // selected date's, never every date's at once.
  const details = selected.details?.trim() || null;
  return (
    <>
    <FactsBand
      when={<WhenFact dateLabel={dateRangeLabel} detail={timeLabel} count={countLabel} status={status} />}
      where={
        locationHidden ? (
          <WhereFact name={HIDDEN_LOCATION_COPY} lines={[cityState(selected.city, selected.state)]} />
        ) : location ? (
          <WhereFact name={location.name} href={publicLocationHref(location)} lines={addressLines} />
        ) : (
          <WhereFact name={manualVenueName} lines={manualAddressLines} />
        )
      }
    />
    {details && (
      <p className="mt-3 whitespace-pre-line text-body text-secondary" data-occurrence-details="">
        {details}
      </p>
    )}
    </>
  );
}
