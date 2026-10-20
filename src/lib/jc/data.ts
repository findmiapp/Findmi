// JerseyCity.guide data adapter — thin, read-only mapping from Findmi's
// shared domain layer into JC view models. JC owns presentation and
// editorial policy only; every domain rule comes from Findmi:
//   freshness / occurrences — getEffectiveUpcomingEvents, getEffectiveEventSchedule, hasEnded
//   attendance / privacy    — resolveEventCtas, rsvpActionLabel, isLocationHidden, resolveEventActionForm
//                             (list/place feeds are already privacy-applied by the shared queries)
//   geography               — Markets/Areas (getAreaScopeIds) + canonical Census geography
//                             (resolveCanonicalGeoScope, getEventIdsInCanonicalGeo, canonicalGeoMatchesScope)
//   category hierarchy      — eventCategoryFilterIds (parent includes children)
//   dates / time precision  — event-time.ts via ./format.ts
// In development, jcPreviewEnabled() swaps the SOURCE for the in-memory
// preview fixture (never mixed with real rows); the same shared rules run
// on it.

import "server-only";
import { cache } from "react";
import {
  applyOccurrenceOverride,
  attachEventCategories,
  getAreaScopeIds,
  getEffectiveEventSchedule,
  getEffectiveUpcomingEvents,
  getEventBySlug,
  getEventIdsInCanonicalGeo,
  getLocationBySlug,
  getLocationGalleryImages,
  getLocations,
  type EffectiveEventRow,
  type LocationWithCategory,
} from "../data";
import { isLocationHidden, rsvpActionLabel } from "../event-attendance";
import { eventCategoryFilterIds } from "../event-categories";
import { resolveEventCtas } from "../event-ctas";
import { eventVisibility } from "../event-publication";
import { calendarDate, hasEnded } from "../event-time";
import { resolveEventActionForm } from "../forms";
import { getDiscoveryWindowBounds, type DiscoveryWindow } from "../format";
import { resolveCanonicalGeoScope } from "../geo/canonical-scope";
import { canonicalGeoMatchesScope, effectiveOccurrenceCanonicalGeo, type EntityCanonicalGeo } from "../geo/effective-entity-geo";
import { EMPTY_CANONICAL_GEO_SCOPE, type CanonicalGeoScope } from "../geo/entity-geo-core";
import { getSupabase } from "../supabase";
import type { FindmiEvent, FindmiLocation } from "../types";
import { JC_AREA_SLUG, JC_GEO_PLACE_KEY, JC_MARKET_SLUG, jcPreviewEnabled } from "./config";
import { PREVIEW_EVENT_CATEGORIES, PREVIEW_NEIGHBORHOODS, previewEvents, previewPlaces, type PreviewAttendance } from "./preview-fixture";
import type { JcEvent, JcEventDetail, JcNeighborhood, JcPlace, JcPlaceDetail, JcWindow } from "./types";

export { jcPreviewEnabled };

// ---------------------------------------------------------------- scope

interface JcScope {
  marketId: string | null;
  areaId: string | null;
  /** Jersey City's own Area id plus its active child (neighborhood) Areas. */
  areaIds: Set<string>;
  /** Canonical Census scope for Jersey City (shared resolver). */
  canonical: CanonicalGeoScope;
  neighborhoods: (JcNeighborhood & { id: string })[];
}

const EMPTY_SCOPE: JcScope = { marketId: null, areaId: null, areaIds: new Set(), canonical: EMPTY_CANONICAL_GEO_SCOPE, neighborhoods: [] };

export const getJcScope = cache(async (): Promise<JcScope> => {
  const supabase = getSupabase();
  if (!supabase) return EMPTY_SCOPE;
  const canonical = (await resolveCanonicalGeoScope(JC_GEO_PLACE_KEY)) ?? EMPTY_CANONICAL_GEO_SCOPE;
  const { data: market } = await supabase.from("markets").select("id").eq("slug", JC_MARKET_SLUG).eq("active", true).maybeSingle();
  const area = market
    ? (await supabase.from("market_areas").select("id").eq("market_id", market.id).eq("slug", JC_AREA_SLUG).eq("active", true).maybeSingle()).data
    : null;
  if (!market || !area) return { ...EMPTY_SCOPE, marketId: market?.id ?? null, canonical };
  const ids = await getAreaScopeIds(supabase, area.id);
  const { data: children } = await supabase
    .from("market_areas")
    .select("id, slug, name, display_name, image_url, sort_order")
    .eq("parent_area_id", area.id)
    .eq("active", true)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  const neighborhoods = ((children ?? []) as { id: string; slug: string; name: string; display_name: string | null; image_url: string | null }[]).map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.display_name || c.name,
    image: c.image_url,
  }));
  return { marketId: market.id, areaId: area.id, areaIds: new Set(ids), canonical, neighborhoods };
});

type GeoRow = { market_area_id?: string | null; geo_place_key?: string | null; geo_zcta_key?: string | null; geo_state_key?: string | null };

function ownGeo(row: GeoRow | null | undefined): EntityCanonicalGeo | null {
  if (!row) return null;
  return { place: row.geo_place_key ?? null, zcta: row.geo_zcta_key ?? null, state: row.geo_state_key ?? null };
}

/** In Jersey City: the curated JC Area (or a child neighborhood), or the
 * canonical Jersey City Census place. Free-text city/state never counts. */
function inScope(scope: JcScope, areaId: string | null | undefined, geo: EntityCanonicalGeo | null): boolean {
  if (areaId && scope.areaIds.has(areaId)) return true;
  return !!geo && canonicalGeoMatchesScope(geo, scope.canonical);
}

function neighborhoodFor(scope: JcScope, areaId: string | null | undefined): JcNeighborhood | null {
  if (!areaId) return null;
  const n = scope.neighborhoods.find((h) => h.id === areaId);
  return n ? { slug: n.slug, name: n.name, image: n.image } : null;
}

// ---------------------------------------------------------------- neighborhoods

export async function getJcNeighborhoods(): Promise<JcNeighborhood[]> {
  if (jcPreviewEnabled()) return PREVIEW_NEIGHBORHOODS;
  const scope = await getJcScope();
  return scope.neighborhoods.map(({ slug, name, image }) => ({ slug, name, image }));
}

export async function getJcNeighborhood(slug: string): Promise<JcNeighborhood | null> {
  const all = await getJcNeighborhoods();
  return all.find((n) => n.slug === slug) ?? null;
}

// ---------------------------------------------------------------- categories

/** Every event-category slug a JC editorial selection covers, using
 * Findmi's shared hierarchy rule (a top-level category includes all of
 * its subcategories; a subcategory matches only itself). */
async function resolveEventCategorySlugs(selected: readonly string[]): Promise<Set<string>> {
  let rows: { id: string; slug: string; parent_id: string | null }[];
  if (jcPreviewEnabled()) {
    rows = PREVIEW_EVENT_CATEGORIES;
  } else {
    const supabase = getSupabase();
    if (!supabase) return new Set();
    const { data } = await supabase.from("categories").select("id, slug, parent_id").eq("kind", "event");
    rows = (data ?? []) as typeof rows;
  }
  const slugById = new Map(rows.map((r) => [r.id, r.slug]));
  const out = new Set<string>();
  for (const cat of rows.filter((r) => selected.includes(r.slug))) {
    const children = rows.filter((r) => r.parent_id === cat.id);
    for (const id of eventCategoryFilterIds(cat, children)) {
      const slug = slugById.get(id);
      if (slug) out.add(slug);
    }
  }
  return out;
}

// ---------------------------------------------------------------- events

/** events rows are read with select("*"), so is_demo is present even
 * though FindmiEvent doesn't type it. */
function isLiveEvent(e: FindmiEvent): boolean {
  const isDemo = (e as FindmiEvent & { is_demo?: boolean }).is_demo ?? false;
  return eventVisibility({ is_demo: isDemo, archived_at: e.archived_at, trashed_at: e.trashed_at }) === "live";
}

const WINDOW_MAP: Record<Exclude<JcWindow, "">, DiscoveryWindow> = { today: "now", weekend: "weekend", week: "week" };

function boundsFor(window: JcWindow) {
  return window ? getDiscoveryWindowBounds(WINDOW_MAP[window]) : null;
}

export interface JcEventQuery {
  window?: JcWindow;
  neighborhood?: string;
  /** JC editorial category selection (resolved through the hierarchy). */
  categorySlugs?: readonly string[];
  q?: string;
  placeSlug?: string;
  limit?: number;
}

const notEnded = (d: { startAt: string | null; endAt: string | null; date: string; timezone: string | null }) =>
  !hasEnded({ start_at: d.startAt, end_at: d.endAt, occurrence_date: d.date, timezone: d.timezone });

/** Fixture events, trimmed to dates that are still upcoming (shared
 * hasEnded). Card fields always come from the first not-yet-ended date. */
function freshPreviewEvents() {
  return previewEvents()
    .map((e) => {
      const dates = e.dates.filter(notEnded);
      if (dates.length === 0) return null;
      return { ...e, dates, date: dates[0].date, startAt: dates[0].startAt, endAt: dates[0].endAt, timezone: dates[0].timezone };
    })
    .filter((e): e is NonNullable<typeof e> => !!e);
}

/** Preview-only stand-ins for filters the real path gets from SQL. */
function overlapsWindow(e: { startAt: string | null; endAt: string | null; date: string }, b: { start: Date; end: Date } | null): boolean {
  if (!b) return true;
  const start = e.startAt ? Date.parse(e.startAt) : Date.parse(`${e.date}T12:00:00Z`);
  const end = e.endAt ? Date.parse(e.endAt) : start;
  return start < b.end.getTime() && end >= b.start.getTime();
}
function matchesQ(q: string | undefined, ...fields: (string | null | undefined)[]): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

function byStart(a: JcEvent, b: JcEvent): number {
  return a.date.localeCompare(b.date) || (a.startAt ?? "~").localeCompare(b.startAt ?? "~");
}

/** JC editorial policy: browse/discovery surfaces never merchandise a
 * cancelled date (Findmi's own pages may show it with a badge). */
function isBrowsable(r: EffectiveEventRow): boolean {
  return r.occurrence?.status !== "cancelled" && isLiveEvent(r.event);
}

async function mapRealEvents(rows: EffectiveEventRow[], scope: JcScope): Promise<JcEvent[]> {
  const live = rows.filter(isBrowsable);
  const withCats = await attachEventCategories(live.map((r) => r.event));
  const catsById = new Map(withCats.map((e) => [e.id, e.categories]));
  return live.map((r) => {
    const e = applyOccurrenceOverride(r.event, r.occurrence, r.occurrenceLocation);
    const cats = catsById.get(r.event.id) ?? [];
    const areaId = r.occurrenceLocation?.market_area_id ?? r.event.market_area_id;
    return {
      id: r.occurrence ? `${r.event.id}:${r.occurrence.id}` : r.event.id,
      slug: r.event.slug,
      title: r.event.name,
      image: e.cover_image_url ?? r.occurrenceLocation?.cover_image_url ?? null,
      startAt: r.effectiveStart,
      endAt: r.effectiveEnd,
      date: r.effectiveDate,
      timezone: r.occurrence?.timezone ?? null,
      // Already withheld by the shared query when the location is hidden.
      venue: r.occurrenceLocation?.name ?? e.venue_name ?? null,
      neighborhood: neighborhoodFor(scope, areaId),
      categorySlugs: cats.map((c) => c.slug),
      categoryLabel: cats[0]?.name ?? null,
      featured: !!r.event.is_featured,
      createdAt: (r.event as { created_at?: string }).created_at ?? null,
    };
  });
}

export async function getJcEvents(query: JcEventQuery = {}): Promise<JcEvent[]> {
  const bounds = boundsFor(query.window ?? "");
  const limit = query.limit ?? 40;
  const cats = query.categorySlugs?.length ? await resolveEventCategorySlugs(query.categorySlugs) : null;
  const catOk = (slugs: string[]) => !cats || slugs.some((s) => cats.has(s));

  if (jcPreviewEnabled()) {
    return freshPreviewEvents()
      .filter((e) => overlapsWindow(e, bounds))
      .filter((e) => !query.neighborhood || e.neighborhood?.slug === query.neighborhood)
      .filter((e) => catOk(e.categorySlugs))
      .filter((e) => !query.placeSlug || e.placeSlug === query.placeSlug)
      .filter((e) => matchesQ(query.q, e.title, e.venue, e.categoryLabel, e.neighborhood?.name))
      .sort(byStart)
      .slice(0, limit);
  }

  const scope = await getJcScope();
  let locationId: string | undefined;
  if (query.placeSlug) {
    const loc = await getLocationBySlug(query.placeSlug);
    if (!loc || !inScope(scope, loc.market_area_id, ownGeo(loc))) return [];
    locationId = loc.id;
  }
  const base = { q: query.q || undefined, locationId };

  // Curated Area scope (neighborhood filters are Areas only) ∪ canonical
  // Jersey City place scope — both through the shared upcoming-events query.
  const areaRows = scope.areaId
    ? getEffectiveUpcomingEvents(bounds, { ...base, marketSlug: JC_MARKET_SLUG, areaSlug: query.neighborhood || JC_AREA_SLUG })
    : Promise.resolve([] as EffectiveEventRow[]);
  const geoRows = query.neighborhood
    ? Promise.resolve([] as EffectiveEventRow[])
    : getEventIdsInCanonicalGeo(scope.canonical).then((ids) => (ids && ids.length ? getEffectiveUpcomingEvents(bounds, { ...base, eventIds: ids }) : []));
  const [a, g] = await Promise.all([areaRows, geoRows]);
  const seen = new Set<string>();
  const rows = [...a, ...g].filter((r) => (seen.has(r.event.id) ? false : (seen.add(r.event.id), true)));

  const events = await mapRealEvents(rows, scope);
  return events.filter((e) => catOk(e.categorySlugs)).sort(byStart).slice(0, limit);
}

/** Organizer attendance action for one date — the shared Findmi decision
 * (resolveEventCtas + rsvpActionLabel + Form Manager RSVP resolution).
 * Apply to Vend is a vendor action, so JC (a consumer guide) leaves it
 * out as editorial policy; Tickets / RSVP / Register are unchanged. */
async function attendanceAction(
  event: { id: string; name: string } & PreviewAttendance,
  selected: { ticket_url_override: string | null; rsvp_url_override: string | null } | null,
  preview: boolean,
): Promise<{ label: string; url: string } | null> {
  if (!selected) return null;
  const rsvp = event.rsvp_enabled
    ? preview
      ? event.rsvp_url ? { url: event.rsvp_url, displayMode: "external" as const } : null
      : await resolveEventActionForm("rsvp", event, event.rsvp_url)
    : null;
  const [first] = resolveEventCtas(
    { ...selected, vendor_apply_url_override: null },
    {
      ticketsEnabled: event.tickets_enabled,
      ticketsUrl: event.tickets_url,
      rsvpEnabled: event.rsvp_enabled,
      rsvp,
      rsvpLabel: rsvpActionLabel(event.rsvp_cta),
      vendorApplicationsEnabled: false,
      vendorApplication: null,
    },
  );
  return first ? { label: first.label, url: first.action.url } : null;
}

export async function getJcEvent(slug: string): Promise<JcEventDetail | null> {
  if (jcPreviewEnabled()) {
    const e = previewEvents().find((x) => x.slug === slug);
    if (!e) return null;
    const dates = e.dates.filter(notEnded);
    const next = dates.find((d) => !d.cancelled) ?? null;
    const hidden = isLocationHidden(e.attendance.location_visibility);
    const place = !hidden && e.placeSlug ? (previewPlaces().find((x) => x.slug === e.placeSlug) ?? null) : null;
    return {
      ...e,
      ...(next ? { date: next.date, startAt: next.startAt, endAt: next.endAt, timezone: next.timezone } : {}),
      dates: dates.map(({ id, date, startAt, endAt, timezone, venue, cancelled }) => ({ id, date, startAt, endAt, timezone, venue, cancelled })),
      action: await attendanceAction({ id: e.id, name: e.title, ...e.attendance }, next, true),
      detailsUrl: e.attendance.external_url,
      locationHidden: hidden,
      address: hidden ? null : e.address,
      place,
    };
  }

  const scope = await getJcScope();
  const event = await getEventBySlug(slug);
  if (!event || !isLiveEvent(event)) return null;
  // Shared schedule: real occurrences (location privacy already applied)
  // plus the primary date when it is still upcoming.
  const schedule = await getEffectiveEventSchedule(event, 12);
  const eventGeo = ownGeo(event);
  const scheduleInScope = schedule.some((o) => {
    const geo = effectiveOccurrenceCanonicalGeo({ occurrenceGeo: ownGeo(o), locationId: o.location_id, locationGeo: ownGeo(o.location), eventGeo });
    return inScope(scope, o.location?.market_area_id ?? event.market_area_id, geo);
  });
  if (!inScope(scope, event.market_area_id, eventGeo) && !scheduleInScope) return null;

  const upcoming = schedule.filter((o) => !hasEnded(o));
  const next = upcoming.find((o) => o.status !== "cancelled") ?? null;
  const hidden = isLocationHidden(event.location_visibility);
  const [withCats] = await attachEventCategories([event]);
  const loc: FindmiLocation | null = hidden ? null : (next?.location ?? null);
  const place = loc && inScope(scope, loc.market_area_id, ownGeo(loc)) ? toPlace({ ...loc, category: null }, scope) : null;

  return {
    id: event.id,
    slug: event.slug,
    title: event.name,
    image: event.cover_image_url ?? loc?.cover_image_url ?? null,
    startAt: next?.start_at ?? null,
    endAt: next?.end_at ?? null,
    date: next ? (calendarDate(next) ?? next.occurrence_date) : event.start_date,
    timezone: next?.timezone ?? null,
    venue: hidden ? null : (loc?.name ?? next?.venue_name ?? event.venue_name),
    neighborhood: neighborhoodFor(scope, loc?.market_area_id ?? event.market_area_id),
    categorySlugs: withCats.categories.map((c) => c.slug),
    categoryLabel: withCats.categories[0]?.name ?? null,
    featured: !!event.is_featured,
    createdAt: null,
    description: event.description,
    address: hidden ? null : (loc?.address ?? next?.address ?? event.address),
    organizer: event.organizer_name,
    action: await attendanceAction(
      {
        id: event.id,
        name: event.name,
        tickets_enabled: event.tickets_enabled,
        tickets_url: event.tickets_url,
        rsvp_enabled: event.rsvp_enabled,
        rsvp_url: event.rsvp_url,
        rsvp_cta: event.rsvp_cta ?? null,
        external_url: event.external_url,
        location_visibility: event.location_visibility ?? null,
      },
      next,
      false,
    ),
    detailsUrl: event.external_url,
    locationHidden: hidden,
    dates: upcoming.map((o) => ({
      id: o.id,
      date: calendarDate(o) ?? o.occurrence_date,
      startAt: o.start_at,
      endAt: o.end_at,
      timezone: o.timezone ?? null,
      venue: hidden ? null : (o.location?.name ?? o.venue_name ?? null),
      cancelled: o.status === "cancelled",
    })),
    place,
  };
}

// ---------------------------------------------------------------- places

function toPlace(l: LocationWithCategory, scope: JcScope): JcPlace {
  return {
    id: l.id,
    slug: l.slug,
    name: l.name,
    image: l.cover_image_url ?? l.logo_url ?? null,
    categorySlug: l.category?.slug ?? null,
    categoryLabel: l.category?.name ?? null,
    neighborhood: neighborhoodFor(scope, l.market_area_id),
    createdAt: (l as { created_at?: string }).created_at ?? null,
  };
}

export interface JcPlaceQuery {
  neighborhood?: string;
  /** Location categories are flat — matched by slug. */
  categorySlugs?: readonly string[];
  q?: string;
  limit?: number;
}

export async function getJcPlaces(query: JcPlaceQuery = {}): Promise<JcPlace[]> {
  const limit = query.limit ?? 40;
  const cats = query.categorySlugs;
  if (jcPreviewEnabled()) {
    return previewPlaces()
      .filter((p) => !query.neighborhood || p.neighborhood?.slug === query.neighborhood)
      .filter((p) => !cats?.length || (p.categorySlug && cats.includes(p.categorySlug)))
      .filter((p) => matchesQ(query.q, p.name, p.categoryLabel, p.neighborhood?.name))
      .slice(0, limit);
  }
  const scope = await getJcScope();
  const base = { q: query.q || undefined, categorySlug: cats?.length === 1 ? cats[0] : undefined, limit: Math.max(limit, 60) };
  const [a, g] = await Promise.all([
    scope.areaId ? getLocations({ ...base, marketSlug: JC_MARKET_SLUG, areaSlug: query.neighborhood || JC_AREA_SLUG }) : Promise.resolve([]),
    query.neighborhood ? Promise.resolve([]) : getLocations({ ...base, canonicalGeo: scope.canonical }),
  ]);
  const seen = new Set<string>();
  return [...a, ...g]
    .filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)))
    .filter((l) => !l.archived_at && !l.trashed_at)
    .filter((l) => !cats?.length || (l.category && cats.includes(l.category.slug)))
    .map((l) => toPlace(l, scope))
    .sort((x, y) => x.name.localeCompare(y.name))
    .slice(0, limit);
}

export async function getJcPlace(slug: string): Promise<JcPlaceDetail | null> {
  if (jcPreviewEnabled()) {
    const p = previewPlaces().find((x) => x.slug === slug);
    if (!p) return null;
    return { ...p, upcoming: await getJcEvents({ placeSlug: slug, limit: 12 }) };
  }
  const scope = await getJcScope();
  const loc = await getLocationBySlug(slug);
  if (!loc || loc.archived_at || loc.trashed_at || !inScope(scope, loc.market_area_id, ownGeo(loc))) return null;
  // Place feed: the shared query already drops events that hide their
  // location when filtering by locationId.
  const [gallery, upcoming] = await Promise.all([getLocationGalleryImages(loc.id), getJcEvents({ placeSlug: slug, limit: 12 })]);
  return {
    ...toPlace(loc, scope),
    description: loc.description,
    address: loc.address,
    website: loc.website_url,
    phone: loc.phone,
    gallery,
    upcoming,
  };
}
