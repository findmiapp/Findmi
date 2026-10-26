import "server-only";
import { getSupabase } from "@/lib/supabase";
import { getEventsDiscoveryRows, getFindMiHereFeed, getLocations, searchBusinesses, type AppearanceFeedItem, type EventDiscoveryParams, type LocationsDiscoveryOptions, type SearchBusinessesParams } from "@/lib/data";
import { isEventHappeningNow } from "@/lib/event-filter";
import { eventHref } from "@/lib/event-links";
import { calendarDate, formatWhen } from "@/lib/event-time";
import { isLocationDiscoverable } from "@/lib/location-eligibility";
import { geoPlace, inBbox, placeResult, type GeoPlace, type GeoResponse, type GeoResult } from "@/lib/geo-results";
import type { Bbox } from "@/lib/discovery/map-core";

// Map Everywhere — server projections. Each archive's Map reads the SAME
// data function (same filters, same order) its List pages through, then
// keeps only what resolves to a real Location. Nothing here invents a
// coordinate, a Brand location or a Product's availability.

/** How many results one archive Map draws (the List pages; a map of a
 * bigger set asks the viewer to zoom / Search This Area). */
export const GEO_LIMIT = 500;

type Row = Record<string, unknown>;
const LOC_COLS = "id, name, slug, address, city, state, latitude, longitude, is_demo, logo_url, cover_image_url, archived_at, trashed_at";

const dated = (r: Row) => r as unknown as Parameters<typeof formatWhen>[0];
const placeOf = (l: Row | null | undefined): GeoPlace | null => (l ? geoPlace(l as Parameters<typeof geoPlace>[0], { linkable: isLocationDiscoverable(l as Parameters<typeof isLocationDiscoverable>[0]) }) : null);

function respond(all: number, results: GeoResult[], truncated = false): GeoResponse {
  return { results, total: all, truncated };
}

async function locationsById(ids: string[]): Promise<Map<string, Row>> {
  const supabase = getSupabase();
  const out = new Map<string, Row>();
  const want = [...new Set(ids.filter(Boolean))];
  if (!supabase || !want.length) return out;
  for (let i = 0; i < want.length; i += 150) {
    const { data } = await supabase.from("locations").select(LOC_COLS).in("id", want.slice(i, i + 150));
    for (const r of (data ?? []) as Row[]) if (!r.archived_at && !r.trashed_at && r.is_demo !== true) out.set(r.id as string, r);
  }
  return out;
}

// ---------------------------------------------------------------- Events

/** Event → its date shown by the archive (the active lens picks it) →
 * that date's Location. One result per Event, as the List shows it; an
 * Event whose organizer withholds the venue has no Location here. */
export async function eventGeo(params: EventDiscoveryParams): Promise<GeoResponse> {
  const rows = await getEventsDiscoveryRows(params);
  const out: GeoResult[] = [];
  for (const r of rows.slice(0, GEO_LIMIT)) {
    const place = placeOf(r.occurrenceLocation as unknown as Row);
    if (!place) continue;
    const live = isEventHappeningNow(r.effectiveStart, r.effectiveEnd);
    const when = r.occurrence ? formatWhen(r.occurrence) : (calendarDate(r.event) ?? "");
    out.push({
      key: `ev:${r.event.id}`,
      kind: "event",
      title: r.event.name,
      // The date is the status line; the subtitle says where.
      subtitle: place.name || null,
      href: eventHref(r.event.slug, r.occurrence?.id ?? null),
      image: r.event.cover_image_url ?? null,
      logo: null,
      status: live ? "LIVE" : when || null,
      live,
      place,
    });
  }
  return respond(rows.length, out, rows.length > GEO_LIMIT);
}

// ---------------------------------------------------------------- Places

export async function placeGeo(options: LocationsDiscoveryOptions): Promise<GeoResponse> {
  const locations = await getLocations({ ...options, limit: GEO_LIMIT });
  const out: GeoResult[] = [];
  for (const l of locations) {
    const place = placeOf(l as unknown as Row);
    if (!place) continue;
    const category = (l as { category?: { name?: string } | null }).category?.name ?? null;
    out.push({ key: `loc:${l.id}`, kind: "place", title: l.name, subtitle: [category, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null, href: `/location/${l.slug}`, image: l.cover_image_url ?? null, logo: l.logo_url ?? null, status: category, live: false, place });
  }
  return respond(locations.length, out, locations.length >= GEO_LIMIT);
}

// ---------------------------------------------------------------- Brands

export interface BrandPresence {
  businessId: string;
  place: GeoPlace;
  /** Why the Brand is here, in words. */
  relation: "Operates Here" | "Available Here" | "Pop-Up";
  when: string | null;
  live: boolean;
}

/** A Brand's public geography: Locations it operates (business_locations),
 * Locations where it is genuinely Available Here (live, in-effect
 * availability) and its upcoming Pop-Ups (appearances at a Location). No
 * headquarters point unless one of those real relationships exists. */
export async function brandPresence(businessIds: string[], now = new Date()): Promise<BrandPresence[]> {
  const supabase = getSupabase();
  const ids = [...new Set(businessIds)];
  if (!supabase || !ids.length) return [];
  const today = now.toISOString().slice(0, 10);
  const [ops, avail, apps] = await Promise.all([
    supabase.from("business_locations").select("business_id, location_id").in("business_id", ids),
    supabase.from("business_location_availability").select("business_id, location_id").in("business_id", ids).eq("status", "live").or(`starts_on.is.null,starts_on.lte.${today}`).or(`ends_on.is.null,ends_on.gte.${today}`),
    supabase.from("appearances").select("id, business_id, location_id, start_at, end_at, timezone, status").in("business_id", ids).neq("status", "canceled").gt("end_at", now.toISOString()).not("location_id", "is", null).order("start_at").limit(GEO_LIMIT),
  ]);
  const opRows = (ops.data ?? []) as Row[];
  const availRows = avail.error ? [] : ((avail.data ?? []) as Row[]);
  const appRows = (apps.data ?? []) as Row[];
  const locs = await locationsById([...opRows, ...availRows, ...appRows].map((r) => r.location_id as string));
  const out: BrandPresence[] = [];
  const seen = new Set<string>();
  const add = (businessId: string, locationId: string, relation: BrandPresence["relation"], when: string | null = null, live = false) => {
    const place = placeOf(locs.get(locationId));
    const k = `${businessId}@${locationId}`;
    if (!place || seen.has(k)) return;
    seen.add(k);
    out.push({ businessId, place, relation, when, live });
  };
  for (const r of opRows) add(r.business_id as string, r.location_id as string, "Operates Here");
  for (const r of availRows) add(r.business_id as string, r.location_id as string, "Available Here");
  for (const r of appRows) add(r.business_id as string, r.location_id as string, "Pop-Up", formatWhen(dated(r)) || null, isEventHappeningNow(r.start_at as string, r.end_at as string));
  return out;
}

/** Brand presence → map results, one per Brand × Location (a Brand at
 * three Locations is three honest markers; several Brands at one Location
 * fold into one marker there). */
export function brandResults(brands: { id: string; slug: string; name: string; logo_url?: string | null; cover_image_url?: string | null }[], presence: BrandPresence[]): GeoResult[] {
  const byId = new Map(brands.map((b) => [b.id, b]));
  const out: GeoResult[] = [];
  for (const p of presence) {
    const b = byId.get(p.businessId);
    if (!b) continue;
    out.push({ key: `br:${b.id}@${p.place.id}`, kind: "brand", title: b.name, subtitle: p.live || p.when ? `${p.relation} · ${p.place.name}` : p.place.name, href: `/business/${b.slug}`, image: b.cover_image_url ?? null, logo: b.logo_url ?? null, status: p.live ? "LIVE" : p.when ?? p.relation, live: p.live, place: p.place });
  }
  return out;
}

export async function brandGeo(params: SearchBusinessesParams, bbox: Bbox | null): Promise<GeoResponse> {
  const brands = await searchBusinesses({ ...params, limit: GEO_LIMIT });
  const presence = await brandPresence(brands.map((b) => b.id));
  const inArea = bbox ? presence.filter((p) => inBbox(p.place.lat, p.place.lng, bbox)) : presence;
  const total = bbox ? new Set(inArea.map((p) => p.businessId)).size : brands.length;
  return respond(total, brandResults(brands, inArea), brands.length >= GEO_LIMIT);
}

/** Brands (in their List order) with at least one real presence inside
 * the bounds — Search This Area for the Brands archive. */
export async function brandsInBbox<T extends { id: string }>(brands: T[], bbox: Bbox): Promise<T[]> {
  const presence = await brandPresence(brands.map((b) => b.id));
  const hit = new Set(presence.filter((p) => inBbox(p.place.lat, p.place.lng, bbox)).map((p) => p.businessId));
  return brands.filter((b) => hit.has(b.id));
}

// ---------------------------------------------------------------- Pop-Ups (Findmi Here)

export async function appearanceResults(items: AppearanceFeedItem[]): Promise<GeoResult[]> {
  const locs = await locationsById(items.map((i) => i.location_id ?? "").filter(Boolean));
  const out: GeoResult[] = [];
  for (const a of items) {
    const place = placeOf(a.location_id ? locs.get(a.location_id) : null);
    if (!place) continue;
    const live = isEventHappeningNow(a.start_at, a.end_at);
    const when = formatWhen(dated(a as unknown as Row)) || null;
    out.push({ key: `app:${a.id}`, kind: "appearance", title: a.business.name, subtitle: [a.title && a.title !== a.business.name ? a.title : null, place.name].filter(Boolean).join(" · ") || null, href: `/business/${a.business.slug}`, image: a.business.cover_image_url ?? null, logo: a.business.logo_url, status: live ? "LIVE" : when, live, place });
  }
  return out;
}

export async function appearanceGeo(...args: Parameters<typeof getFindMiHereFeed>): Promise<{ items: AppearanceFeedItem[]; geo: GeoResponse }> {
  const items = await getFindMiHereFeed(...args);
  const results = await appearanceResults(items);
  return { items, geo: respond(items.length, results) };
}

/** Pop-Ups whose Location is inside the bounds (Search This Area). */
export async function appearancesInBbox(items: AppearanceFeedItem[], bbox: Bbox): Promise<AppearanceFeedItem[]> {
  const inside = new Set((await appearanceResults(items)).filter((r) => inBbox(r.place.lat, r.place.lng, bbox)).map((r) => r.key));
  return items.filter((i) => inside.has(`app:${i.id}`));
}

// ---------------------------------------------------------------- detail pages

/** Where To Find It — a Product's real public geography only: Locations
 * where its Brand is Available Here AND this Product is named in that
 * availability, upcoming Event dates that feature it (event_products), and
 * Pop-Ups offering it for pickup (fulfillment appearance_id). Never every
 * Location of the Brand. */
export async function productPlaces(productId: string, now = new Date()): Promise<GeoResult[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const [availP, evP, pickup] = await Promise.all([
    supabase.from("business_location_availability_products").select("availability_id").eq("product_id", productId),
    supabase.from("event_products").select("event_id").eq("product_id", productId),
    supabase.from("product_fulfillment_options").select("appearance_id").eq("product_id", productId).eq("enabled", true).not("appearance_id", "is", null),
  ]);
  const availIds = ((availP.data ?? []) as Row[]).map((r) => r.availability_id as string);
  const eventIds = ((evP.data ?? []) as Row[]).map((r) => r.event_id as string);
  const appIds = ((pickup.data ?? []) as Row[]).map((r) => r.appearance_id as string);
  const [avail, occs, apps] = await Promise.all([
    availIds.length ? supabase.from("business_location_availability").select("id, location_id").in("id", availIds).eq("status", "live").or(`starts_on.is.null,starts_on.lte.${today}`).or(`ends_on.is.null,ends_on.gte.${today}`) : Promise.resolve({ data: [] }),
    eventIds.length ? supabase.from("event_occurrences").select("id, event_id, location_id, start_at, end_at, occurrence_date, timezone, event:events!inner(slug, name, is_demo, location_visibility)").in("event_id", eventIds).eq("status", "scheduled").or(`end_at.gte.${nowIso},and(end_at.is.null,occurrence_date.gte.${today})`).not("location_id", "is", null).order("start_at").limit(50) : Promise.resolve({ data: [] }),
    appIds.length ? supabase.from("appearances").select("id, location_id, start_at, end_at, timezone, title, business:businesses!appearances_business_id_fkey(slug, name)").in("id", appIds).neq("status", "canceled").gt("end_at", nowIso).not("location_id", "is", null) : Promise.resolve({ data: [] }),
  ]);
  const availRows = (avail.data ?? []) as Row[];
  const occRows = ((occs.data ?? []) as Row[]).filter((o) => {
    const ev = (Array.isArray(o.event) ? o.event[0] : o.event) as Row | null;
    return ev && ev.is_demo !== true && ev.location_visibility !== "hidden";
  });
  const appRows = (apps.data ?? []) as Row[];
  const locs = await locationsById([...availRows, ...occRows, ...appRows].map((r) => r.location_id as string));
  const out: GeoResult[] = [];
  const seen = new Set<string>();
  const push = (r: GeoResult | null) => {
    if (r && !seen.has(r.key)) {
      seen.add(r.key);
      out.push(r);
    }
  };
  for (const a of availRows) {
    const place = placeOf(locs.get(a.location_id as string));
    if (place) push({ key: `avail:${place.id}`, kind: "product", title: place.name, subtitle: "Available Here", href: place.href ?? "", image: null, logo: null, status: "Available Here", live: false, place });
  }
  for (const o of occRows) {
    const ev = (Array.isArray(o.event) ? o.event[0] : o.event) as Row;
    const place = placeOf(locs.get(o.location_id as string));
    const live = isEventHappeningNow(o.start_at as string, o.end_at as string);
    const when = formatWhen(dated(o)) || null;
    if (place) push({ key: `ev:${ev.slug}@${place.id}`, kind: "event", title: ev.name as string, subtitle: [when, place.name].filter(Boolean).join(" · "), href: eventHref(ev.slug as string, o.id as string), image: null, logo: null, status: live ? "LIVE" : when, live, place });
  }
  for (const a of appRows) {
    const b = (Array.isArray(a.business) ? a.business[0] : a.business) as Row | null;
    const place = placeOf(locs.get(a.location_id as string));
    const live = isEventHappeningNow(a.start_at as string, a.end_at as string);
    const when = formatWhen(dated(a)) || null;
    if (place && b) push({ key: `pickup:${a.id}`, kind: "appearance", title: place.name, subtitle: ["Pickup", when].filter(Boolean).join(" · "), href: place.href ?? `/business/${b.slug}`, image: null, logo: null, status: live ? "LIVE" : when, live, place });
  }
  return out;
}

/** An Opportunity listing's place: only its real linked Location (the
 * listing's `place` is that Location). A Market- or Area-wide, remote or
 * nationwide listing has no point on a map. */
export async function opportunityPlace(locationSlug: string | null | undefined, title: string): Promise<GeoResult | null> {
  const supabase = getSupabase();
  if (!supabase || !locationSlug) return null;
  const { data } = await supabase.from("locations").select(LOC_COLS).eq("slug", locationSlug).maybeSingle();
  const l = data as Row | null;
  if (!l || l.archived_at || l.trashed_at || l.is_demo === true) return null;
  return placeResult(l as Parameters<typeof placeResult>[0], { linkable: isLocationDiscoverable(l as Parameters<typeof isLocationDiscoverable>[0]), title });
}

/** A Brand's own page: its real presence as places (Operates Here /
 * Available Here / Pop-Up dates), one result per Location × relation. */
export async function brandPlaceResults(business: { id: string; slug: string }): Promise<GeoResult[]> {
  const presence = await brandPresence([business.id]);
  return presence.map((p) => ({
    key: `br:${business.id}@${p.place.id}`,
    kind: "brand" as const,
    title: p.place.name,
    subtitle: [p.relation, p.when].filter(Boolean).join(" · "),
    href: p.place.href ?? `/business/${business.slug}`,
    image: null,
    logo: null,
    status: p.live ? "LIVE" : (p.when ?? p.relation),
    live: p.live,
    place: p.place,
  }));
}

/** A Brand's Findmi Here schedule (exactly the dates its Cards / List
 * show) as map results: each date at ITS OWN linked Location. A date with
 * no linked Location, or whose Event withholds the venue, isn't drawn. */
export async function scheduleResults(
  items: { id: string; title: string; start_at: string; end_at: string | null; location_id: string | null; location_hidden?: boolean; event_id?: string | null; event_occurrence_id?: string | null; event?: { slug: string } | null }[],
  business: { slug: string; name: string; logo_url?: string | null }
): Promise<GeoResult[]> {
  const mappable = items.filter((a) => a.location_id && !a.location_hidden);
  const locs = await locationsById(mappable.map((a) => a.location_id as string));
  const out: GeoResult[] = [];
  for (const a of mappable) {
    const place = placeOf(locs.get(a.location_id as string));
    if (!place) continue;
    const live = isEventHappeningNow(a.start_at, a.end_at);
    const when = formatWhen(dated(a as unknown as Row)) || null;
    out.push({
      key: `app:${a.id}`,
      kind: "appearance",
      title: place.name,
      subtitle: a.title && a.title !== business.name ? a.title : null,
      href: a.event?.slug ? eventHref(a.event.slug, a.event_occurrence_id ?? null) : (place.href ?? `/business/${business.slug}`),
      image: null,
      logo: business.logo_url ?? null,
      status: live ? "LIVE" : when,
      live,
      place,
    });
  }
  return out;
}

/** An Event's dates (exactly the occurrences its Upcoming Dates show) as
 * map results: each scheduled date at ITS OWN linked Location — never the
 * parent Event pinned to one place, never an inherited venue. */
export function occurrenceResults(
  occurrences: { id: string; status?: string | null; start_at: string | null; end_at: string | null; location: { id: string; name: string } | null }[],
  event: { slug: string; name: string }
): GeoResult[] {
  const out: GeoResult[] = [];
  for (const o of occurrences) {
    if (o.status && o.status !== "scheduled") continue;
    const place = placeOf(o.location as unknown as Row | null);
    if (!place) continue;
    const live = isEventHappeningNow(o.start_at, o.end_at);
    const when = formatWhen(dated(o as unknown as Row)) || null;
    out.push({ key: `occ:${o.id}`, kind: "event", title: place.name, subtitle: event.name, href: eventHref(event.slug, o.id), image: null, logo: null, status: live ? "LIVE" : when, live, place });
  }
  return out;
}
