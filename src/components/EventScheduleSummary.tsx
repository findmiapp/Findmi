"use client";

import { cityStateZip, formatDateRangeInZone } from "@/lib/format";
import { useEventOccurrence, type OccurrenceScheduleState } from "./EventOccurrenceContext";
import EventLocationCard, { type EventLocationCardLocation } from "./EventLocationCard";
import LiveDot from "./LiveDot";

const STATE_LABEL: Record<Exclude<OccurrenceScheduleState, "none">, string> = {
  current: "Happening Now",
  next: "Next Event",
  selected: "Selected Date",
  cancelled: "Cancelled",
};

/** The recurring-event hero's date/time/location block — Recurring
 * Events V2. Reads ONLY the shared selectedOccurrence (never the parent
 * event's own start_at/end_at/venue fields, which stop being public
 * scheduling truth the moment occurrence rows exist), so this can never
 * show a stale parent date while occurrences exist. Renders in the
 * selected occurrence's own timezone.
 *
 * Final Mobile Visual Convergence pass — `canonicalLocation` is a new
 * fallback prop (EventPublicView.tsx's own already-resolved Location for
 * the event as a whole — the nearest occurrence WITH a linked Location,
 * or the legacy exact-venue-match). The selected occurrence's own
 * location_id still wins whenever it has one; this only fills in the
 * common case where the selected occurrence itself has no location_id
 * but the event unambiguously has a real Location anyway — without it,
 * the top logistics module silently fell back to plain manual-venue text
 * even when a genuine FindMi Location was already known. */
export default function EventScheduleSummary({
  canonicalLocation,
}: {
  canonicalLocation: EventLocationCardLocation | null;
}) {
  const { selected, selectedState } = useEventOccurrence();

  if (!selected || selectedState === "none") {
    return <p className="mt-3 text-sm font-medium text-ink/50">No upcoming dates announced</p>;
  }

  // Event Manager Location UX pass — a real linked Location (occurrence.
  // location_id) always renders as a clickable /location/[slug] card, per
  // this pass's own spec ("must render as a clickable Location
  // relationship... never show only plain venue text when a canonical
  // Location exists"). No location_id falls back to the event's own
  // canonicalLocation, then to this occurrence's own manual venue fields
  // (added alongside location_id — see resolveOccurrenceVenue in
  // account/event/actions.ts) as plain text, same as a legacy event's own
  // venue_name/address always has.
  const location = selected.location ?? canonicalLocation;
  const manualVenueLine = [selected.venue_name, selected.address, cityStateZip(selected.city, selected.state, selected.postal_code)]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mt-3 flex flex-col gap-2 text-sm text-ink/65">
      <span
        className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          selectedState === "cancelled"
            ? "bg-red-50 text-red-700"
            : selectedState === "current"
              ? "bg-findmi text-white"
              : "bg-black/[0.06] text-ink/60"
        }`}
      >
        {/* Full pill = aqua + white text; the live signal itself is the
            dot — red, pulsing, with the shared animate-happening-now-glow
            halo — not the pill background. The compact Upcoming Dates NOW
            tile (EventOccurrenceCard) keeps its own red-fill treatment;
            this is the opposite convention, deliberately, per this pass. */}
        {selectedState === "current" && (
          <LiveDot className="animate-happening-now-glow rounded-full text-red-600" />
        )}
        {STATE_LABEL[selectedState]}
      </span>
      <div className="flex items-center gap-2">
        <CalendarGlyph className="h-4 w-4 shrink-0 text-ink/40" />
        <span className="font-medium text-ink/80">
          {formatDateRangeInZone(selected.start_at, selected.end_at, selected.timezone)}
        </span>
      </div>
      {location ? (
        <EventLocationCard location={location} />
      ) : (
        manualVenueLine && (
          <div className="flex items-center gap-2">
            <PinGlyph className="h-4 w-4 shrink-0 text-ink/40" />
            <span>{manualVenueLine}</span>
          </div>
        )
      )}
    </div>
  );
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PinGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
