"use client";

import type { EventBusinessListing } from "@/lib/data";
import EventBusinessRoster from "./EventBusinessRoster";
import BrandHeading from "./BrandHeading";
import { useEventOccurrence } from "./EventOccurrenceContext";

/** "Who You'll Find Here" for a recurring event — Recurring Events V2.
 * The SELECTED occurrence's own event_occurrence_businesses roster is
 * authoritative; a legacy one-time event's event_businesses roster
 * renders separately (see the public event page) and is never used as a
 * fallback here. Switching Upcoming Dates cards swaps this instantly —
 * no refetch, no navigation — because every occurrence's roster was
 * already fetched server-side in one query (getOccurrenceBusinessRosters)
 * and passed down keyed by occurrence id; this just looks up the
 * currently selected key. Reuses the existing EventBusinessRoster
 * component (featured section, category filter pills, business cards)
 * unchanged — only the data feeding it differs from the legacy path.
 *
 * Event Page Visual Convergence pass — deliberately does NOT fall back
 * to the Event's own event-wide roster when this occurrence has none:
 * that would claim a business is confirmed for a specific date the
 * occurrence relationship never actually says it is. The Event's real
 * host Business (event_businesses.featured, or the sole participant) is
 * surfaced separately via the page's own "Hosted By" card instead — this
 * section stays strictly "what does THIS occurrence's own roster say." */
export default function EventOccurrenceBusinessRoster({
  rostersByOccurrence,
  eventName,
}: {
  rostersByOccurrence: Record<string, EventBusinessListing[]>;
  eventName: string;
}) {
  const { selected } = useEventOccurrence();
  if (!selected) return null;

  const businesses = rostersByOccurrence[selected.id] ?? [];
  // Public Event V2 — no empty section: a date with no confirmed lineup
  // renders nothing (the parent supplies spacing/separators).
  if (businesses.length === 0) return null;

  return (
    <section id="lineup" className="scroll-mt-24">
      {/* Public Event V2 Next Body pass — "Findmi Here" is the branded
          name for this Event's participating/featured roster, distinct
          from Hosted By (organizer identity) and Location (physical
          place). Same BrandHeading treatment as Findmi Moments. */}
      <BrandHeading accent="Here" />
      <p className="mt-1.5 max-w-xl text-metadata text-muted">Discover the brands, people and organizations featured at this event.</p>
      {/* Public Event V2.1 — one business is shown compactly (the card
          alone); a count line only helps when there's a lineup. */}
      {businesses.length > 1 && <p className="mt-2 text-metadata text-muted">{businesses.length} businesses confirmed</p>}
      {/* key={selected.id} — forces a fresh EventBusinessRoster instance
          per occurrence, so its internal category-filter selection
          (active) resets to "All" instead of persisting a category
          name from the previously selected occurrence that may not
          exist (or match zero businesses) under the newly selected
          one. Without this, switching occurrences while a specific
          category was active could silently filter the new
          occurrence's roster down to zero visible cards. */}
      <EventBusinessRoster key={selected.id} businesses={businesses} eventName={eventName} />
    </section>
  );
}
