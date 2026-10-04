"use client";

import type { ReactNode } from "react";
import { useEventOccurrence } from "./EventOccurrenceContext";
import AddToCalendarButton from "./AddToCalendarButton";
import type { EventLocationCardLocation } from "./EventLocationCard";
import { cityState, cityStateZip } from "@/lib/format";
import { trackEvent, type TrackEventPayload } from "@/lib/analytics/track";

/** Event Detail Action Bar Correction pass, tightened in the Event Page
 * Visual Convergence pass — shared shell for the Event page's Tier B
 * utility row (Message/Save/Add to Calendar/Share/Get Here). Each item is
 * expected to fill its own cell (its component's own `layout="grid"`
 * prop, or the equivalent manually-styled Get Here cell, handles that).
 *
 * Event Action UX pass — converted from a CSS grid (equal-width columns,
 * which on mobile meant every action got compressed to fit all 4-5 in the
 * viewport at once) to a single horizontally-scrollable rail: fixed-width
 * cells that never shrink or wrap, so touch targets stay comfortable
 * regardless of how many actions are present. A missing action (no
 * Message configured, no selected occurrence for Add to Calendar/Get
 * Here) simply removes one cell from the row rather than reflowing
 * column widths — there's no shared column grid left to reflow. On a
 * wide-enough viewport (desktop) all items already fit without
 * overflowing, so nothing ever needs to scroll there — same component,
 * no breakpoint-specific layout. Negative-margin bleed + re-inset
 * padding (same pattern the Overflow-utilities row below already uses)
 * keeps this from ever causing page-level horizontal scroll; scrollbar
 * hidden via the same utility classes used elsewhere on this page. */
export function UtilityActionGrid({ items, variant = "rail" }: { items: ReactNode[]; variant?: "rail" | "bar" }) {
  if (items.length === 0) return null;
  // Public Event V2 — "bar": one quiet segmented surface with equal cells
  // instead of a strip of separate bordered tiles. The cells' own (shared)
  // grid-button borders are made transparent here only; the Location page
  // keeps the original "rail" look.
  if (variant === "bar") {
    return (
      <div className="grid grid-flow-col auto-cols-fr gap-0.5 rounded-2xl bg-black/[0.035] p-1 [&>div>a]:border-transparent [&>div>button]:border-transparent [&>div>div>button]:border-transparent">
        {items.map((item, i) => (
          <div key={i} className="h-[52px] min-w-0">
            {item}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="mt-2 -mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex w-max gap-2">
        {items.map((item, i) => (
          <div key={i} className="h-[50px] w-20 shrink-0">
            {item}
          </div>
        ))}
      </div>
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
      <span className="text-[11px] font-semibold uppercase tracking-wide">Get Here</span>
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
  variant = "rail",
}: {
  variant?: "rail" | "bar";
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

  return <UtilityActionGrid items={items} variant={variant} />;
}
