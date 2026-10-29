import "server-only";
import { getSupabase } from "@/lib/supabase";
import { getAreaScopeIds } from "@/lib/data";
import { eventHref } from "@/lib/event-links";
import { fetchHiddenEventIds } from "@/lib/event-location-privacy";
import { isRangeMirrorOccurrence } from "@/lib/event-range-mirror";
import { formatWhen, todayIn } from "@/lib/event-time";
import { resolveCanonicalGeoScope } from "@/lib/geo/canonical-scope";
import { geoScopeOrFilter, isCanonicalGeoScopeEmpty } from "@/lib/geo/entity-geo-core";
import { applyLocationDiscoveryFilter, isLocationDiscoverable } from "@/lib/location-eligibility";
import { normalizeLocationHours } from "@/lib/locationHours";
import { BENEFIT_LABELS, ENTRY_LABELS, normalizeAudience, normalizeBenefits, normalizeEntryModes } from "./attributes";
import { matchLabels, queryChips, type ChipNames, type QueryChip } from "./chips";
import {
  bboxCenter,
  compareRankedMap,
  diversify,
  haystackOf,
  isValidCoordinate,
  mapFeatures,
  mapKinds,
  mapStatus,
  matchesMapItem,
  rankMapItem,
  relaxationCandidates,
  taxonomyTerms,
  type Bbox,
  type MapBrand,
  type MapFeature,
  type MapItem,
  type MapLocation,
  type MapStatus,
  type PersonalSignals,
  type RankedMapItem,
} from "./map-core";
import { mapFacets, type MapFacets } from "./map-filters";
import { mapHref, type DiscoveryQuery } from "./query";
import { getPersonalContext, getVocabulary, taxonomyFor, type Vocabulary } from "./server";
import { prefilterBounds } from "./time";

// Discovery Engine V1 — server half of Map + Feed (and, later, Calendar /
// saved searches / Business Manager geography — see ./manager-lens.ts).
//
// One request = one bounded candidate fetch, pre-filtered IN THE DATABASE by
// viewport (locations(latitude, longitude) index), geography, time window
// and the canonical public-visibility rules every Findmi read already uses:
//   • RLS (archived/trashed Events, Occurrences, Locations, Appearances
//     never come back to the anon client);
//   • events.is_demo = false; Businesses listed + live;
//   • an Event that hides its location (events.location_visibility) is
//     never placed on a map at all;
//   • a Location is a Place result only when consumer-discoverable
//     (lib/location-eligibility) — coordinates never make it discoverable.
// Geography always resolves THROUGH the canonical Location (occurrence /
// appearance location_id); no coordinate is read from Events/Appearances.
// The exact per-timezone, AND/OR, ranking and marker logic then runs in
// the pure ./map-core.

export const MAX_CANDIDATES = 1500;
const MAX_PLACES = 800;
const CHUNK = 150;
export const PAGE_SIZE = 24;

type Row = Record<string, unknown>;
type Client = NonNullable<ReturnType<typeof getSupabase>>;

const LOCATION_COLS = "id, name, slug, latitude, longitude, city, state, is_demo, logo_url, cover_image_url, market_area_id, market_id, hours, parent_location_id, category_id";

async function inChunks<T>(ids: string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await run(ids.slice(i, i + CHUNK))));
  return out;
}

// ------------------------------------------------------------ geography

interface GeoFilter {
  bbox?: Bbox;
  areaIds?: string[];
  marketId?: string;
  canonical?: string | null;
  placeIds?: string[];
  /** A geography was asked for but resolves to nothing → zero results
   * (never a silent fallback to everywhere). */
  none?: boolean;
}

async function resolveGeo(supabase: Client, q: DiscoveryQuery, vocab: Vocabulary): Promise<GeoFilter> {
  const g: GeoFilter = {};
  if (q.bbox) g.bbox = q.bbox as Bbox;
  if (q.area) {
    const area = vocab.areaRows.find((a) => a.slug === q.area && (!q.market || a.market === q.market));
    if (!area) return { none: true };
    g.areaIds = await getAreaScopeIds(supabase, area.id);
  } else if (q.market) {
    const market = vocab.marketRows.find((m) => m.slug === q.market);
    if (!market) return { none: true };
    g.marketId = market.id;
  }
  if (q.census) {
    const scope = await resolveCanonicalGeoScope(q.census);
    g.canonical = scope && !isCanonicalGeoScopeEmpty(scope) ? geoScopeOrFilter(scope) : null;
    if (!g.canonical) return { none: true };
  }
  if (q.place) {
    const { data: loc } = await supabase.from("locations").select("id").eq("slug", q.place).maybeSingle();
    if (!loc) return { none: true };
    const { data: kids } = await supabase.from("locations").select("id").eq("parent_location_id", (loc as { id: string }).id).limit(200);
    g.placeIds = [(loc as { id: string }).id, ...((kids ?? []) as { id: string }[]).map((k) => k.id)];
  }
  return g;
}

/** Applies the geography to a query on `locations` (prefix "") or on an
 * inner-embedded location (prefix "location."). */
function applyGeo(query: any, g: GeoFilter, prefix: string): any {
  let qy = query.not(`${prefix}latitude`, "is", null);
  if (g.bbox) {
    qy = qy.gte(`${prefix}longitude`, g.bbox[0]).lte(`${prefix}longitude`, g.bbox[2]).gte(`${prefix}latitude`, g.bbox[1]).lte(`${prefix}latitude`, g.bbox[3]);
  }
  if (g.areaIds) qy = qy.in(`${prefix}market_area_id`, g.areaIds);
  if (g.marketId) qy = qy.eq(`${prefix}market_id`, g.marketId);
  if (g.placeIds) qy = qy.in(`${prefix}id`, g.placeIds);
  if (g.canonical) qy = prefix ? qy.or(g.canonical, { referencedTable: prefix.slice(0, -1) }) : qy.or(g.canonical);
  return qy;
}

// ------------------------------------------------------------ rows → items

function toLocation(r: Row, vocab: Vocabulary): MapLocation | null {
  if (!isValidCoordinate(r.latitude, r.longitude)) return null;
  const discoverable = isLocationDiscoverable(r as { is_demo?: boolean; logo_url?: string; cover_image_url?: string });
  const areaId = typeof r.market_area_id === "string" ? r.market_area_id : null;
  return {
    id: r.id as string,
    name: (r.name as string) ?? "",
    slug: discoverable ? ((r.slug as string) ?? null) : null,
    discoverable,
    lat: r.latitude as number,
    lng: r.longitude as number,
    city: (r.city as string) ?? null,
    state: (r.state as string) ?? null,
    area: areaId ? (vocab.areaRows.find((a) => a.id === areaId)?.slug ?? null) : null,
    logo: discoverable ? ((r.logo_url as string) ?? null) : null,
    cover: discoverable ? ((r.cover_image_url as string) ?? null) : null,
    hours: normalizeLocationHours(r.hours),
    timezone: typeof r.timezone === "string" ? r.timezone : null,
  };
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Structured attributes, read on their own so discovery keeps working
 * before the Discovery Engine migration is applied (the columns simply
 * read as empty then). */
async function eventAttributes(supabase: Client, ids: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  try {
    const rows = await inChunks(ids, async (c) => {
      const { data, error } = await supabase.from("events").select("id, benefits, audience, entry_modes").in("id", c);
      if (error) throw error;
      return (data ?? []) as Row[];
    });
    for (const r of rows) out.set(r.id as string, r);
  } catch {
    // Migration not applied yet: no structured attributes exist.
  }
  return out;
}

async function publicBrands(supabase: Client, ids: string[]): Promise<Map<string, MapBrand>> {
  const rows = await inChunks([...new Set(ids)], async (c) => {
    const { data } = await supabase.from("businesses").select("id, slug, name, logo_url").in("id", c).eq("is_demo", false).eq("publication_status", "live");
    return (data ?? []) as Row[];
  });
  return new Map(rows.map((r) => [r.id as string, { id: r.id as string, slug: r.slug as string, name: r.name as string, logo: (r.logo_url as string) ?? null }]));
}

/** Category names behind Location categories and Brand (business)
 * categories — the canonical subject of a Place or Brand ("Café / Coffee
 * Shop", "Coffee, Tea & Beverages"), searchable as text. */
async function categoryNames(supabase: Client, locationCategoryIds: string[], brandIds: string[]): Promise<{ name: Map<string, string>; ofBrand: Map<string, string[]> }> {
  const links = await inChunks([...new Set(brandIds)], async (c) => ((await supabase.from("business_categories").select("business_id, category_id").in("business_id", c)).data ?? []) as Row[]);
  const ids = [...new Set([...locationCategoryIds, ...links.map((l) => l.category_id as string)])].filter(Boolean);
  const rows = await inChunks(ids, async (c) => ((await supabase.from("categories").select("id, name").in("id", c)).data ?? []) as Row[]);
  const name = new Map(rows.map((r) => [r.id as string, r.name as string]));
  const ofBrand = new Map<string, string[]>();
  for (const l of links) {
    const n = name.get(l.category_id as string);
    if (n) ofBrand.set(l.business_id as string, [...(ofBrand.get(l.business_id as string) ?? []), n]);
  }
  return { name, ofBrand };
}

export interface LoadedItems {
  items: MapItem[];
  truncated: boolean;
}

/** The bounded, database-prefiltered candidate set for a query. */
export async function loadMapItems(q: DiscoveryQuery, now: Date): Promise<LoadedItems> {
  const supabase = getSupabase();
  if (!supabase) return { items: [], truncated: false };
  const vocab = await getVocabulary();
  const geo = await resolveGeo(supabase, q, vocab);
  if (geo.none) return { items: [], truncated: false };
  const kinds = mapKinds(q);
  const wantDated = kinds.has("event") || kinds.has("appearance");
  const bounds = prefilterBounds(q, now);
  const nowIso = now.toISOString();
  const yesterday = todayIn(undefined, new Date(now.getTime() - 86_400_000));
  let truncated = false;

  // ---- Occurrences (the temporal truth for Events).
  let occRows: Row[] = [];
  if (wantDated) {
    let oq = supabase
      .from("event_occurrences")
      .select(`id, event_id, start_at, end_at, occurrence_date, timezone, status, created_at, location:locations!inner(${LOCATION_COLS}), event:events!inner(id, slug, name, cover_image_url, is_demo, is_free, family_friendly, rsvp_enabled, rsvp_url, tickets_enabled, tickets_url, host_business_id, is_featured, created_at, start_at, end_at, venue_name, organizer_name)`)
      .eq("status", "scheduled")
      .eq("event.is_demo", false);
    oq = applyGeo(oq, geo, "location.");
    oq = bounds
      ? oq.or(`and(start_at.lt.${bounds.endIso},end_at.gt.${bounds.startIso}),and(end_at.is.null,occurrence_date.gte.${bounds.fromDate},occurrence_date.lte.${bounds.toDate})`)
      : oq.or(`end_at.gte.${nowIso},and(end_at.is.null,occurrence_date.gte.${yesterday})`);
    const { data, error } = await oq.order("start_at", { ascending: true, nullsFirst: false }).limit(MAX_CANDIDATES);
    if (error) console.error("[map] occurrences query failed", error.message);
    occRows = (data ?? []) as Row[];
    if (occRows.length >= MAX_CANDIDATES) truncated = true;
  }

  // ---- Appearances at real Locations (Brands' own physical presence).
  let appRows: Row[] = [];
  if (kinds.has("appearance") || kinds.has("event")) {
    let aq = supabase
      .from("appearances")
      .select(`id, business_id, event_id, event_occurrence_id, title, start_at, end_at, status, flyer_image_url, created_at, location:locations!inner(${LOCATION_COLS}), business:businesses!appearances_business_id_fkey(id, slug, name, logo_url, cover_image_url, is_demo, publication_status)`)
      .neq("status", "canceled");
    aq = applyGeo(aq, geo, "location.");
    aq = bounds ? aq.lt("start_at", bounds.endIso).gt("end_at", bounds.startIso) : aq.gt("end_at", nowIso);
    const { data, error } = await aq.order("start_at", { ascending: true }).limit(MAX_CANDIDATES);
    if (error) console.error("[map] appearances query failed", error.message);
    appRows = (data ?? []) as Row[];
    if (appRows.length >= MAX_CANDIDATES) truncated = true;
  }

  // ---- Places (discoverable Locations only).
  let placeRows: Row[] = [];
  if (kinds.has("place")) {
    let pq = supabase.from("locations").select(LOCATION_COLS);
    pq = applyLocationDiscoveryFilter(applyGeo(pq, geo, ""));
    const { data, error } = await pq.limit(MAX_PLACES);
    if (error) console.error("[map] places query failed", error.message);
    placeRows = (data ?? []) as Row[];
    if (placeRows.length >= MAX_PLACES) truncated = true;
  }

  // ---- Privacy: Events that withhold their location never reach a map.
  const eventIds = [...new Set([...occRows.map((r) => r.event_id as string), ...appRows.map((r) => r.event_id as string).filter(Boolean)])];
  const hidden = new Set<string>();
  for (let i = 0; i < eventIds.length; i += CHUNK) for (const id of await fetchHiddenEventIds(supabase, eventIds.slice(i, i + CHUNK))) hidden.add(id);
  occRows = occRows.filter((r) => !hidden.has(r.event_id as string));
  appRows = appRows.filter((r) => !(r.event_id && hidden.has(r.event_id as string)));

  // ---- Range mirrors (presentation rule): set aside when real dates exist.
  const byEvent = new Map<string, Row[]>();
  for (const r of occRows) byEvent.set(r.event_id as string, [...(byEvent.get(r.event_id as string) ?? []), r]);
  occRows = occRows.filter((r) => {
    const ev = one(r.event as Row | Row[]);
    const siblings = byEvent.get(r.event_id as string) ?? [];
    return !(ev && siblings.length > 1 && isRangeMirrorOccurrence(r as { start_at: string | null; end_at: string | null }, ev as { start_at: string | null; end_at: string | null }));
  });

  // ---- Related canonical data: taxonomy, attributes, Brands.
  const liveEventIds = [...new Set(occRows.map((r) => r.event_id as string))];
  const taxIds = [...new Set([...liveEventIds, ...appRows.map((r) => r.event_id as string).filter(Boolean)])];
  const tax = new Map<string, { categories: string[]; formats: string[] }>();
  for (let i = 0; i < taxIds.length; i += CHUNK) for (const [k, v] of await taxonomyFor(taxIds.slice(i, i + CHUNK), vocab)) tax.set(k, v);
  const attrs = await eventAttributes(supabase, taxIds);
  const occIds = occRows.map((r) => r.id as string);
  const [eventLinks, occLinks, placeLinks] = await Promise.all([
    inChunks(liveEventIds, async (c) => ((await supabase.from("event_businesses").select("event_id, business_id, participation_scope, display_order").in("event_id", c).eq("status", "approved")).data ?? []) as Row[]),
    inChunks(occIds, async (c) => ((await supabase.from("event_occurrence_businesses").select("occurrence_id, business_id").in("occurrence_id", c).eq("status", "approved")).data ?? []) as Row[]),
    inChunks(placeRows.map((r) => r.id as string), async (c) => {
      // Operators (business_locations) + Brands genuinely Available Here
      // (live, in-effect business_location_availability) — a real
      // relationship, never an assumption about stock.
      const today = now.toISOString().slice(0, 10);
      const [ops, avail] = await Promise.all([
        supabase.from("business_locations").select("location_id, business_id").in("location_id", c),
        supabase.from("business_location_availability").select("location_id, business_id").in("location_id", c).eq("status", "live").or(`starts_on.is.null,starts_on.lte.${today}`).or(`ends_on.is.null,ends_on.gte.${today}`),
      ]);
      const fallback = avail.error ? ((await supabase.from("business_location_availability").select("location_id, business_id").in("location_id", c)).data ?? []) : [];
      return [...((ops.data ?? []) as Row[]), ...((avail.data ?? fallback) as Row[])];
    }),
  ]);
  const brandIds = [
    ...occRows.map((r) => one(r.event as Row | Row[])?.host_business_id as string).filter(Boolean),
    ...eventLinks.map((r) => r.business_id as string),
    ...occLinks.map((r) => r.business_id as string),
    ...placeLinks.map((r) => r.business_id as string),
  ];
  const brands = await publicBrands(supabase, brandIds);
  for (const r of appRows) {
    const b = one(r.business as Row | Row[]);
    if (b && b.is_demo === false && b.publication_status === "live") brands.set(b.id as string, { id: b.id as string, slug: b.slug as string, name: b.name as string, logo: (b.logo_url as string) ?? null });
  }
  // ---- Searchable text (canonical relationships only — never inferred).
  const rawLocations = [...occRows.map((r) => one(r.location as Row | Row[])), ...appRows.map((r) => one(r.location as Row | Row[])), ...placeRows];
  const cats = await categoryNames(supabase, rawLocations.map((l) => (l?.category_id as string) ?? "").filter(Boolean), [...brands.keys()]);
  const taxNames = new Map([...vocab.taxonomyById.values()].map((t) => [t.slug, t.name]));
  const locCategory = (raw: Row | null) => (raw?.category_id ? (cats.name.get(raw.category_id as string) ?? null) : null);
  const brandTerms = (bs: MapBrand[]) => bs.flatMap((x) => [x.name, ...(cats.ofBrand.get(x.id) ?? [])]);
  const taxTerms = (t: { categories: string[]; formats: string[] } | undefined) => (t ? taxonomyTerms(t.categories, t.formats, taxNames, vocab.topicRows) : []);

  const brandsOfEvent = new Map<string, string[]>();
  for (const l of [...eventLinks].sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0))) {
    if (l.participation_scope === "selected_dates") continue;
    brandsOfEvent.set(l.event_id as string, [...(brandsOfEvent.get(l.event_id as string) ?? []), l.business_id as string]);
  }
  const brandsOfOcc = new Map<string, string[]>();
  for (const l of occLinks) brandsOfOcc.set(l.occurrence_id as string, [...(brandsOfOcc.get(l.occurrence_id as string) ?? []), l.business_id as string]);
  const occIdSet = new Set(occIds);
  // Appearances at a fetched date fold into that date (a Brand appearing
  // at Eataly's event is part of that event's card, not a second marker).
  for (const a of appRows) {
    const occ = a.event_occurrence_id as string | null;
    if (occ && occIdSet.has(occ)) brandsOfOcc.set(occ, [...(brandsOfOcc.get(occ) ?? []), a.business_id as string]);
  }

  const items: MapItem[] = [];
  const pickBrands = (ids: (string | null | undefined)[]) => {
    const seen = new Set<string>();
    const out: MapBrand[] = [];
    for (const id of ids) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const b = brands.get(id);
      if (b) out.push(b);
    }
    return out;
  };

  for (const r of occRows) {
    const ev = one(r.event as Row | Row[]);
    const loc = toLocation(one(r.location as Row | Row[]) ?? {}, vocab);
    if (!ev || !loc) continue;
    const t = tax.get(ev.id as string);
    const a = attrs.get(ev.id as string);
    const b = pickBrands([ev.host_business_id as string, ...(brandsOfEvent.get(ev.id as string) ?? []), ...(brandsOfOcc.get(r.id as string) ?? [])]);
    items.push({
      key: `occ:${r.id}`,
      kind: "event",
      id: r.id as string,
      eventId: ev.id as string,
      eventSlug: ev.slug as string,
      title: ev.name as string,
      href: eventHref(ev.slug as string, r.id as string),
      image: (ev.cover_image_url as string) ?? null,
      brands: b,
      location: loc,
      status: r.status === "cancelled" ? "cancelled" : "scheduled",
      start_at: (r.start_at as string) ?? null,
      end_at: (r.end_at as string) ?? null,
      occurrence_date: (r.occurrence_date as string) ?? null,
      timezone: (r.timezone as string) ?? null,
      categories: t?.categories ?? [],
      formats: t?.formats ?? [],
      is_free: typeof ev.is_free === "boolean" ? ev.is_free : null,
      family_friendly: typeof ev.family_friendly === "boolean" ? ev.family_friendly : null,
      benefits: normalizeBenefits(a?.benefits),
      audience: normalizeAudience(a?.audience),
      entry: normalizeEntryModes(a?.entry_modes),
      rsvp: Boolean(ev.rsvp_enabled && ev.rsvp_url),
      tickets: Boolean(ev.tickets_enabled && ev.tickets_url),
      featured: Boolean(ev.is_featured),
      created_at: (ev.created_at as string) ?? null,
      haystack: haystackOf(ev.name as string, ev.venue_name as string, ev.organizer_name as string, loc.name, loc.city, ...brandTerms(b), ...taxTerms(t)),
    });
  }

  for (const r of appRows) {
    const occ = r.event_occurrence_id as string | null;
    if (occ && occIdSet.has(occ)) continue;
    const biz = one(r.business as Row | Row[]);
    const loc = toLocation(one(r.location as Row | Row[]) ?? {}, vocab);
    if (!biz || biz.is_demo !== false || biz.publication_status !== "live" || !loc) continue;
    const brand = brands.get(biz.id as string)!;
    const evId = (r.event_id as string) ?? null;
    const t = evId ? tax.get(evId) : undefined;
    const a = evId ? attrs.get(evId) : undefined;
    items.push({
      key: `app:${r.id}`,
      kind: "appearance",
      id: r.id as string,
      eventId: evId,
      title: (r.title as string) || brand.name,
      href: `/business/${brand.slug}`,
      image: (r.flyer_image_url as string) ?? (biz.cover_image_url as string) ?? brand.logo,
      brands: [brand],
      location: loc,
      status: "scheduled",
      start_at: (r.start_at as string) ?? null,
      end_at: (r.end_at as string) ?? null,
      timezone: loc.timezone,
      categories: t?.categories ?? [],
      formats: t?.formats ?? [],
      is_free: null,
      family_friendly: null,
      benefits: normalizeBenefits(a?.benefits),
      audience: normalizeAudience(a?.audience),
      entry: normalizeEntryModes(a?.entry_modes),
      rsvp: false,
      tickets: false,
      featured: false,
      created_at: (r.created_at as string) ?? null,
      haystack: haystackOf(r.title as string, loc.name, loc.city, ...brandTerms([brand]), ...taxTerms(t)),
    });
  }

  const brandsAtPlace = new Map<string, string[]>();
  for (const l of placeLinks) brandsAtPlace.set(l.location_id as string, [...(brandsAtPlace.get(l.location_id as string) ?? []), l.business_id as string]);
  for (const r of placeRows) {
    const loc = toLocation(r, vocab);
    if (!loc || !loc.discoverable || !loc.slug) continue;
    const b = pickBrands(brandsAtPlace.get(loc.id) ?? []);
    items.push({
      key: `place:${loc.id}`,
      kind: "place",
      id: loc.id,
      eventId: null,
      title: loc.name,
      href: `/location/${loc.slug}`,
      image: loc.cover,
      brands: b,
      location: loc,
      status: "scheduled",
      start_at: null,
      end_at: null,
      categories: [],
      formats: [],
      is_free: null,
      family_friendly: null,
      benefits: [],
      audience: [],
      entry: [],
      rsvp: false,
      tickets: false,
      featured: false,
      created_at: null,
      haystack: haystackOf(loc.name, loc.city, locCategory(r), ...brandTerms(b)),
    });
  }
  return { items, truncated };
}

// ------------------------------------------------------------ response

/** One result card — the client-safe projection the Feed list and the
 * selected-marker preview render. */
export interface MapResultCard {
  key: string;
  kind: MapItem["kind"];
  title: string;
  href: string;
  image: string | null;
  logo: string | null;
  brand: { name: string; slug: string } | null;
  brandCount: number;
  place: { id: string; name: string; href: string | null; city: string | null };
  when: string;
  status: MapStatus;
  distanceKm: number | null;
  perks: string[];
  free: boolean;
  entry: string[];
  reason: string | null;
  moreDates: number;
  featureId: string;
  lng: number;
  lat: number;
  save: { type: "event" | "location" | "business"; id: string; slug: string | null } | null;
}

export interface MapResponse {
  query: DiscoveryQuery;
  total: number;
  features: MapFeature[];
  results: MapResultCard[];
  nextOffset: number | null;
  overflow: { name: string; slug: string; total: number; href: string }[];
  chips: { key: string; label: string; href: string }[];
  relaxations: { label: string; count: number; href: string }[];
  truncated: boolean;
  /** False until at least one Location has a canonical coordinate (the
   * geocoding backfill hasn't run yet) — the UI says so honestly. */
  mapReady: boolean;
  /** Which refinement values the current candidate set can satisfy (see
   * ./map-filters mapFacets) — the filter UI offers only these. */
  facets?: MapFacets;
  generatedAt: string;
}

export interface RunMapOptions {
  now?: Date;
  personal?: PersonalSignals | null;
  countOnly?: boolean;
  /** "feed" hrefs keep the Feed view when a chip or relaxation is tapped. */
  view?: "map" | "feed";
  /** Href builder for chips / relaxations (Manager surfaces pass their own). */
  href?: (q: DiscoveryQuery) => string;
  /** Lazy hydration for a selected marker: return every qualifying result
   * at this Location (bounded) instead of the paged list. */
  focusLocation?: string | null;
  /** Compute filter availability (default true; internal relaxation counts
   * skip it). */
  facets?: boolean;
}

export function namesFor(vocab: Vocabulary, brandNames: Record<string, string> = {}, extra: Partial<ChipNames> = {}): ChipNames {
  const taxonomy: Record<string, string> = {};
  for (const t of vocab.taxonomyById.values()) taxonomy[t.slug] = t.name;
  return {
    taxonomy,
    topics: Object.fromEntries(vocab.topicRows.map((t) => [t.slug, t.name])),
    areas: Object.fromEntries(vocab.areaRows.map((a) => [a.slug, a.name])),
    markets: Object.fromEntries(vocab.marketRows.map((m) => [m.slug, m.name])),
    brands: brandNames,
    ...extra,
  };
}

function toCard(r: RankedMapItem, now: Date, featureId: string): MapResultCard {
  const i = r.item;
  const brand = i.kind === "place" ? null : (i.brands[0] ?? null);
  return {
    key: i.key,
    kind: i.kind,
    title: i.title,
    href: i.href,
    image: i.image ?? i.location.cover,
    logo: i.kind === "place" ? i.location.logo : (brand?.logo ?? null),
    brand: brand ? { name: brand.name, slug: brand.slug } : null,
    brandCount: i.brands.length,
    place: { id: i.location.id, name: i.location.name, href: i.location.slug ? `/location/${i.location.slug}` : null, city: i.location.city },
    when: i.kind === "place" ? "" : formatWhen(i),
    status: mapStatus(i, now),
    distanceKm: r.distanceKm,
    perks: i.benefits.map((b) => BENEFIT_LABELS[b]),
    free: i.is_free === true || i.benefits.includes("free_admission"),
    entry: i.entry.map((e) => ENTRY_LABELS[e]),
    reason: r.reasons[0] ?? null,
    moreDates: i.moreDates ?? 0,
    featureId,
    lng: i.location.lng,
    lat: i.location.lat,
    save: i.kind === "event" && i.eventId ? { type: "event", id: i.eventId, slug: i.eventSlug ?? null } : i.kind === "place" ? { type: "location", id: i.location.id, slug: i.location.slug } : brand ? { type: "business", id: brand.id, slug: brand.slug } : null,
  };
}

async function anyGeocodedLocation(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { count } = await supabase.from("locations").select("id", { count: "exact", head: true }).not("latitude", "is", null);
  return (count ?? 0) > 0;
}

/** Execute a Discovery Query for Map / Feed. */
export async function runMapDiscovery(q: DiscoveryQuery, opts: RunMapOptions = {}): Promise<MapResponse> {
  const now = opts.now ?? new Date();
  const vocab = await getVocabulary();
  // Topics expand into their stored structured queries (same as /search).
  const topics = (q.topics ?? []).map((s) => vocab.topicRows.find((t) => t.slug === s)).filter(Boolean);
  const executed: DiscoveryQuery = { ...q };
  for (const t of topics) {
    for (const [k, v] of Object.entries(t!.query)) {
      if (Array.isArray(v)) (executed as Record<string, unknown>)[k] = [...new Set([...(((executed as Record<string, unknown>)[k] as unknown[]) ?? []), ...v])];
      else if ((executed as Record<string, unknown>)[k] === undefined) (executed as Record<string, unknown>)[k] = v;
    }
  }
  delete executed.topics;
  if (executed.area && !executed.market) executed.market = vocab.areaRows.find((a) => a.slug === executed.area)?.market;

  const [{ items: candidates, truncated }, mapReady] = await Promise.all([loadMapItems(executed, now), opts.countOnly ? Promise.resolve(true) : anyGeocodedLocation()]);
  // A `place` query was already narrowed to that Location (+ children) in
  // the database; every candidate's Location is in scope.
  const placeIds = executed.place ? new Set(candidates.map((i) => i.location.id)) : undefined;
  const matched = candidates.filter((i) => matchesMapItem(i, executed, { now, placeIds }));
  const facets = opts.facets === false ? undefined : mapFacets(candidates, executed, { now, placeIds });

  const brandNames: Record<string, string> = {};
  for (const i of candidates) for (const b of i.brands) brandNames[b.slug] = b.name;
  if (q.brands?.some((s) => !brandNames[s])) {
    const supabase = getSupabase();
    const { data } = supabase ? await supabase.from("businesses").select("slug, name").in("slug", q.brands).eq("is_demo", false) : { data: [] };
    for (const b of (data ?? []) as { slug: string; name: string }[]) brandNames[b.slug] = b.name;
  }
  const placeName = q.place ? (candidates.find((i) => i.location.slug === q.place)?.location.name ?? null) : null;
  const names = namesFor(vocab, brandNames, placeName ? { places: { [q.place!]: placeName } } : {});

  const center = executed.bbox ? bboxCenter(executed.bbox as Bbox) : null;
  const labels = matchLabels(q, names);
  const ranked = matched.map((i) => rankMapItem(i, { now, center, nearMe: Boolean(q.near), personal: opts.personal ?? null, matchLabels: labels })).sort(compareRankedMap);
  const { items, overflow } = diversify(ranked, executed);
  const total = items.length;
  const href = opts.href ?? ((next: DiscoveryQuery) => mapHref(next, opts.view));
  if (opts.countOnly) {
    return { query: q, total, features: [], results: [], nextOffset: null, overflow: [], chips: [], relaxations: [], truncated, mapReady, facets, generatedAt: now.toISOString() };
  }

  const features = mapFeatures(items, executed, now);
  const featureOf = new Map<string, string>();
  for (const f of features) for (const k of f.keys) featureOf.set(k, f.id);
  const offset = q.offset ?? 0;
  const limit = q.limit ?? PAGE_SIZE;
  const page = opts.focusLocation ? items.filter((r) => r.item.location.id === opts.focusLocation).slice(0, 30) : items.slice(offset, offset + limit);
  const results = page.map((r) => toCard(r, now, featureOf.get(r.item.key) ?? `loc:${r.item.location.id}`));
  const chips = queryChips(q, names).map((c: QueryChip) => ({ key: c.key, label: c.label, href: href(c.without) }));

  let relaxations: MapResponse["relaxations"] = [];
  if (total === 0 && mapReady) {
    const candidatesQ = relaxationCandidates(q, names).slice(0, 6);
    const counts = await Promise.all(candidatesQ.map((c) => runMapDiscovery(c.query, { now, countOnly: true, facets: false }).then((r) => r.total)));
    relaxations = candidatesQ.map((c, i) => ({ label: c.label, count: counts[i], href: href(c.query) })).filter((r) => r.count > 0);
  }
  return {
    query: q,
    total,
    features,
    results,
    nextOffset: !opts.focusLocation && offset + limit < total ? offset + limit : null,
    overflow: overflow.slice(0, 3).map((o) => ({ name: o.brand.name, slug: o.brand.slug, total: o.total, href: href({ ...q, brands: [o.brand.slug], offset: undefined }) })),
    chips,
    relaxations,
    truncated,
    mapReady,
    facets,
    generatedAt: now.toISOString(),
  };
}

/** Viewer signals for ranking — only from their own follows/saves, only
 * when Personalized Discovery is on (Privacy Choices), never persisted. */
export async function getMapPersonalSignals(): Promise<PersonalSignals | null> {
  const p = await getPersonalContext();
  return p ? { followedIds: p.followedIds, savedIds: p.savedIds } : null;
}
