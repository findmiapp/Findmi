// Canonical Entity Geography — the pure decision layer for SAVING an
// entity's own geo_place_key/geo_zcta_key/geo_state_key, as distinct from
// lib/geo/resolve-core.ts (which decides what a consumer SEARCH query
// means, and deliberately collapses straight to a Findmi Market/Area
// target whenever one exists). An entity's canonical key is never
// collapsed that way: Findmi's Market/Area is always a SEPARATE, optional
// suggestion surfaced alongside the raw Census key, per the locked product
// model — "an entity does not need a Market or Area to exist
// geographically."
//
// Never guesses: more than one plausible Place with no disambiguating
// state/context is "ambiguous" (choices returned, nothing picked). A
// recognized Findmi Area/Market name with no canonical mapping yet is
// "partial" (Findmi knows it, Census doesn't have a key for it yet).
//
// Mirrors the CHECK constraints in
// supabase/migrations/20261025000000_canonical_entity_geography.sql —
// change both together.
//
// Canonical Entity Geography — COMPLETION pass. A DISCOVERY-time query
// scope is a different shape from the save-time EntityGeoKeys above: a
// query can be a County (never stored on an entity) or a State, and must
// expand to every geo_place_key/geo_zcta_key value it covers. The server
// half (canonical-scope.ts) resolves that expansion via
// census_geography_links; this file only owns the resulting shape and the
// pure PostgREST filter string it turns into — never a second resolver.

import { normalizeSearch } from "./census-format";

/** The five tables the backfill runner (entity-geo-backfill.ts) covers —
 * declared here, not there, so the Admin client component rendering its
 * table picker can import this plain list without pulling in that
 * "server-only"-guarded module. */
export type BackfillTable = "events" | "event_occurrences" | "locations" | "businesses" | "appearances";
export const BACKFILL_TABLES: BackfillTable[] = ["events", "event_occurrences", "locations", "businesses", "appearances"];
import type { CensusHit, GeoTarget, ProductMapping } from "./resolve-core";
import { productTargetFor } from "./resolve-core";
import { STATE_BY_USPS, STATE_BY_NAME } from "./states";

export interface EntityGeoKeys {
  place: string | null;
  zcta: string | null;
  state: string | null;
}

const EMPTY_KEYS: EntityGeoKeys = { place: null, zcta: null, state: null };

export interface EntityGeoChoice {
  geo_key: string;
  kind: CensusHit["kind"];
  label: string;
}

export type EntityGeoResolution =
  | { status: "resolved"; keys: EntityGeoKeys; label: string; marketSuggestion: GeoTarget | null }
  /** A real, usable result, but less specific than what was asked for —
   * e.g. a Findmi Area name Census can't yet map to a key, or a bare
   * state with no city given. Still safe to save (never a guess), just
   * flagged so a caller/picker can show "no exact match — using X". */
  | { status: "partial"; keys: EntityGeoKeys; label: string; marketSuggestion: GeoTarget | null }
  | { status: "ambiguous"; choices: EntityGeoChoice[] }
  | { status: "unresolved"; reason: string };

/** A Findmi Market/Area, with whatever name/alias text it's reachable by
 * and its own existing canonical mapping (product_geographies), if any —
 * supplied by the caller (lib/geo/entity-geo.ts), never fetched here. */
export interface FindmiAreaRef {
  marketSlug: string;
  marketName: string;
  areaSlug: string | null;
  areaName: string | null;
  /** Normalized (normalizeSearch) name/alias candidates this Market/Area
   * is reachable by — "soho", "manhattan", "brooklyn", etc. */
  names: string[];
  /** This Market/Area's own canonical Census key, from product_geographies
   * — null when the Geography admin page hasn't mapped one yet. */
  geo_key: string | null;
  geo_kind: CensusHit["kind"] | null;
}

const censusLabel = (h: Pick<CensusHit, "kind" | "display_name" | "state_usps">) =>
  h.kind === "state" || h.kind === "zcta" || !h.state_usps ? h.display_name : `${h.display_name}, ${h.state_usps}`;

function keysFor(hit: CensusHit): EntityGeoKeys {
  if (hit.kind === "place") return { place: hit.geo_key, zcta: null, state: null };
  if (hit.kind === "zcta") return { place: null, zcta: hit.geo_key, state: null };
  if (hit.kind === "state") return { place: null, zcta: null, state: hit.geo_key };
  // A County is never stored directly — see this file's own header. A
  // County-only resolution has no entity column to land in, so it's
  // reported as partial with no keys, carrying only a label/suggestion.
  return EMPTY_KEYS;
}

function marketSuggestionFor(keys: EntityGeoKeys, mappings: ProductMapping[]): GeoTarget | null {
  const key = keys.place ?? keys.zcta ?? keys.state;
  return key ? productTargetFor(key, mappings) : null;
}

/** Explicit picker selection — the caller already knows the geo_key (the
 * picker returned it); this only validates its kind/shape, never a text
 * match. The real existence check (does this row still exist in
 * census_geographies) happens server-side in entity-geo.ts before save —
 * this pure layer can't see the database. */
export function resolveExplicitKey(geoKey: string, hit: CensusHit | null, mappings: ProductMapping[]): EntityGeoResolution {
  if (!hit || hit.geo_key !== geoKey) return { status: "unresolved", reason: "That place could not be verified." };
  if (hit.kind === "county") {
    return { status: "partial", keys: EMPTY_KEYS, label: censusLabel(hit), marketSuggestion: marketSuggestionFor(EMPTY_KEYS, mappings) };
  }
  const keys = keysFor(hit);
  return { status: "resolved", keys, label: censusLabel(hit), marketSuggestion: marketSuggestionFor(keys, mappings) };
}

/** A 5-digit ZIP. */
export function resolveZipForEntity(zip: string, zcta: CensusHit | null, mappings: ProductMapping[]): EntityGeoResolution {
  if (!/^\d{5}$/.test(zip)) return { status: "unresolved", reason: "Enter a 5-digit ZIP code." };
  if (!zcta) return { status: "unresolved", reason: `${zip} isn't a recognized ZIP/ZCTA.` };
  const keys = keysFor(zcta);
  return { status: "resolved", keys, label: censusLabel(zcta), marketSuggestion: marketSuggestionFor(keys, mappings) };
}

/** State-only — USPS code or full name, no lookup needed (static list). */
export function resolveStateForEntity(stateText: string, mappings: ProductMapping[]): EntityGeoResolution {
  const trimmed = stateText.trim();
  const s = STATE_BY_USPS.get(trimmed.toUpperCase()) ?? STATE_BY_NAME.get(trimmed.toLowerCase());
  if (!s) return { status: "unresolved", reason: "That doesn't look like a U.S. state." };
  const keys: EntityGeoKeys = { place: null, zcta: null, state: `state:${s.fips}` };
  return { status: "partial", keys, label: s.name, marketSuggestion: marketSuggestionFor(keys, mappings) };
}

/** A Findmi Area/Market name or alias ("SoHo", "Manhattan", "Brooklyn").
 * Checked BEFORE a plain Census phrase match, so Findmi's own curated
 * names always win over whatever a generic Census Place search might
 * otherwise surface for the same text. */
export function resolveFindmiAlias(phrase: string, areas: FindmiAreaRef[]): EntityGeoResolution | null {
  const want = normalizeSearch(phrase);
  if (!want) return null;
  const match = areas.find((a) => a.names.includes(want));
  if (!match) return null;
  const label = match.areaName ? `${match.areaName}, ${match.marketName}` : match.marketName;
  const target: GeoTarget = { type: "findmi", market: match.marketSlug, area: match.areaSlug, label: match.areaName ?? match.marketName };
  if (!match.geo_key || !match.geo_kind) {
    // Findmi recognizes the name but has no canonical Census key mapped
    // for it yet (see /admin/site/geography) — real, usable, just not
    // backed by a canonical key. Never invented here.
    return { status: "partial", keys: EMPTY_KEYS, label, marketSuggestion: target };
  }
  const keys: EntityGeoKeys = match.geo_kind === "place" ? { place: match.geo_key, zcta: null, state: null } : match.geo_kind === "zcta" ? { place: null, zcta: match.geo_key, state: null } : match.geo_kind === "state" ? { place: null, zcta: null, state: match.geo_key } : EMPTY_KEYS;
  return { status: "resolved", keys, label, marketSuggestion: target };
}

/** City (+ optional state) phrase. `contextStateUsps` is a DIFFERENT,
 * deterministic signal (e.g. the business's own already-known state, or a
 * ZIP that already resolved) used ONLY to disambiguate a bare city name
 * that would otherwise be ambiguous — it never overrides an explicitly
 * typed state that conflicts with it. */
export function resolvePlaceForEntity(
  phrase: string,
  hits: CensusHit[],
  mappings: ProductMapping[],
  stateUsps?: string | null,
  contextStateUsps?: string | null
): EntityGeoResolution {
  const want = normalizeSearch(phrase);
  if (!want) return { status: "unresolved", reason: "Enter a city, ZIP, or place name." };

  let pool = hits.filter((h) => h.kind === "place" && (!h.search_names || h.search_names.includes(want)));
  const disambiguator = stateUsps ?? contextStateUsps ?? null;
  if (stateUsps) pool = pool.filter((h) => h.state_usps === stateUsps);

  if (pool.length === 0) return { status: "unresolved", reason: `No Census Place matches "${phrase}".` };

  if (pool.length > 1 && disambiguator) {
    const narrowed = pool.filter((h) => h.state_usps === disambiguator);
    if (narrowed.length > 0) pool = narrowed;
  }

  if (pool.length === 1) {
    const keys = keysFor(pool[0]);
    return { status: "resolved", keys, label: censusLabel(pool[0]), marketSuggestion: marketSuggestionFor(keys, mappings) };
  }

  // Still more than one real Census Place with this exact name and no
  // deterministic way to pick — never guess.
  const ordered = [...pool].sort((a, b) => (b.aland_m2 ?? 0) - (a.aland_m2 ?? 0) || censusLabel(a).localeCompare(censusLabel(b)));
  const choices: EntityGeoChoice[] = ordered.slice(0, 8).map((h) => ({ geo_key: h.geo_key, kind: h.kind, label: censusLabel(h) }));
  return { status: "ambiguous", choices };
}

// ---------------------------------------------------------------- discovery-time query scope

/** A resolved discovery query, expanded to every geo_place_key/
 * geo_zcta_key/geo_state_key value an entity could carry to be "in" it.
 * For a Place/ZCTA/State query this is just that one key in the matching
 * bucket; for a County query (never stored on an entity) it's every Place
 * and ZCTA linked to that county — see canonical-scope.ts's
 * resolveCanonicalGeoScope, the only thing that builds one of these. */
export interface CanonicalGeoScope {
  placeKeys: string[];
  zctaKeys: string[];
  stateKeys: string[];
}

export const EMPTY_CANONICAL_GEO_SCOPE: CanonicalGeoScope = { placeKeys: [], zctaKeys: [], stateKeys: [] };

export function isCanonicalGeoScopeEmpty(scope: CanonicalGeoScope | null | undefined): boolean {
  return !scope || (scope.placeKeys.length === 0 && scope.zctaKeys.length === 0 && scope.stateKeys.length === 0);
}

/** A PostgREST `.or(...)` filter string matching any entity whose own
 * geo_place_key/geo_zcta_key/geo_state_key falls in the scope — applied
 * directly against the real indexed columns, BEFORE any `.limit()`, so
 * geography narrows the candidate set at the database rather than being
 * filtered in memory after a bounded, unscoped fetch. `hasZcta` excludes
 * the zcta bucket for tables that have no geo_zcta_key column
 * (appearances). Returns null when the scope has nothing to filter by —
 * callers skip applying any geo filter in that case, never match-nothing. */
export function geoScopeOrFilter(scope: CanonicalGeoScope, opts: { hasZcta?: boolean } = {}): string | null {
  const hasZcta = opts.hasZcta ?? true;
  const clauses: string[] = [];
  if (scope.placeKeys.length) clauses.push(`geo_place_key.in.(${scope.placeKeys.join(",")})`);
  if (hasZcta && scope.zctaKeys.length) clauses.push(`geo_zcta_key.in.(${scope.zctaKeys.join(",")})`);
  if (scope.stateKeys.length) clauses.push(`geo_state_key.in.(${scope.stateKeys.join(",")})`);
  return clauses.length ? clauses.join(",") : null;
}
