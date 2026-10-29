// Moments on the map — pure (client + server + tests). Turns Moment cards
// that carry a real `geo` (lib/moment-discovery: the Moment's Location, or a
// connected Event date's Location) into the SAME MapFeature markers /map and
// every contextual map draw (components/map/DiscoveryMapCanvas — one map
// engine, its clustering and summed counts). One marker per Location: its
// count is the number of Moments there; clusters sum those counts. Moments
// without a geo are simply not on the map — never geocoded or guessed.

import type { Bbox, MapFeature } from "./discovery/map-core";
import type { MomentGeo } from "./moment-discovery";

export interface MapMoment {
  id: string;
  title: string;
  geo: MomentGeo | null;
}

export function momentMapFeatures(moments: readonly MapMoment[]): MapFeature[] {
  const byLocation = new Map<string, { geo: MomentGeo; ids: string[]; first: MapMoment }>();
  for (const m of moments) {
    if (!m.geo) continue;
    const at = byLocation.get(m.geo.locationId);
    if (at) at.ids.push(m.id);
    else byLocation.set(m.geo.locationId, { geo: m.geo, ids: [m.id], first: m });
  }
  return [...byLocation.values()].map(({ geo, ids, first }) => ({
    id: `moments:${geo.locationId}`,
    lng: geo.lng,
    lat: geo.lat,
    count: ids.length,
    label: ids.length === 1 ? first.title : geo.place,
    place: geo.place,
    status: `${ids.length} ${ids.length === 1 ? "Moment" : "Moments"}`,
    live: false,
    tone: "place" as const,
    logo: null,
    locationId: geo.locationId,
    keys: ids,
  }));
}

/** Map frame for the Moments shown (null when none is on the map). */
export function momentMapBounds(features: readonly MapFeature[], pad = 0.01): Bbox | null {
  if (features.length === 0) return null;
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const f of features) {
    w = Math.min(w, f.lng);
    e = Math.max(e, f.lng);
    s = Math.min(s, f.lat);
    n = Math.max(n, f.lat);
  }
  return [w - pad, s - pad, e + pad, n + pad];
}

/** How many of these Moments can be placed on the map. */
export const mappableCount = (moments: readonly MapMoment[]) => moments.filter((m) => m.geo).length;
