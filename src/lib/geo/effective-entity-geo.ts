// Canonical Entity Geography — COMPLETION pass. The read-time precedence
// for an Event Occurrence / Appearance's EFFECTIVE canonical geography —
// pure, no I/O (callers already have the rows in hand from their own
// queries), mirroring the exact two precedence shapes this codebase
// already uses for Market/Area, never a parallel system:
//   - lib/event-markets.ts's resolveEffectiveEventMarket (occurrence
//     override -> linked location -> parent event, each truthy wins).
//   - lib/appearance-geography.ts's resolveEffectiveAppearanceGeography
//     (a linked Location is ALWAYS authoritative once connected, even
//     when its own value happens to be null — never a fallback to a
//     stale pre-connection snapshot).
//
// LOCKED (per the Canonical Entity Geography completion plan):
//   - Location: authoritative for its own physical geography (trivial —
//     callers just read the Location's own geo_* columns directly).
//   - Event occurrence: its own explicit/manual geo wins when present;
//     otherwise, once linked to a Location, that Location is always
//     authoritative (even if still unresolved); otherwise the parent
//     Event's own geography.
//   - Appearance: event-linked -> the SAME occurrence-override/location/
//     event chain Market already uses (never the appearance's own stored
//     snapshot, which save actions deliberately leave null for a linked
//     appearance specifically so it can never drift from its Event).
//     Standalone + Location-linked -> the Location is authoritative.
//     Standalone with no Location -> its own stored snapshot.
//   - Business: always its own — no inheritance of any kind.

export interface EntityCanonicalGeo {
  place: string | null;
  zcta: string | null;
  state: string | null;
}

export const EMPTY_CANONICAL_GEO: EntityCanonicalGeo = { place: null, zcta: null, state: null };

const hasAny = (g: EntityCanonicalGeo | null | undefined): g is EntityCanonicalGeo => Boolean(g && (g.place || g.zcta || g.state));

export interface EffectiveOccurrenceCanonicalGeoInput {
  occurrenceGeo: EntityCanonicalGeo | null;
  locationId: string | null;
  /** The linked Location's own geo — only meaningful when locationId is
   * set; omitted/null still means "linked, but unresolved" (authoritative
   * empty), never a fallback to eventGeo. */
  locationGeo?: EntityCanonicalGeo | null;
  eventGeo: EntityCanonicalGeo | null;
}

export function effectiveOccurrenceCanonicalGeo(input: EffectiveOccurrenceCanonicalGeoInput): EntityCanonicalGeo {
  if (hasAny(input.occurrenceGeo)) return input.occurrenceGeo;
  if (input.locationId) return input.locationGeo ?? EMPTY_CANONICAL_GEO;
  return input.eventGeo ?? EMPTY_CANONICAL_GEO;
}

export interface EffectiveAppearanceCanonicalGeoInput {
  eventId: string | null;
  appearanceGeo: EntityCanonicalGeo | null;
  locationId: string | null;
  locationGeo?: EntityCanonicalGeo | null;
  /** Event-linked case only — the linked occurrence's own stored geo
   * (never its already-resolved effective geo; this function applies the
   * same occurrence-override precedence itself, one level, same as
   * resolveEffectiveEventMarket). */
  occurrenceGeo?: EntityCanonicalGeo | null;
  eventGeo?: EntityCanonicalGeo | null;
}

export function effectiveAppearanceCanonicalGeo(input: EffectiveAppearanceCanonicalGeoInput): EntityCanonicalGeo {
  if (input.eventId) {
    if (hasAny(input.occurrenceGeo)) return input.occurrenceGeo;
    if (input.locationId) return input.locationGeo ?? EMPTY_CANONICAL_GEO;
    return input.eventGeo ?? EMPTY_CANONICAL_GEO;
  }
  if (input.locationId) return input.locationGeo ?? EMPTY_CANONICAL_GEO;
  return input.appearanceGeo ?? EMPTY_CANONICAL_GEO;
}

/** Does an already-resolved effective geo fall inside a discovery query
 * scope (see canonical-scope.ts)? Multi-membership safe: a Place that
 * belongs to the scope under any one of its keys matches — never requires
 * matching every bucket at once. */
export function canonicalGeoMatchesScope(geo: EntityCanonicalGeo, scope: { placeKeys: string[]; zctaKeys: string[]; stateKeys: string[] }): boolean {
  if (geo.place && scope.placeKeys.includes(geo.place)) return true;
  if (geo.zcta && scope.zctaKeys.includes(geo.zcta)) return true;
  if (geo.state && scope.stateKeys.includes(geo.state)) return true;
  return false;
}
