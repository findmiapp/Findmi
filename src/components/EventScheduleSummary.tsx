"use client";

import { cityState, formatDateRangeInZone } from "@/lib/format";
import { useEventOccurrence, type OccurrenceScheduleState } from "./EventOccurrenceContext";

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
 * selected occurrence's own timezone. */
export default function EventScheduleSummary() {
  const { selected, selectedState } = useEventOccurrence();

  if (!selected || selectedState === "none") {
    return <p className="mt-3 text-sm font-medium text-ink/50">No upcoming dates announced</p>;
  }

  const location = selected.location;
  const locationLine = location
    ? [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(" · ")
    : null;

  return (
    <div className="mt-3 flex flex-col gap-2 text-sm text-ink/65">
      <span
        className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          selectedState === "cancelled"
            ? "bg-red-50 text-red-700"
            : selectedState === "current"
              ? "bg-findmi text-white"
              : "bg-black/[0.06] text-ink/60"
        }`}
      >
        {STATE_LABEL[selectedState]}
      </span>
      <div className="flex items-center gap-2">
        <CalendarGlyph className="h-4 w-4 shrink-0 text-ink/40" />
        <span className="font-medium text-ink/80">
          {formatDateRangeInZone(selected.start_at, selected.end_at, selected.timezone)}
        </span>
      </div>
      {locationLine && (
        <div className="flex items-center gap-2">
          <PinGlyph className="h-4 w-4 shrink-0 text-ink/40" />
          <span>{locationLine}</span>
        </div>
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
