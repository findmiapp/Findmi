// Geography Foundation Pass 4 — the standalone-Appearance counterpart of
// lib/event-markets.ts's resolveEffectiveEventMarket. Same "pure function
// over already-resolved ids" shape: callers already have the appearance/
// location rows in hand from their own queries; this file only owns the
// precedence rule itself, never a parallel query path.
//
// LOCKED precedence:
//   1. appearance.location_id present -> the linked Location's OWN
//      market_id/market_area_id are canonical, EVEN WHEN NULL. A Location
//      with no Findmi area assigned yet means the appearance currently has
//      none either — this never falls back to a stale pre-connection
//      snapshot still sitting in appearances.market_id/market_area_id.
//      Once connected to a real Location, that stored snapshot is kept in
//      the row for compatibility/history only and is never authoritative
//      again while location_id is present.
//   2. appearance.location_id absent -> the appearance's own stored
//      market_id/market_area_id are the canonical (manual) snapshot,
//      unchanged from before this pass.
//
// Event-linked appearances (appearance.event_id set) are OUT OF SCOPE for
// this resolver entirely — their geography already comes from
// resolveEffectiveEventMarket via the parent Event/Occurrence (see
// getFindMiHereFeed's own event_id branch, which never calls this
// function) — never route an event-linked appearance through this.
export interface EffectiveAppearanceGeographyInput {
  locationId: string | null;
  appearanceMarketId: string | null;
  appearanceAreaId: string | null;
  /** Only meaningful when locationId is set — the linked Location's own
   * current market_id/market_area_id, read fresh by the caller. */
  locationMarketId?: string | null;
  locationAreaId?: string | null;
}

export type EffectiveAppearanceGeographySource = "location" | "appearance" | "none";

export interface EffectiveAppearanceGeographyResult {
  marketId: string | null;
  areaId: string | null;
  source: EffectiveAppearanceGeographySource;
}

export function resolveEffectiveAppearanceGeography(
  input: EffectiveAppearanceGeographyInput
): EffectiveAppearanceGeographyResult {
  if (input.locationId) {
    return { marketId: input.locationMarketId ?? null, areaId: input.locationAreaId ?? null, source: "location" };
  }
  if (input.appearanceMarketId || input.appearanceAreaId) {
    return { marketId: input.appearanceMarketId, areaId: input.appearanceAreaId, source: "appearance" };
  }
  return { marketId: null, areaId: null, source: "none" };
}
