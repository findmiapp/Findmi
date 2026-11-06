// The ONE place an Event-backed row borrows its Event's Location (pure,
// testable). An Event-level row (hosting, Event-level participation, an
// Event-level Appearance) names no date of its own, so it has no
// `location_id` of its own either. It may use the Event's Location only
// when that is unambiguous: every non-cancelled date of the Event is at the
// SAME real Location. Dates spread over several places, or any date with no
// Location, leave the row unplaced — nothing is guessed, written or
// geocoded, and a Business's headquarters is never used.

export interface OccurrenceLocationRow {
  event_id: string;
  location_id: string | null;
  status?: string | null;
}

const isCancelled = (s: string | null | undefined) => s === "cancelled" || s === "canceled";

/** event_id → its single Location id, for Events whose every
 * non-cancelled date is at that one Location. */
export function unambiguousEventLocations(rows: readonly OccurrenceLocationRow[]): Map<string, string> {
  const seen = new Map<string, Set<string | null>>();
  for (const r of rows) {
    if (isCancelled(r.status)) continue;
    const set = seen.get(r.event_id) ?? new Set<string | null>();
    set.add(r.location_id ?? null);
    seen.set(r.event_id, set);
  }
  const out = new Map<string, string>();
  for (const [eventId, locs] of seen) {
    if (locs.size !== 1) continue;
    const [only] = [...locs];
    if (only) out.set(eventId, only);
  }
  return out;
}
