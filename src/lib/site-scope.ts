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
import { getAreaScopeIds, getBusinessIdsInArea } from "./data";
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
    // The same brand-to-Area rule the site's Brands listing uses.
    const scope = getSite().scope!;
    return (await getBusinessIdsInArea(scope.market, scope.area)).includes(id);
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

// ── Places / Events / Moments in the site scope ──────────────────────────
// Derived only from structured relationships (an Area id or the canonical
// Census place on the row, a Location, an Event, an Event date) — never
// from free-text city/venue text. Null on Findmi (no scope).

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];

/** Locations in the site's Area/neighborhoods or its canonical place. */
export const getSiteScopeLocationIds = cache(async (): Promise<string[] | null> => {
  const s = await getResolvedSiteScope();
  if (!s) return null;
  const supabase = getSupabase();
  if (!supabase) return [];
  const areaIds = [...s.areaIds];
  const filter = [areaIds.length ? `market_area_id.in.(${areaIds.join(",")})` : null, `geo_place_key.eq.${s.geoPlaceKey}`].filter(Boolean).join(",");
  const { data } = await supabase.from("locations").select("id").or(filter);
  return uniq(((data ?? []) as { id: string }[]).map((r) => r.id));
});

/** Events in the site scope: the Event's own Area/place, or any of its
 * dates at an in-scope Location (or with the canonical place itself). */
export const getSiteScopeEventIds = cache(async (): Promise<string[] | null> => {
  const s = await getResolvedSiteScope();
  if (!s) return null;
  const supabase = getSupabase();
  if (!supabase) return [];
  const areaIds = [...s.areaIds];
  const locIds = (await getSiteScopeLocationIds()) ?? [];
  const evFilter = [areaIds.length ? `market_area_id.in.(${areaIds.join(",")})` : null, `geo_place_key.eq.${s.geoPlaceKey}`].filter(Boolean).join(",");
  const occFilter = [locIds.length ? `location_id.in.(${locIds.join(",")})` : null, `geo_place_key.eq.${s.geoPlaceKey}`].filter(Boolean).join(",");
  const [{ data: own }, { data: occ }] = await Promise.all([
    supabase.from("events").select("id").or(evFilter),
    supabase.from("event_occurrences").select("event_id").or(occFilter),
  ]);
  return uniq([...((own ?? []) as { id: string }[]).map((r) => r.id), ...((occ ?? []) as { event_id: string }[]).map((r) => r.event_id)]);
});

/** Public Moments that belong to the site: taken at an in-scope Location,
 * or connected to an in-scope Event / Event date. A Moment's Business
 * connection alone says WHO, not WHERE, so it never qualifies a Moment.
 * The same shared Moment rows Findmi shows — nothing is copied; RLS
 * still returns only public, published Moments. */
export const getSiteMomentIds = cache(async (): Promise<string[] | null> => {
  const s = await getResolvedSiteScope();
  if (!s) return null;
  const supabase = getSupabase();
  if (!supabase) return [];
  const [locIds, eventIds] = await Promise.all([getSiteScopeLocationIds(), getSiteScopeEventIds()]);
  const ev = eventIds ?? [];
  const { data: occ } = ev.length ? await supabase.from("event_occurrences").select("id").in("event_id", ev) : { data: [] };
  const occIds = ((occ ?? []) as { id: string }[]).map((o) => o.id);
  const connFilter = [ev.length ? `event_id.in.(${ev.join(",")})` : null, occIds.length ? `event_occurrence_id.in.(${occIds.join(",")})` : null].filter(Boolean).join(",");
  const [{ data: atPlace }, { data: conns }] = await Promise.all([
    locIds?.length
      ? supabase.from("journal_entries").select("id").eq("visibility", "public").eq("status", "published").in("location_id", locIds)
      : Promise.resolve({ data: [] }),
    connFilter ? supabase.from("journal_entry_connections").select("journal_entry_id").or(connFilter) : Promise.resolve({ data: [] }),
  ]);
  return uniq([
    ...((atPlace ?? []) as { id: string }[]).map((r) => r.id),
    ...((conns ?? []) as { journal_entry_id: string }[]).map((r) => r.journal_entry_id),
  ]);
});

/** Moment pages: on a scoped site, a Moment outside it opens on Findmi. */
export async function assertMomentInSiteScope(id: string): Promise<void> {
  const site = getSite();
  if (!site.scope) return;
  const ids = await getSiteMomentIds();
  if (ids?.includes(id)) return;
  redirect(`${site.accountsOrigin ?? "https://findmi.app"}/journal/${id}`);
}
