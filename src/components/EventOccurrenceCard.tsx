"use client";

import type { EventOccurrenceWithLocation } from "@/lib/data";
import {
  cityState,
  formatDateShortInZone,
  formatDayOfMonthInZone,
  formatMonthAbbrevInZone,
  formatTimeInZone,
} from "@/lib/format";
import { useEventOccurrence } from "./EventOccurrenceContext";
import LiveDot from "./LiveDot";

/** One card in the public event page's "Upcoming Dates" row — Recurring
 * Events V2 makes this the occurrence SELECTOR for the whole page (see
 * EventOccurrenceContext), not an independent ticket link. Clicking/
 * tapping only ever changes which occurrence is selected in the shared
 * context; it never navigates. Per-occurrence ticket/RSVP/vendor-apply
 * link resolution (this card's previous click-through behavior) is
 * explicitly deferred to a later "CTA parity" pass — see the pass
 * report. Every date/time renders in the OCCURRENCE'S OWN timezone
 * (occurrence.timezone), never the app's global APP_TIMEZONE or the
 * viewer's device timezone.
 *
 * Date/Time Hierarchy Polish pass — "when is this" is the primary
 * consumer question, so the date is now the card's dominant element (a
 * real heading-weight line, never the small/gray month+day the old
 * left-side icon tile used), with the time directly beneath it and a
 * compact "Now" indicator — reusing the exact dot+red-text "Happening
 * Now" language AppearanceFeedCard already established, never a filled
 * block — displacing neither. Live status no longer tints the card's own
 * border/background (that visually competed with the aqua SELECTED
 * treatment); the small Now indicator is the only "happening now" signal
 * now, so selection and temporal status stay legible at the same time. */
export default function EventOccurrenceCard({ occurrence }: { occurrence: EventOccurrenceWithLocation }) {
  const { selected, select } = useEventOccurrence();
  const isSelected = selected?.id === occurrence.id;
  const cancelled = occurrence.status === "cancelled";
  const location = cityState(occurrence.location?.city, occurrence.location?.state);

  const now = Date.now();
  const live = !cancelled && new Date(occurrence.start_at).getTime() <= now && new Date(occurrence.end_at).getTime() > now;

  // A multi-day occurrence (its own start/end fall on different calendar
  // days in ITS OWN timezone — e.g. an overnight date) gets both bounds
  // ("Sep 25 – Sep 26"); a same-day occurrence gets the fuller
  // weekday-inclusive form ("Fri, Sep 25") — never collapsed to a single
  // date when the occurrence genuinely spans two. Both branches use only
  // real occurrence data already available on this object.
  const sameDay =
    formatMonthAbbrevInZone(occurrence.start_at, occurrence.timezone) ===
      formatMonthAbbrevInZone(occurrence.end_at, occurrence.timezone) &&
    formatDayOfMonthInZone(occurrence.start_at, occurrence.timezone) === formatDayOfMonthInZone(occurrence.end_at, occurrence.timezone);
  const dateLabel = sameDay
    ? formatDateShortInZone(occurrence.start_at, occurrence.timezone)
    : `${formatMonthAbbrevInZone(occurrence.start_at, occurrence.timezone)} ${formatDayOfMonthInZone(occurrence.start_at, occurrence.timezone)} – ${formatMonthAbbrevInZone(occurrence.end_at, occurrence.timezone)} ${formatDayOfMonthInZone(occurrence.end_at, occurrence.timezone)}`;
  // Time-of-day only for both bounds, regardless of same-day/multi-day —
  // the date line above already conveys any day-crossing, so this line
  // never needs to fall back to a combined date+time string the way
  // formatTimeRangeInZone's own multi-day branch does.
  const timeLabel = `${formatTimeInZone(occurrence.start_at, occurrence.timezone)} – ${formatTimeInZone(occurrence.end_at, occurrence.timezone)}`;

  return (
    <button
      type="button"
      onClick={() => select(occurrence.id)}
      aria-pressed={isSelected}
      className={`flex w-44 shrink-0 flex-col gap-1 rounded-2xl border p-3 text-left transition ${
        cancelled
          ? isSelected
            ? "border-red-300 bg-red-50/60"
            : "border-black/5 bg-black/[0.02] opacity-70"
          : isSelected
            ? "border-findmi bg-findmi-50 ring-1 ring-findmi"
            : "border-black/5 bg-white hover:border-black/20"
      }`}
    >
      <p className="text-sm font-bold uppercase leading-tight text-ink">{dateLabel}</p>
      {cancelled ? (
        <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Cancelled</p>
      ) : (
        <p className="text-xs font-medium text-ink/70">{timeLabel}</p>
      )}
      {live && (
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-red-600">
          <LiveDot className="text-red-600" />
          Now
        </span>
      )}
      {(occurrence.location?.name || location) && (
        <p className="truncate text-xs text-ink/45">
          {[occurrence.location?.name, location].filter(Boolean).join(" · ")}
        </p>
      )}
    </button>
  );
}
