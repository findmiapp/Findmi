"use client";

import AddToCalendarButton from "./AddToCalendarButton";
import { cityState } from "@/lib/format";
import { useEventOccurrence } from "./EventOccurrenceContext";

/** Directions + Add to Calendar for a recurring event — Recurring Events
 * V2. Both derive from the shared selectedOccurrence's own location/
 * start_at/end_at, never the parent event's (stale-scheduling) fields.
 * RSVP/Tickets/Apply to Vend resolution is explicitly deferred to a
 * later "CTA parity" pass (those go through the Form Manager override
 * chain, a separate system) — this component only covers the two
 * actions that need nothing but date/time/location. Renders nothing
 * when no occurrence is selected (state "none" — there's nothing to
 * give directions to or add to a calendar). Add to Calendar is hidden
 * for a cancelled occurrence, per the pass spec ("should NOT present a
 * cancelled occurrence as an active event"); Directions stays available
 * for a cancelled occurrence, consistent with existing product
 * behavior. */
export default function EventScheduleActions({
  eventName,
  description,
  directionsEnabled,
}: {
  eventName: string;
  description: string | null;
  directionsEnabled: boolean;
}) {
  const { selected, selectedState } = useEventOccurrence();
  if (!selected) return null;

  const location = selected.location;
  const locationLine = location
    ? [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(" · ")
    : null;
  const mapQuery = location
    ? [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(", ")
    : null;
  const directionsHref = mapQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
    : null;

  return (
    <>
      {directionsEnabled && directionsHref && (
        <a
          href={directionsHref}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
        >
          <DirectionsGlyph className="h-3.5 w-3.5 shrink-0" />
          Directions
        </a>
      )}
      {selectedState !== "cancelled" && (
        <div className="shrink-0">
          <AddToCalendarButton
            title={eventName}
            description={description}
            location={locationLine}
            startAt={selected.start_at}
            endAt={selected.end_at}
          />
        </div>
      )}
    </>
  );
}

// Same glyph/sizing convention as the Save and Add to Calendar icons in
// this same action row (h-3.5 w-3.5, strokeWidth 1.8, currentColor).
function DirectionsGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 2L4.5 20.5l.9.9L12 18l6.6 3.4.9-.9L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
