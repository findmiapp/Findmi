import "server-only";
import { getSupabase } from "@/lib/supabase";
import { normalizeSearch } from "@/lib/geo/census-format";
import { STATE_BY_USPS, STATE_BY_NAME } from "@/lib/geo/states";
import {
  resolveExplicitKey,
  resolveZipForEntity,
  resolveStateForEntity,
  resolveFindmiAlias,
  resolvePlaceForEntity,
  type EntityGeoResolution,
  type FindmiAreaRef,
} from "@/lib/geo/entity-geo-core";
import { getProductMappings } from "@/lib/geo/resolve";
import type { CensusHit, ProductMapping } from "@/lib/geo/resolve-core";

// Canonical Entity Geography — the server half: reads census_geographies/
// census_geography_links/product_geographies/markets/market_areas (the
// anon client, same public RLS every other public read already uses) and
// hands real rows to the pure decision layer (entity-geo-core.ts). Every
// read tolerates the tables not existing yet — the answer is then simply
// "unresolved", never an error, same tolerance resolve.ts already has.
//
// Deliberately reuses resolve.ts's getProductMappings and resolve-core's
// types rather than re-querying/re-typing product_geographies a second
// way — see this pass's own audit note on why a second resolution system
// was avoided.

const GEO_COLS = "geo_key, kind, name, display_name, state_usps, aland_m2, search_names";

export interface EntityGeoInput {
  /** An already-chosen canonical key (the picker's own return value) —
   * wins over every other field when present. */
  explicitKey?: string | null;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  /** A different, deterministic signal used only to disambiguate a bare
   * city with no state typed — e.g. the business's own already-known
   * state. Never overrides an explicitly typed, conflicting state. */
  contextStateUsps?: string | null;
}

async function lookupPlaceOrCountyHits(phrase: string): Promise<CensusHit[]> {
  const supabase = getSupabase();
  const want = normalizeSearch(phrase);
  if (!supabase || !want) return [];
  const { data, error } = await supabase
    .from("census_geographies")
    .select(GEO_COLS)
    .eq("kind", "place")
    .is("retired_vintage", null)
    .contains("search_names", [want])
    .limit(50);
  return error ? [] : ((data ?? []) as CensusHit[]);
}

async function lookupZcta(zip: string): Promise<CensusHit | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("census_geographies").select(GEO_COLS).eq("geo_key", `zcta:${zip}`).is("retired_vintage", null).maybeSingle();
  return (data as CensusHit | null) ?? null;
}

async function lookupByKey(geoKey: string): Promise<CensusHit | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("census_geographies").select(GEO_COLS).eq("geo_key", geoKey).is("retired_vintage", null).maybeSingle();
  return (data as CensusHit | null) ?? null;
}

/** Display label for an already-saved canonical key (edit forms showing
 * what was chosen before, or the backfill runner's own reports) — never
 * guesses, returns null when the key no longer resolves (retired, bad
 * data). A plain lookup, not a resolution: unlike resolveEntityGeography,
 * this never falls back to anything. */
export async function labelForGeoKey(geoKey: string): Promise<string | null> {
  const hit = await lookupByKey(geoKey);
  if (!hit) return null;
  return hit.kind === "state" || hit.kind === "zcta" || !hit.state_usps ? hit.display_name : `${hit.display_name}, ${hit.state_usps}`;
}

/** Findmi's own curated Market/Area names/aliases, each carrying its own
 * canonical mapping (product_geographies) if the Geography admin page has
 * assigned one — the "SoHo"/"Manhattan"/"Brooklyn" alias case. Small,
 * bounded (markets + areas are a curated product, never thousands of
 * rows), read in full rather than filtered server-side by phrase. */
export async function getFindmiAreaRefs(): Promise<FindmiAreaRef[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const [{ data: markets }, { data: areas }, mappings] = await Promise.all([
    supabase.from("markets").select("id, slug, name, display_name").eq("active", true),
    supabase.from("market_areas").select("id, slug, name, display_name, market_id, aliases").eq("active", true),
    getProductMappings(),
  ]);
  type MarketRow = { id: string; slug: string; name: string; display_name: string | null };
  type AreaRow = { id: string; slug: string; name: string; display_name: string | null; market_id: string; aliases: string[] | null };
  const marketRows = (markets ?? []) as MarketRow[];
  const areaRows = (areas ?? []) as AreaRow[];
  const marketById = new Map(marketRows.map((m) => [m.id, m]));
  const mappingFor = (geoKeyOwner: { market_slug: string; area_slug: string | null }) =>
    mappings.find((m) => m.market_slug === geoKeyOwner.market_slug && m.area_slug === geoKeyOwner.area_slug && m.role === "primary") ??
    mappings.find((m) => m.market_slug === geoKeyOwner.market_slug && m.area_slug === geoKeyOwner.area_slug);

  const refs: FindmiAreaRef[] = [];
  for (const area of areaRows) {
    const market = marketById.get(area.market_id);
    if (!market) continue;
    const areaName = area.display_name?.trim() || area.name;
    const names = [...new Set([area.name, area.display_name ?? "", area.slug, ...(area.aliases ?? [])].filter(Boolean).map(normalizeSearch))];
    const mapping = mappingFor({ market_slug: market.slug, area_slug: area.slug });
    refs.push({
      marketSlug: market.slug,
      marketName: market.display_name?.trim() || market.name,
      areaSlug: area.slug,
      areaName,
      names,
      geo_key: mapping?.geo_key ?? null,
      geo_kind: mapping ? keyKind(mapping.geo_key) : null,
    });
  }
  for (const market of marketRows) {
    const names = [...new Set([market.name, market.display_name ?? "", market.slug].filter(Boolean).map(normalizeSearch))];
    const mapping = mappings.find((m) => m.market_slug === market.slug && !m.area_slug);
    refs.push({
      marketSlug: market.slug,
      marketName: market.display_name?.trim() || market.name,
      areaSlug: null,
      areaName: null,
      names,
      geo_key: mapping?.geo_key ?? null,
      geo_kind: mapping ? keyKind(mapping.geo_key) : null,
    });
  }
  return refs;
}

function keyKind(key: string): CensusHit["kind"] {
  const kind = key.split(":")[0];
  return (kind === "place" || kind === "county" || kind === "state" || kind === "zcta" ? kind : "place") as CensusHit["kind"];
}

/** The one entry point every create/edit path should call: given whatever
 * geography the member actually provided, resolves it to a canonical
 * entity-geo result. Order of precedence: explicit key > ZIP > Findmi
 * alias > city/state phrase > state-only. Never queries anything it
 * doesn't need (an explicit key skips every other lookup). */
export async function resolveEntityGeography(input: EntityGeoInput): Promise<EntityGeoResolution> {
  const mappings = await getProductMappings();

  if (input.explicitKey) {
    const hit = await lookupByKey(input.explicitKey);
    return resolveExplicitKey(input.explicitKey, hit, mappings);
  }

  const zip = input.zip?.trim();
  if (zip && /^\d{5}$/.test(zip)) {
    const zcta = await lookupZcta(zip);
    return resolveZipForEntity(zip, zcta, mappings);
  }

  const city = input.city?.trim();
  const stateRaw = input.state?.trim();
  const stateUsps = stateRaw ? (STATE_BY_USPS.get(stateRaw.toUpperCase())?.usps ?? STATE_BY_NAME.get(stateRaw.toLowerCase())?.usps ?? null) : null;

  if (city) {
    const areas = await getFindmiAreaRefs();
    const alias = resolveFindmiAlias(city, areas);
    if (alias) return alias;

    const hits = await lookupPlaceOrCountyHits(city);
    return resolvePlaceForEntity(city, hits, mappings, stateUsps, input.contextStateUsps ?? null);
  }

  if (stateRaw) return resolveStateForEntity(stateRaw, mappings);

  return { status: "unresolved", reason: "No geography provided." };
}

export type { EntityGeoResolution };
export type { EntityGeoKeys, EntityGeoChoice } from "@/lib/geo/entity-geo-core";
export type { ProductMapping };
