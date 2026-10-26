import "server-only";
import type { BusinessSort, EventDiscoveryParams, FindWindow, LocationsDiscoveryOptions, SearchBusinessesParams } from "@/lib/data";
import { eventDiscoveryParams, parseEventFilter, type EventFilter } from "@/lib/event-filter";
import { resolveCanonicalGeoScope } from "@/lib/geo/canonical-scope";
import { isCanonicalGeoScopeEmpty } from "@/lib/geo/entity-geo-core";
import { parseBboxParam, parseViewParam, resolveView, type ViewMode } from "@/lib/geo-results";
import type { Bbox } from "@/lib/discovery/map-core";

// Map Everywhere — ONE reading of each archive's URL, shared by the
// archive page (List) and its geo endpoint (Map / Split), so switching
// presentation can never re-interpret the query.

export type ArchiveParams = Record<string, string | string[] | undefined>;
const one = (p: ArchiveParams, k: string) => {
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

/** The view the URL explicitly asks for (null = a fresh visit). */
export const archiveViewParam = (p: ArchiveParams): ViewMode | null => parseViewParam(p.view);
/** The view to render (lib/geo-results resolveView precedence). */
export const archiveView = (p: ArchiveParams, allowSplit = true): ViewMode => resolveView(archiveViewParam(p), allowSplit);
export const archiveBbox = (p: ArchiveParams): Bbox | null => parseBboxParam(p.bbox);

/** /events */
export async function eventArchive(p: ArchiveParams, page: { limit?: number; offset?: number } = {}): Promise<{ filter: EventFilter; discovery: EventDiscoveryParams }> {
  const filter = parseEventFilter(p);
  const geo = one(p, "geo");
  const canonicalGeo = geo ? await resolveCanonicalGeoScope(geo) : null;
  return { filter, discovery: { ...eventDiscoveryParams(filter, { ...page, featuredFirst: true }), canonicalGeo } };
}

/** /locations */
export async function placeArchive(p: ArchiveParams): Promise<LocationsDiscoveryOptions> {
  const market = one(p, "market");
  const geo = one(p, "geo");
  return {
    q: one(p, "q"),
    categorySlug: one(p, "category"),
    marketSlug: market,
    areaSlug: market ? one(p, "area") : undefined,
    canonicalGeo: geo ? await resolveCanonicalGeoScope(geo) : null,
    bbox: archiveBbox(p),
  };
}

export const BUSINESS_SORTS: BusinessSort[] = ["recommended", "newest", "az"];

/** /businesses — the result-set parameters, and whether the visit is
 * unrefined ("curated": no search / filter / sort / map area). Curation
 * depends ONLY on the query — never on the presentation — so List and
 * Map always show the same flat result set (a Map → List switch can't turn
 * the List into a different page). */
export async function brandArchive(p: ArchiveParams): Promise<{ search: SearchBusinessesParams; sort: BusinessSort; featured: boolean; founding: boolean; isBrowseMode: boolean; bbox: Bbox | null }> {
  const sortRaw = one(p, "sort") as BusinessSort | undefined;
  const sort: BusinessSort = sortRaw && BUSINESS_SORTS.includes(sortRaw) ? sortRaw : "recommended";
  const featured = one(p, "featured") === "1";
  const founding = one(p, "founding") === "1";
  const market = one(p, "market");
  const geo = one(p, "geo");
  const canonicalGeo = geo ? await resolveCanonicalGeoScope(geo) : null;
  const q = one(p, "q");
  const category = one(p, "category");
  const location = one(p, "location");
  const bbox = archiveBbox(p);
  const isBrowseMode = !q && !category && !location && !featured && !founding && sort === "recommended" && isCanonicalGeoScopeEmpty(canonicalGeo) && !bbox;
  return {
    search: { q, categorySlug: category, location, marketSlug: market, areaSlug: market ? one(p, "area") : undefined, canonicalGeo, featuredOnly: featured, foundingMemberOnly: founding, sort },
    sort,
    featured,
    founding,
    isBrowseMode,
    bbox,
  };
}

export const FIND_WINDOWS: FindWindow[] = ["live", "today", "weekend", "anytime"];

/** /find (Findmi Here) */
export async function findArchive(p: ArchiveParams): Promise<{ when: FindWindow; extra: { categorySlug?: string; marketSlug?: string; areaSlug?: string; q?: string; canonicalGeo?: Awaited<ReturnType<typeof resolveCanonicalGeoScope>> }; bbox: Bbox | null }> {
  const whenRaw = one(p, "when") as FindWindow | undefined;
  const market = one(p, "market");
  const geo = one(p, "geo");
  return {
    when: whenRaw && FIND_WINDOWS.includes(whenRaw) ? whenRaw : "anytime",
    extra: { categorySlug: one(p, "category"), marketSlug: market, areaSlug: market ? one(p, "area") : undefined, q: one(p, "q"), canonicalGeo: geo ? await resolveCanonicalGeoScope(geo) : null },
    bbox: archiveBbox(p),
  };
}
