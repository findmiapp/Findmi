// Event Market Mapping Foundation V1 — the ONE centralized resolver for an
// event occurrence's effective FindMi Market. Every caller (admin display,
// and any future consumer-filtering pass) must go through this function
// rather than re-deriving the precedence itself, so the locked rule below
// lives in exactly one place — same "one shared resolver" shape as
// lib/entitlements.ts's getBusinessMarketLimit.
//
// LOCKED precedence (do not reorder):
//   1. the occurrence's own explicit override (event_occurrences.market_id)
//   2. ELSE the linked location's Market (locations.market_id, via
//      occurrence.location_id) — the physical venue overrides the parent
//      event whenever they differ
//   3. ELSE the parent event's default Market (events.market_id)
//   4. ELSE no Market (null)
//
// A legacy event with zero occurrence rows has no occurrence/location
// inputs to pass at all — calling this with only eventMarketId set
// correctly resolves to that same events.market_id.
//
// This is a pure function over already-resolved ids, not a data-fetcher —
// callers (admin pages, and later a consumer resolver) already have the
// event/occurrence/location rows in hand from their own queries; this
// file only owns the precedence rule itself, never a parallel query path.
export interface EffectiveEventMarketInput {
  eventMarketId: string | null;
  occurrenceMarketId?: string | null;
  locationMarketId?: string | null;
}

export type EffectiveEventMarketSource = "occurrence_override" | "location" | "event" | "none";

export interface EffectiveEventMarketResult {
  marketId: string | null;
  source: EffectiveEventMarketSource;
}

export function resolveEffectiveEventMarket(input: EffectiveEventMarketInput): EffectiveEventMarketResult {
  if (input.occurrenceMarketId) return { marketId: input.occurrenceMarketId, source: "occurrence_override" };
  if (input.locationMarketId) return { marketId: input.locationMarketId, source: "location" };
  if (input.eventMarketId) return { marketId: input.eventMarketId, source: "event" };
  return { marketId: null, source: "none" };
}
