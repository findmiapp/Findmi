"use client";

import type { EventBusinessListing } from "@/lib/data";
import EventBusinessRoster from "./EventBusinessRoster";
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
 * unchanged — only the data feeding it differs from the legacy path. */
export default function EventOccurrenceBusinessRoster({
  rostersByOccurrence,
}: {
  rostersByOccurrence: Record<string, EventBusinessListing[]>;
}) {
  const { selected } = useEventOccurrence();
  if (!selected) return null;

  const businesses = rostersByOccurrence[selected.id] ?? [];

  return (
    <section className="mt-5">
      <h2 className="font-display text-lg font-bold tracking-tight text-ink">Who You&rsquo;ll Find Here</h2>
      {businesses.length === 0 ? (
        <p className="mt-1 text-sm text-ink/55">Vendor lineup coming soon.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink/55">
            {businesses.length} business{businesses.length === 1 ? "" : "es"} confirmed
          </p>
          {/* key={selected.id} — forces a fresh EventBusinessRoster instance
              per occurrence, so its internal category-filter selection
              (active) resets to "All" instead of persisting a category
              name from the previously selected occurrence that may not
              exist (or match zero businesses) under the newly selected
              one. Without this, switching occurrences while a specific
              category was active could silently filter the new
              occurrence's roster down to zero visible cards. */}
          <EventBusinessRoster key={selected.id} businesses={businesses} />
        </>
      )}
    </section>
  );
}
