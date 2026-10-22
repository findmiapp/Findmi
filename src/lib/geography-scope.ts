import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Geography Scope — the ONE server helper every Block B lens uses to answer
 * "which places are in this geography?".
 *
 * A scope is either a Findmi Market (North Jersey) or an Area plus every
 * descendant Area (Jersey City + Downtown, The Heights, …). A Location is in a
 * scope by its own canonical geography (locations.market_id / market_area_id);
 * nothing is guessed from city text.
 *
 * User-facing language stays simple: an Area scope is labeled by the Area
 * ("Jersey City"), with its Market only as quiet context ("North Jersey").
 *
 * Seam for the Map: scopeLocationFilter() is the single place a query is
 * narrowed to a geography. A future bounding-box scope is one more `kind`
 * handled there — callers don't change. */

export interface ScopeMarket {
  id: string;
  name: string;
  slug: string;
}

export interface ScopeArea {
  id: string;
  name: string;
  slug: string;
}

export type GeographyScope =
  | { kind: "market"; market: ScopeMarket; area: null; areaIds: null; label: string; context: null; key: string }
  | { kind: "area"; market: ScopeMarket; area: ScopeArea; areaIds: string[]; label: string; context: string; key: string };

type AreaRow = { id: string; name: string; display_name: string | null; slug: string; market_id: string; parent_area_id: string | null };

/** The Area plus every descendant (any depth), from one Market's Areas. */
export function areaWithDescendants(areaId: string, areas: readonly Pick<AreaRow, "id" | "parent_area_id">[]): string[] {
  const out = [areaId];
  const seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const a of areas) {
      if (a.parent_area_id === out[i] && !seen.has(a.id)) {
        seen.add(a.id);
        out.push(a.id);
      }
    }
  }
  return out;
}

/** The URL identity of a scope: `fm=<market slug>` and optionally `fa=<area slug>`. */
export function scopeKey(marketSlug: string, areaSlug?: string | null): string {
  return areaSlug ? `${marketSlug}/${areaSlug}` : marketSlug;
}

export const cleanSlug = (v: unknown): string => (typeof v === "string" ? v.replace(/[^a-z0-9-]/gi, "").slice(0, 60).toLowerCase() : "");

/** Resolve `fm` / `fa` (slugs) to a scope, or null when either doesn't exist. */
export async function resolveGeographyScope(admin: SupabaseClient, marketSlug: string, areaSlug?: string | null): Promise<GeographyScope | null> {
  const ms = cleanSlug(marketSlug);
  if (!ms) return null;
  const { data: market } = await admin.from("markets").select("id, name, slug").eq("slug", ms).eq("active", true).maybeSingle();
  const m = market as ScopeMarket | null;
  if (!m) return null;
  const as = cleanSlug(areaSlug);
  if (!as) return { kind: "market", market: m, area: null, areaIds: null, label: m.name, context: null, key: scopeKey(m.slug) };
  const { data: areaRows } = await admin.from("market_areas").select("id, name, display_name, slug, market_id, parent_area_id").eq("market_id", m.id).eq("active", true);
  const areas = (areaRows ?? []) as AreaRow[];
  const area = areas.find((a) => a.slug === as);
  if (!area) return null;
  return {
    kind: "area",
    market: m,
    area: { id: area.id, name: area.display_name?.trim() || area.name, slug: area.slug },
    areaIds: areaWithDescendants(area.id, areas),
    label: area.display_name?.trim() || area.name,
    context: m.name,
    key: scopeKey(m.slug, area.slug),
  };
}

/** Narrows a query to the scope. `prefix` addresses an embedded Location
 * (e.g. "locations." for a `locations!inner(...)` embed); empty for a query on
 * `locations` itself. */
export function scopeLocationFilter<Q extends { eq: (c: string, v: string) => Q; in: (c: string, v: readonly string[]) => Q }>(query: Q, scope: GeographyScope, prefix = ""): Q {
  return scope.kind === "market" ? query.eq(`${prefix}market_id`, scope.market.id) : query.in(`${prefix}market_area_id`, scope.areaIds);
}

/** The same rule in memory, for rows already read (one bounded read, many scopes). */
export function locationInScope(loc: { market_id: string | null; market_area_id: string | null }, scope: GeographyScope): boolean {
  return scope.kind === "market" ? loc.market_id === scope.market.id : Boolean(loc.market_area_id && scope.areaIds.includes(loc.market_area_id));
}

/** All active Markets and Areas, read once — for building many scopes in memory
 * (the By Market overview). */
export async function readGeographyCatalog(admin: SupabaseClient): Promise<{ markets: (ScopeMarket & { sort_order: number })[]; areas: AreaRow[] }> {
  const [m, a] = await Promise.all([
    admin.from("markets").select("id, name, slug, sort_order").eq("active", true).order("sort_order"),
    admin.from("market_areas").select("id, name, display_name, slug, market_id, parent_area_id").eq("active", true),
  ]);
  return { markets: ((m.data ?? []) as (ScopeMarket & { sort_order: number })[]), areas: (a.data ?? []) as AreaRow[] };
}

/** A scope built from the catalog (no extra reads). */
export function scopeFromCatalog(catalog: { markets: ScopeMarket[]; areas: AreaRow[] }, marketId: string, areaId?: string | null): GeographyScope | null {
  const m = catalog.markets.find((x) => x.id === marketId);
  if (!m) return null;
  const market = { id: m.id, name: m.name, slug: m.slug };
  if (!areaId) return { kind: "market", market, area: null, areaIds: null, label: m.name, context: null, key: scopeKey(m.slug) };
  const a = catalog.areas.find((x) => x.id === areaId && x.market_id === marketId);
  if (!a) return null;
  const label = a.display_name?.trim() || a.name;
  return { kind: "area", market, area: { id: a.id, name: label, slug: a.slug }, areaIds: areaWithDescendants(a.id, catalog.areas.filter((x) => x.market_id === marketId)), label, context: m.name, key: scopeKey(m.slug, a.slug) };
}
