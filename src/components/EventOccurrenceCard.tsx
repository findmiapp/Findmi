"use client";

import type { EventOccurrenceWithLocation } from "@/lib/data";
import { cityState, formatDayOfMonthInZone, formatMonthAbbrevInZone, formatTimeRangeInZone } from "@/lib/format";
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
 * viewer's device timezone. */
export default function EventOccurrenceCard({ occurrence }: { occurrence: EventOccurrenceWithLocation }) {
  const { selected, select } = useEventOccurrence();
  const isSelected = selected?.id === occurrence.id;
  const cancelled = occurrence.status === "cancelled";
  const location = cityState(occurrence.location?.city, occurrence.location?.state);

  const now = Date.now();
  const live = !cancelled && new Date(occurrence.start_at).getTime() <= now && new Date(occurrence.end_at).getTime() > now;

  return (
    <button
      type="button"
      onClick={() => select(occurrence.id)}
      aria-pressed={isSelected}
      className={`flex w-56 shrink-0 items-center gap-3 rounded-2xl border p-3 text-left transition ${
        cancelled
          ? isSelected
            ? "border-red-300 bg-red-50/60"
            : "border-black/5 bg-black/[0.02] opacity-70"
          : isSelected
            ? "border-findmi bg-findmi-50 ring-1 ring-findmi"
            : live
              ? "border-findmi/50 bg-findmi-50"
              : "border-black/5 bg-white hover:border-black/20"
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
              {formatMonthAbbrevInZone(occurrence.start_at, occurrence.timezone)}
            </span>
            <span className="text-lg font-bold leading-none">
              {formatDayOfMonthInZone(occurrence.start_at, occurrence.timezone)}
            </span>
          </>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {cancelled ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Cancelled</p>
        ) : (
          <p className="truncate text-xs text-ink/55">
            {formatTimeRangeInZone(occurrence.start_at, occurrence.end_at, occurrence.timezone)}
          </p>
        )}
        {(occurrence.location?.name || location) && (
          <p className="mt-0.5 truncate text-xs text-ink/45">
            {[occurrence.location?.name, location].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
    </button>
  );
}
