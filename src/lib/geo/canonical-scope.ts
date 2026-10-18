import "server-only";
import { getSupabase } from "@/lib/supabase";
import { EMPTY_CANONICAL_GEO_SCOPE, type CanonicalGeoScope } from "@/lib/geo/entity-geo-core";

// Canonical Entity Geography — COMPLETION pass. The server half of the
// discovery-time query scope: given any canonical geo_key a visitor (or a
// search phrase) resolved to — a Place, a ZCTA, a State, or a County —
// expands it to the exact set of geo_place_key/geo_zcta_key/geo_state_key
// values a real entity row could carry to be considered "in" it.
//
// Place/ZCTA/State need no lookup at all — the key itself is already the
// one value to match. A County is the one real expansion: it is NEVER
// stored directly on an entity (a Place can span counties — see
// entity-geo-core.ts's own header), so "in this county" means "its own
// geo_place_key or geo_zcta_key is one of the Places/ZCTAs
// census_geography_links says belongs to it" — every member, never one
// arbitrarily chosen, and a Place linked to more than one county (it
// spans a county line) is correctly returned for EITHER county's query,
// never collapsed to just one.
//
// Reuses census_geography_links exactly the way lib/geo/resolve.ts's own
// geoScopeFor already reads it for the (unrelated, text-based) discovery
// GeoScope — same table, same relation kinds, same bounded limit — just
// bucketed by geo_key instead of by city-text, because this scope filters
// the real geo_* columns at the database rather than an item's own stored
// city/state text in memory.

const LINK_LIMIT = 2000;

export async function resolveCanonicalGeoScope(geoKey: string): Promise<CanonicalGeoScope | null> {
  const kind = geoKey.split(":")[0];
  if (kind === "place") return { placeKeys: [geoKey], zctaKeys: [], stateKeys: [] };
  if (kind === "zcta") return { placeKeys: [], zctaKeys: [geoKey], stateKeys: [] };
  if (kind === "state") return { placeKeys: [], zctaKeys: [], stateKeys: [geoKey] };
  if (kind !== "county") return null;

  const supabase = getSupabase();
  if (!supabase) return EMPTY_CANONICAL_GEO_SCOPE;
  const { data: links } = await supabase
    .from("census_geography_links")
    .select("child_key, relation")
    .eq("parent_key", geoKey)
    .in("relation", ["place_in_county", "zcta_in_county"])
    .limit(LINK_LIMIT);
  const rows = (links ?? []) as { child_key: string; relation: string }[];
  return {
    placeKeys: rows.filter((r) => r.relation === "place_in_county").map((r) => r.child_key),
    zctaKeys: rows.filter((r) => r.relation === "zcta_in_county").map((r) => r.child_key),
    stateKeys: [],
  };
}
