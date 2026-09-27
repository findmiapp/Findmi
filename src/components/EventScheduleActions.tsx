"use client";

import AddToCalendarButton from "./AddToCalendarButton";
import { cityState } from "@/lib/format";
import { useEventOccurrence } from "./EventOccurrenceContext";

/** Add to Calendar for a recurring event — Recurring Events V2. Derives
 * from the shared selectedOccurrence's own start_at/end_at, never the
 * parent event's (stale-scheduling) fields. RSVP/Tickets/Apply to Vend
 * resolution is explicitly deferred to a later "CTA parity" pass (those
 * go through the Form Manager override chain, a separate system).
 * Renders nothing when no occurrence is selected, or when the selected
 * occurrence is cancelled (per the pass spec — "should NOT present a
 * cancelled occurrence as an active event").
 *
 * Public Experience V4 — Directions used to live here too. Event CTA
 * Layout pass — the standalone EventScheduleDirections this comment used
 * to point to is retired: Directions now renders as part of
 * EventScheduleCtas' own single row (`[ RSVP ] [ DIRECTIONS ]`), since
 * that component needs to make one "is there anything to show" decision
 * across both Tier A actions and Directions together (see its own doc
 * comment) rather than composing two independently-nullable pieces. */
export default function EventScheduleActions({
  eventName,
  description,
}: {
  eventName: string;
  description: string | null;
}) {
  const { selected, selectedState } = useEventOccurrence();
  if (!selected || selectedState === "cancelled") return null;

  const location = selected.location;
  const locationLine = location
    ? [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(" · ")
    : null;

  return (
    <div className="shrink-0">
      <AddToCalendarButton
        title={eventName}
        description={description}
        location={locationLine}
        startAt={selected.start_at}
        endAt={selected.end_at}
      />
    </div>
  );
}
