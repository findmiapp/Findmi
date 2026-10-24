// Location Moments — CAPTURE ONCE, SURFACE ON CONNECTED PLACES.
//
// A public, published Moment belongs on a Location page when it is
// structurally connected to that place through Findmi's canonical graph:
//
//   1. journal_entries.location_id is the place itself, or a place
//      physically INSIDE it (a descendant via locations.parent_location_id
//      — e.g. a kiosk inside a plaza). Same containment the Location page
//      already uses for "Within" activity (data.ts getLocationDescendants).
//   2. One of the Moment's journal_entry_connections names an Event date
//      (event_occurrence_id) held at the place or a descendant — so a
//      Moment captured at an Event date surfaces where that date happened,
//      even when the author never picked a Location.
//
// Never: manual-location text matching, ancestors (a Moment at a plaza is
// not "at" the kiosk inside it), or Event-level connections without a
// specific date (an Event can span several places — attributing it to one
// would be a guess). No duplicate Moment rows are created: this only
// widens which existing rows a Location's read path selects. Visibility
// (anon client + public/published filters), moderation status and the
// displaying entity's Hide From Profile / Featured preferences still apply
// on top, unchanged.
//
// Pure and dependency-free (tests/location-moment-propagation.test.mjs).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Upper bound on ids interpolated into one PostgREST filter, so a very
 * large hierarchy or a very busy place can never build an unbounded URL. */
export const LOCATION_MOMENT_ID_CAP = 400;

const clean = (ids: readonly string[]): string[] => [...new Set(ids.filter((id) => UUID_RE.test(id)))].slice(0, LOCATION_MOMENT_ID_CAP);

/** The places whose Moments a Location page shows: the place, then its
 * descendants (validated, de-duplicated, capped). */
export function locationMomentPlaceIds(locationId: string, descendantIds: readonly string[]): string[] {
  return clean([locationId, ...descendantIds]);
}

/** The PostgREST or() filter over journal_entries for one Location:
 * located at one of `placeIds`, or one of `connectedEntryIds` (Moments
 * whose connection names an Event date held at one of those places).
 * Null when nothing could match. */
export function locationMomentFilter(placeIds: readonly string[], connectedEntryIds: readonly string[]): string | null {
  const places = clean(placeIds);
  const entries = clean(connectedEntryIds);
  const parts: string[] = [];
  if (places.length > 0) parts.push(`location_id.in.(${places.join(",")})`);
  if (entries.length > 0) parts.push(`id.in.(${entries.join(",")})`);
  return parts.length > 0 ? parts.join(",") : null;
}

/** A sentinel no row can have, so an empty eligible set filters to zero
 * rows instead of becoming an empty (invalid) `in.()` list. */
export const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000";

/** The eligible entry ids for `.in("id", …)` — validated, de-duplicated,
 * capped, never empty. */
export function eligibleLocationEntryIds(ids: readonly string[]): string[] {
  const out = clean(ids);
  return out.length > 0 ? out : [NO_MATCH_ID];
}

export interface LocationMomentCandidate {
  locationId: string | null;
  /** event_occurrence_id of each connection (null for non-date connections). */
  occurrenceIds: readonly (string | null)[];
}

/** The rule above as a predicate — the read path's query must agree with
 * it. `occurrencePlace` maps an Event date to the place it is held at. */
export function momentSurfacesAtPlace(
  moment: LocationMomentCandidate,
  placeIds: readonly string[],
  occurrencePlace: ReadonlyMap<string, string | null>
): boolean {
  const places = new Set(placeIds);
  if (moment.locationId && places.has(moment.locationId)) return true;
  return moment.occurrenceIds.some((occ) => {
    if (!occ) return false;
    const at = occurrencePlace.get(occ);
    return Boolean(at && places.has(at));
  });
}
