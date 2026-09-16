"use client";

import AddToCalendarButton from "./AddToCalendarButton";
import { cityState } from "@/lib/format";
import { useEventOccurrence } from "./EventOccurrenceContext";
import { trackEvent } from "@/lib/analytics/track";

/** Add to Calendar for a recurring event — Recurring Events V2. Derives
 * from the shared selectedOccurrence's own start_at/end_at, never the
 * parent event's (stale-scheduling) fields. RSVP/Tickets/Apply to Vend
 * resolution is explicitly deferred to a later "CTA parity" pass (those
 * go through the Form Manager override chain, a separate system).
 * Renders nothing when no occurrence is selected, or when the selected
 * occurrence is cancelled (per the pass spec — "should NOT present a
 * cancelled occurrence as an active event").
 *
 * Public Experience V4 — Directions used to live here too, but Directions
 * is a high-intent physical action that belongs in Event's fixed,
 * always-visible primary row (see EventScheduleDirections below and its
 * use in EventPublicView), not buried in this horizontally-scrollable
 * utility rail alongside Save/Share/Contact. Split into its own component
 * so each can be placed where its actual intent warrants, without
 * duplicating the selected-occurrence lookup logic. */
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

/** Directions for the selected occurrence — pulled out of the Tier B
 * utility rail (see EventScheduleActions' own note) into Event's fixed
 * primary row, so it's immediately visible without a horizontal scroll —
 * matching the emphasis a physical "get me there" action deserves,
 * without making it compete with Tier A (Tickets/RSVP/Apply to Vend).
 * Same underlying selectedOccurrence.location data EventScheduleActions
 * uses; renders nothing when no occurrence is selected, directions are
 * disabled for this event, or there's no resolvable destination.
 * Directions stays available for a cancelled occurrence (consistent with
 * existing product behavior — the place itself didn't stop existing). */
export function EventScheduleDirections({
  eventId,
  directionsEnabled,
}: {
  /** Analytics attribution only — not used for any occurrence lookup
   * (that stays entirely selectedOccurrence-driven). */
  eventId: string;
  directionsEnabled: boolean;
}) {
  const { selected } = useEventOccurrence();
  if (!selected || !directionsEnabled) return null;

  const location = selected.location;
  const mapQuery = location
    ? [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(", ")
    : null;
  const directionsHref = mapQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
    : null;
  if (!directionsHref) return null;

  return (
    <a
      href={directionsHref}
      target="_blank"
      rel="noreferrer"
      className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-findmi/40 px-3 text-xs font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
      onClick={() =>
        trackEvent({
          event_name: "click_directions",
          subject_type: "event_occurrence",
          subject_id: selected.id,
          event_id: eventId,
          event_occurrence_id: selected.id,
          location_id: location?.id,
        })
      }
    >
      <DirectionsGlyph className="h-3.5 w-3.5 shrink-0" />
      Directions
    </a>
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
