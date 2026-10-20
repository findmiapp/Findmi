// Site geographic scope — enforcement for a site locked to one Market/Area
// (see lib/site.ts). Findmi (scope: null) passes everything through
// unchanged.
//
// Listing pages confine their discovery params with scopeGeoParams();
// detail pages confirm an entity belongs to the site with
// assertEntityInSiteScope(), sending anything outside it to the same page
// on Findmi. Membership uses Findmi's own geography: the curated Area (and
// its child neighborhood Areas, getAreaScopeIds) or the canonical Census
// place — never free-text city matching.

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getAreaScopeIds } from "./data";
import { getSite } from "./site";
import { getSupabase } from "./supabase";

interface ResolvedSiteScope {
  marketId: string | null;
  /** The site Area plus its active child Areas. */
  areaIds: Set<string>;
  /** Slugs a visitor may narrow to (the site Area and its children). */
  areaSlugs: Set<string>;
  geoPlaceKey: string;
}

export const getResolvedSiteScope = cache(async (): Promise<ResolvedSiteScope | null> => {
  const scope = getSite().scope;
  if (!scope) return null;
  const empty: ResolvedSiteScope = { marketId: null, areaIds: new Set(), areaSlugs: new Set([scope.area]), geoPlaceKey: scope.geoPlaceKey };
  const supabase = getSupabase();
  if (!supabase) return empty;
  const { data: market } = await supabase.from("markets").select("id").eq("slug", scope.market).eq("active", true).maybeSingle();
  if (!market) return empty;
  const { data: area } = await supabase.from("market_areas").select("id").eq("market_id", market.id).eq("slug", scope.area).eq("active", true).maybeSingle();
  if (!area) return { ...empty, marketId: market.id };
  const ids = await getAreaScopeIds(supabase, area.id);
  const { data: children } = await supabase.from("market_areas").select("slug").eq("parent_area_id", area.id).eq("active", true);
  return {
    marketId: market.id,
    areaIds: new Set(ids),
    areaSlugs: new Set([scope.area, ...((children ?? []) as { slug: string }[]).map((c) => c.slug)]),
    geoPlaceKey: scope.geoPlaceKey,
  };
});

type GeoParams = { market?: string | string[]; area?: string | string[]; geo?: string | string[] };

/** A listing page's search params, confined to the site scope: market is
 * always the site Market, area is the site Area or one of its child
 * neighborhoods (anything else falls back to the site Area), and the
 * canonical `geo` override is dropped. Findmi: returned unchanged. */
export async function scopeGeoParams<T extends GeoParams>(params: T): Promise<T> {
  const scope = getSite().scope;
  if (!scope) return params;
  const resolved = await getResolvedSiteScope();
  const requested = typeof params.area === "string" ? params.area : undefined;
  const area = requested && resolved?.areaSlugs.has(requested) ? requested : scope.area;
  const rest: GeoParams = { ...params };
  delete rest.geo;
  return { ...rest, market: scope.market, area } as T;
}

/** A discovery query (lib/discovery) confined to the site scope, the same
 * way scopeGeoParams confines page params: market forced, area limited to
 * the site Area or its neighborhoods, census geography dropped. Callers
 * also ignore any free-text place a search phrase named. Findmi: as-is. */
export async function scopeDiscoveryQuery<Q extends { market?: string; area?: string; census?: string }>(query: Q): Promise<Q> {
  const scope = getSite().scope;
  if (!scope) return query;
  const resolved = await getResolvedSiteScope();
  const area = query.area && resolved?.areaSlugs.has(query.area) ? query.area : scope.area;
  return { ...query, market: scope.market, area, census: undefined };
}

type EntityGeo = { market_area_id?: string | null; geo_place_key?: string | null };

function geoInScope(s: ResolvedSiteScope, row: EntityGeo | null | undefined): boolean {
  if (!row) return false;
  return (!!row.market_area_id && s.areaIds.has(row.market_area_id)) || row.geo_place_key === s.geoPlaceKey;
}

async function entityInScope(kind: "event" | "location" | "business", id: string, row: EntityGeo): Promise<boolean> {
  const s = await getResolvedSiteScope();
  if (!s) return true;
  if (geoInScope(s, row)) return true;
  const supabase = getSupabase();
  if (!supabase) return false;
  if (kind === "event") {
    // Any of the Event's dates at an in-scope place (or itself in scope).
    const { data } = await supabase.from("event_occurrences").select("market_id, geo_place_key, location:locations(market_area_id, geo_place_key)").eq("event_id", id);
    return ((data ?? []) as { geo_place_key: string | null; location: EntityGeo | EntityGeo[] | null }[]).some((o) => {
      const loc = Array.isArray(o.location) ? o.location[0] : o.location;
      return o.geo_place_key === s.geoPlaceKey || geoInScope(s, loc);
    });
  }
  if (kind === "business") {
    const ids = [...s.areaIds];
    if (ids.length === 0) return false;
    const { data } = await supabase.from("business_market_areas").select("business_id").eq("business_id", id).in("market_area_id", ids).limit(1);
    return (data ?? []).length > 0;
  }
  return false;
}

/** Detail pages: on a scoped site, an entity outside the scope is shown
 * on Findmi instead (same path). No-op on Findmi. */
export async function assertEntityInSiteScope(kind: "event" | "location" | "business", entity: { id: string } & EntityGeo, path: string): Promise<void> {
  const site = getSite();
  if (!site.scope) return;
  if (await entityInScope(kind, entity.id, entity)) return;
  redirect(`${site.accountsOrigin ?? "https://findmi.app"}${path}`);
}

/** The discovery_pages row whose homepage rows/lanes this site renders:
 * the site's own page when it exists and is published, else the system
 * (Findmi Home) page — still confined to the site scope by every caller.
 * Findmi: always the system page, exactly as before. */
export const getSiteDiscoveryPageId = cache(async (): Promise<string | null> => {
  const supabase = getSupabase();
  if (!supabase) return null;
  const slug = getSite().discoveryPageSlug;
  if (slug) {
    const { data: own } = await supabase.from("discovery_pages").select("id").eq("slug", slug).eq("is_published", true).limit(1).maybeSingle();
    if (own) return own.id as string;
  }
  const { data: system } = await supabase.from("discovery_pages").select("id").eq("is_system", true).limit(1).maybeSingle();
  return (system?.id as string | undefined) ?? null;
});
