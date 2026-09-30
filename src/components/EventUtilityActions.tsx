"use client";

import type { ReactNode } from "react";
import { useEventOccurrence } from "./EventOccurrenceContext";
import AddToCalendarButton from "./AddToCalendarButton";
import type { EventLocationCardLocation } from "./EventLocationCard";
import { cityState, cityStateZip } from "@/lib/format";
import { trackEvent, type TrackEventPayload } from "@/lib/analytics/track";

const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

/** Event Detail Action Bar Correction pass, tightened in the Event Page
 * Visual Convergence pass — shared shell for the Event page's Tier B
 * utility row (Message/Save/Add to Calendar/Share/Directions). Column
 * count is DERIVED from how many items are actually passed, never fixed
 * — a missing action (no Message configured, no selected occurrence for
 * Add to Calendar/Directions) reflows the remaining actions to fill the
 * row evenly instead of leaving an empty cell. Each item is expected to
 * fill its own cell (its component's own `layout="grid"` prop, or the
 * equivalent manually-styled Directions cell, handles that). Cell height
 * shrunk 58px -> 50px and the row's own top margin tightened (mobile
 * density correction) — RSVP/Tickets/Apply to Vend directly above this
 * stays visually the LARGEST action; this row reads as compact, equally-
 * sized icon-over-label controls beneath it. */
export function UtilityActionGrid({ items }: { items: ReactNode[] }) {
  if (items.length === 0) return null;
  return (
    <div className={`mt-2 grid gap-2 ${GRID_COLS[items.length] ?? "grid-cols-4"}`}>
      {items.map((item, i) => (
        <div key={i} className="h-[50px]">
          {item}
        </div>
      ))}
    </div>
  );
}

// Same visual language as the "grid" layout every Tier B action button
// already uses (EventSaveButton/EventShareButton/MessageButton/
// AddToCalendarButton) — Directions has no such component of its own
// here, so this is a plain link manually styled to match exactly, rather
// than adding a "grid" layout to a component that doesn't otherwise need
// one.
/** Exported so the legacy (non-recurring) event path in EventPublicView.tsx
 * (a Server Component) can render the exact same Directions cell —
 * `trackPayload` is a plain serializable object (not a function, which
 * can never cross the server/client boundary as a prop), matching the
 * same AnalyticsLink convention every other server-resolved tracked link
 * on this page already uses; this component fires trackEvent with it
 * internally on click. */
export function DirectionsGridCell({ href, trackPayload }: { href: string; trackPayload: TrackEventPayload }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() => trackEvent(trackPayload)}
      className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl border border-black/10 text-ink/70 transition hover:border-ink/30 hover:text-ink"
    >
      <DirectionsGlyph className="h-4 w-4" />
      <span className="text-[11px] font-semibold uppercase tracking-wide">Directions</span>
    </a>
  );
}

function DirectionsGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 2L4.5 20.5l.9.9L12 18l6.6 3.4.9-.9L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/** Recurring-event Tier B utility row. Message/Save/Share are passed in
 * already-built (they don't depend on the selected occurrence), so this
 * component's own job is the pieces that DO — Add to Calendar and
 * Directions, both resolved from the shared selected-occurrence context
 * (client-only, unknowable at SSR) — deciding whether they join the
 * grid. Never returns null itself: Save is always passed and always
 * renders, so there's no "hide the whole row" case, only "how many
 * columns" to compute.
 *
 * Event Page Visual Convergence pass — Directions moved here from
 * EventScheduleCtas (Tier A), matching the approved reference's
 * composition (RSVP alone above; Directions alongside Save/Calendar/
 * Share below, not beside RSVP). Same mapQuery/href computation
 * EventScheduleCtas used to do, same click_directions analytics
 * payload.
 *
 * Final Mobile Visual Convergence pass — root-caused why Directions was
 * silently absent on a real recurring event (illy's Cup of Love
 * included): this only ever read the SELECTED OCCURRENCE's own linked
 * Location (selected.location, from event_occurrences.location_id), never
 * the Event-level canonicalLocation EventPublicView.tsx already resolves
 * (the nearest occurrence WITH a linked Location, or the legacy exact-
 * venue-match fallback — see that variable's own comment). A recurring
 * event can easily have every occurrence's own location_id unset while
 * still having a perfectly real, resolvable Location for the event as a
 * whole — that's exactly the illy case. `canonicalLocation` is passed
 * down as a fallback, never a replacement: the selected occurrence's own
 * Location still wins whenever it has one. When NEITHER resolves, this
 * now also falls back to the occurrence's own manual venue text fields
 * (venue_name/address/city/state/postal_code — the same fields
 * EventScheduleSummary's own manualVenueLine fallback already reads) to
 * build a Maps query, so Directions still works for a founder-typed venue
 * with no FindMi Location relationship at all — same data, no new system. */
export default function EventUtilityActions({
  eventId,
  eventName,
  description,
  message,
  save,
  share,
  directionsEnabled,
  canonicalLocation,
}: {
  eventId: string;
  eventName: string;
  description: string | null;
  message: ReactNode | null;
  save: ReactNode;
  share: ReactNode;
  directionsEnabled: boolean;
  /** Always a real Location row in practice (EventPublicView.tsx's own
   * canonicalLocation, which always carries its real `id`) — narrowed to
   * `& { id: string }` here only so `location?.id` below type-checks
   * against the union with the occurrence's own `selected.location`. */
  canonicalLocation: (EventLocationCardLocation & { id: string }) | null;
}) {
  const { selected, selectedState } = useEventOccurrence();
  const canShowCalendar = Boolean(selected) && selectedState !== "cancelled";

  const location = selected?.location ?? canonicalLocation ?? null;
  const manualVenueLine = selected
    ? [selected.venue_name, selected.address, cityStateZip(selected.city, selected.state, selected.postal_code)]
        .filter(Boolean)
        .join(" · ")
    : "";
  const locationLine = location
    ? [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(" · ")
    : manualVenueLine || null;
  const mapQuery = location
    ? [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(", ")
    : manualVenueLine || null;
  const directionsHref =
    directionsEnabled && selected && selectedState !== "cancelled" && mapQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
      : null;

  const items = [
    message,
    save,
    canShowCalendar && selected ? (
      <AddToCalendarButton
        key="calendar"
        title={eventName}
        description={description}
        location={locationLine}
        startAt={selected.start_at}
        endAt={selected.end_at}
        layout="grid"
      />
    ) : null,
    share,
    directionsHref && selected ? (
      <DirectionsGridCell
        key="directions"
        href={directionsHref}
        trackPayload={{
          event_name: "click_directions",
          subject_type: "event_occurrence",
          subject_id: selected.id,
          event_id: eventId,
          event_occurrence_id: selected.id,
          location_id: location?.id,
        }}
      />
    ) : null,
  ].filter((item): item is ReactNode => Boolean(item));

  return <UtilityActionGrid items={items} />;
}
