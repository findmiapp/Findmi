// Map Everywhere — the one geographic presentation shape every archive and
// detail map hands the shared renderer (DiscoveryMapCanvas), so no surface
// teaches a map its own schema. Pure and client-safe.
//
// The canonical Location is the only geographic anchor: a result is
// mappable only through a real Location with real coordinates (never an
// invented point, never jitter). Results at the same Location fold into ONE
// marker; the surface decides what that marker represents (Event activity,
// Brand presence, Product availability…).

import { isValidCoordinate, type Bbox, type MapFeature, type MapTone } from "@/lib/discovery/map-core";

export type GeoKind = "event" | "place" | "brand" | "appearance" | "product" | "opportunity";

export interface GeoPlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Public Place page, when the Location is discoverable. */
  href: string | null;
  address: string | null;
}

export interface GeoResult {
  /** Stable key, unique within one result set — also the List item's
   * `data-geo-key`, which is how List ↔ Map selection stays in sync. */
  key: string;
  kind: GeoKind;
  title: string;
  /** One line of context ("Sat, Nov 1 · Eataly Chiosco", "Brand"). */
  subtitle: string | null;
  href: string;
  image: string | null;
  logo: string | null;
  /** Short status words ("LIVE", "Sat, Nov 1") — never color alone. */
  status: string | null;
  live: boolean;
  place: GeoPlace;
}

/** What a geo endpoint returns: the mappable subset of ONE result set, and
 * how big that whole set is (so "73 of 100 on the map" stays honest). */
export interface GeoResponse {
  results: GeoResult[];
  total: number;
  /** The result set was larger than the bound the map reads. */
  truncated: boolean;
}

/** Real Location coordinates → a GeoPlace, or null (unmapped — the result
 * still exists; it just can't be drawn). */
export function geoPlace(l: { id?: string | null; name?: string | null; slug?: string | null; latitude?: unknown; longitude?: unknown; address?: string | null; city?: string | null; state?: string | null } | null | undefined, opts: { linkable?: boolean } = {}): GeoPlace | null {
  if (!l?.id || !isValidCoordinate(l.latitude, l.longitude)) return null;
  const address = [l.address, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null;
  return { id: l.id, name: l.name ?? "", lat: l.latitude as number, lng: l.longitude as number, href: opts.linkable !== false && l.slug ? `/location/${l.slug}` : null, address };
}

/** One marker per canonical Location. A Location holding a single result
 * (or results that all name the same thing) shows that identity; several
 * different results show the Location with their count. */
export function geoFeatures(results: readonly GeoResult[], opts: { promote?: number } = {}): MapFeature[] {
  const byPlace = new Map<string, GeoResult[]>();
  const firstAt = new Map<string, number>();
  results.forEach((r, i) => {
    byPlace.set(r.place.id, [...(byPlace.get(r.place.id) ?? []), r]);
    if (!firstAt.has(r.place.id)) firstAt.set(r.place.id, i);
  });
  const out: MapFeature[] = [];
  for (const [placeId, rs] of byPlace) {
    const lead = rs.find((r) => r.live) ?? rs[0];
    const titles = new Set(rs.map((r) => r.title));
    const live = rs.some((r) => r.live);
    const tone: MapTone = live ? "live" : lead.kind === "place" || lead.kind === "brand" ? "place" : "later";
    out.push({
      id: `loc:${placeId}`,
      lng: lead.place.lng,
      lat: lead.place.lat,
      count: rs.length,
      label: titles.size === 1 ? lead.title : lead.place.name || lead.title,
      place: lead.place.name,
      status: live ? "LIVE" : titles.size === 1 ? (lead.status ?? "") : `${rs.length} here`,
      live,
      tone,
      logo: lead.logo,
      locationId: placeId,
      keys: rs.map((r) => r.key).slice(0, 50),
      // The result set's own order (featured-first / soonest / relevance
      // as the archive ranked it), LIVE ahead of everything.
      rank: (live ? 0 : 1000) + (firstAt.get(placeId) ?? 0),
    });
  }
  // A few promoted rich labels tell the map's story before any click; the
  // rest stay compact identity markers / clusters. No new ranking.
  const promote = opts.promote ?? 0;
  if (promote > 0) for (const f of [...out].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).slice(0, promote)) f.promoted = true;
  return out;
}

export function boundsOf(results: readonly { place: { lat: number; lng: number } }[], pad = 0.006): Bbox | null {
  if (!results.length) return null;
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const r of results) {
    w = Math.min(w, r.place.lng);
    e = Math.max(e, r.place.lng);
    s = Math.min(s, r.place.lat);
    n = Math.max(n, r.place.lat);
  }
  return [w - pad, s - pad, e + pad, n + pad];
}

export const inBbox = (lat: number, lng: number, b: Bbox) => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];

/** `bbox=w,s,e,n` (an archive's intentional map area — Search This Area). */
export function parseBboxParam(v: string | string[] | null | undefined): Bbox | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return null;
  const b = s.split(",").map(Number);
  if (b.length !== 4 || !b.every(Number.isFinite)) return null;
  const [w, so, e, n] = b;
  if (!(w < e && so < n) || w < -180 || e > 180 || so < -90 || n > 90) return null;
  return [w, so, e, n];
}
export const bboxParam = (b: Bbox) => b.map((x) => Math.round(x * 1e5) / 1e5).join(",");

/** Archive view modes. List is the lightweight default (never stored in
 * the URL); Split is a desktop presentation. */
export type ViewMode = "list" | "map" | "split";
export function parseViewMode(v: string | string[] | null | undefined): ViewMode {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "map" || s === "split" ? s : "list";
}

/** A single Location as a map result (detail-page maps). */
export function placeResult(l: Parameters<typeof geoPlace>[0] & { logo_url?: string | null }, opts: { linkable?: boolean; title?: string } = {}): GeoResult | null {
  const place = geoPlace(l, { linkable: opts.linkable });
  if (!place) return null;
  return { key: `loc:${place.id}`, kind: "place", title: opts.title ?? place.name, subtitle: place.address, href: place.href ?? "", image: null, logo: l?.logo_url ?? null, status: null, live: false, place };
}
