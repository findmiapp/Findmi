import "server-only";
import { getSupabase } from "@/lib/supabase";
import { normalizeSearch } from "@/lib/geo/census-format";
import { STATE_BY_USPS } from "@/lib/geo/states";
import { resolvePlacePhrase, resolveZip, scopeForCensus, type CensusHit, type GeoResolution, type GeoTarget, type ProductMapping } from "@/lib/geo/resolve-core";
import type { GeoScope } from "@/lib/discovery/engine";

// Canonical geography resolution — the server half: reads the public
// Census reference tables + Findmi product mappings (anon client, public
// RLS) and hands them to the pure decision layer (resolve-core.ts). Every
// read tolerates the tables not existing yet (pre-migration / pre-import):
// the answer is then simply "none", never an error.

const GEO_COLS = "geo_key, kind, name, display_name, state_usps, aland_m2, search_names";

export async function getProductMappings(): Promise<ProductMapping[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("product_geographies")
    .select("geo_key, role, market:markets(slug, name, active), area:market_areas(slug, name, active)");
  if (error || !data) return [];
  type One<T> = T | T[] | null;
  const one = <T,>(v: One<T>) => (Array.isArray(v) ? (v[0] ?? null) : v);
  return (data as { geo_key: string; role: ProductMapping["role"]; market: One<{ slug: string; name: string; active: boolean }>; area: One<{ slug: string; name: string; active: boolean }> }[])
    .map((r) => ({ r, m: one(r.market), a: one(r.area) }))
    .filter(({ m, a }) => m?.active && (a === null || a.active))
    .map(({ r, m, a }) => ({ geo_key: r.geo_key, role: r.role, market_slug: m!.slug, market_name: m!.name, area_slug: a?.slug ?? null, area_name: a?.name ?? null }));
}

export async function lookupPlaceHits(phrase: string): Promise<CensusHit[]> {
  const supabase = getSupabase();
  const want = normalizeSearch(phrase);
  if (!supabase || !want) return [];
  const { data, error } = await supabase
    .from("census_geographies")
    .select(GEO_COLS)
    .in("kind", ["place", "county"])
    .is("retired_vintage", null)
    .contains("search_names", [want])
    .limit(50);
  return error ? [] : ((data ?? []) as CensusHit[]);
}

export async function resolveZipCode(zip: string, mappings: ProductMapping[]): Promise<GeoResolution> {
  const supabase = getSupabase();
  if (!supabase) return { status: "none" };
  const key = `zcta:${zip}`;
  const [{ data: z }, { data: links }] = await Promise.all([
    supabase.from("census_geographies").select(GEO_COLS).eq("geo_key", key).is("retired_vintage", null).maybeSingle(),
    supabase.from("census_geography_links").select("parent_key, land_share").eq("child_key", key).eq("relation", "zcta_in_county"),
  ]);
  return resolveZip(zip, (z as CensusHit | null) ?? null, ((links ?? []) as { parent_key: string; land_share: number | null }[]).map((l) => ({ county_key: l.parent_key, land_share: l.land_share })), mappings);
}

/** A state name/USPS needs no lookup: the reference is static (states.ts),
 * but a Findmi product mapping on the state still wins. */
export function resolveState(usps: string, mappings: ProductMapping[]): GeoResolution {
  const s = STATE_BY_USPS.get(usps);
  if (!s) return { status: "none" };
  const key = `state:${s.fips}`;
  const m = mappings.find((x) => x.geo_key === key && x.role === "primary");
  if (m) return { status: "resolved", target: { type: "findmi", market: m.market_slug, area: m.area_slug, label: m.area_name ?? m.market_name }, via: "findmi" };
  return { status: "resolved", target: { type: "census", geo_key: key, kind: "state", label: s.name, name: s.name, usps: s.usps }, via: "static" };
}

export async function resolvePhrase(phrase: string, mappings: ProductMapping[], stateUsps?: string | null): Promise<GeoResolution> {
  return resolvePlacePhrase(phrase, await lookupPlaceHits(phrase), mappings, stateUsps);
}

/** A resolved Census target → the executor's in-memory predicate. A County
 * expands to its linked Places and ZCTAs (never coordinates). */
export async function geoScopeFor(target: Extract<GeoTarget, { type: "census" }>): Promise<GeoScope> {
  if (target.kind !== "county") return scopeForCensus(target);
  const supabase = getSupabase();
  if (!supabase) return scopeForCensus(target);
  const { data: links } = await supabase.from("census_geography_links").select("child_key, relation").eq("parent_key", target.geo_key).in("relation", ["place_in_county", "zcta_in_county"]).limit(2000);
  const rows = (links ?? []) as { child_key: string; relation: string }[];
  const placeKeys = rows.filter((r) => r.relation === "place_in_county").map((r) => r.child_key);
  const zips = rows.filter((r) => r.relation === "zcta_in_county").map((r) => r.child_key.split(":")[1]);
  let places: { display_name: string; state_usps: string | null; search_names?: string[] }[] = [];
  if (placeKeys.length) {
    const { data } = await supabase.from("census_geographies").select("display_name, state_usps, search_names").in("geo_key", placeKeys.slice(0, 1000));
    places = (data ?? []) as typeof places;
  }
  return scopeForCensus(target, { places, zips });
}

/** Census target by key (search URLs carry `geo=place:4752006`). */
export async function censusTargetByKey(key: string): Promise<Extract<GeoTarget, { type: "census" }> | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("census_geographies").select(GEO_COLS).eq("geo_key", key).maybeSingle();
  const h = data as CensusHit | null;
  if (!h) {
    const [kind, id] = key.split(":");
    if (kind === "state") {
      const s = [...STATE_BY_USPS.values()].find((x) => x.fips === id);
      if (s) return { type: "census", geo_key: key, kind: "state", label: s.name, name: s.name, usps: s.usps };
    }
    return null;
  }
  return { type: "census", geo_key: h.geo_key, kind: h.kind, label: h.kind === "state" || h.kind === "zcta" || !h.state_usps ? h.display_name : `${h.display_name}, ${h.state_usps}`, name: h.display_name, names: h.search_names, usps: h.state_usps };
}
