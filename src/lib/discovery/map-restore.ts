// Map Discovery Batch 2 — returning to a map restores its discovery
// context (pure, client-safe, testable).
//
// /map: the URL is the Discovery Query (filters, search, time, queried
// area, List / Map) and the history ENTRY carries the rest — camera,
// selected result (its floating preview), sheet position — written with
// the replaceState /map already uses. Back / Forward (browser, mobile
// Safari, the header's back arrow → router.back()) land on that entry.
// Nothing about a Near Me position is ever stored.
//
// Archives (Events, Locations, Businesses, Findmi Here): their URL already
// carries filters, view and `bbox`; a short-lived per-result-set hint in
// sessionStorage (the archive shell's existing pattern) carries the camera,
// selection and sheet.
//
// A restored selection is only applied if that marker is still in the
// result set — otherwise the viewport and filters stay and the selection
// is quietly dropped.

import type { Bbox } from "./map-core";
import { mapView, paramsToQuery, queryKey, type DiscoveryQuery } from "./query";
import { hasGeo } from "./search-state";

export type RestoredSheet = "peek" | "browse" | "expanded";
const SHEETS: RestoredSheet[] = ["peek", "browse", "expanded"];

export function validBbox(v: unknown): Bbox | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [w, s, e, n] = v as number[];
  return w < e && s < n && w >= -180 && e <= 180 && s >= -90 && n <= 90 ? [w, s, e, n] : null;
}

// ---------------------------------------------------------------- /map

export const MAP_ENTRY_KEY = "findmiMap";

export interface MapEntry {
  v: 1;
  /** The Discovery Query this entry belongs to (queryKey, no offset). */
  key: string;
  viewport: Bbox | null;
  selected: string | null;
  sheet: RestoredSheet;
  /** Filters the typed search contributed (so Clear still removes them). */
  derived?: Partial<DiscoveryQuery>;
}

const keyOf = (q: DiscoveryQuery) => queryKey({ ...q, offset: undefined });

function readEntry(state: unknown, key: string): MapEntry | null {
  const raw = state && typeof state === "object" ? (state as Record<string, unknown>)[MAP_ENTRY_KEY] : null;
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Partial<MapEntry>;
  if (e.v !== 1 || e.key !== key) return null;
  return {
    v: 1,
    key,
    viewport: validBbox(e.viewport),
    selected: typeof e.selected === "string" ? e.selected : null,
    sheet: SHEETS.includes(e.sheet as RestoredSheet) ? (e.sheet as RestoredSheet) : "peek",
    derived: e.derived && typeof e.derived === "object" ? e.derived : undefined,
  };
}

/** Where /map starts: the history entry's own URL wins over the server's
 * first render (on Back, Next may hand the page the query it was FIRST
 * rendered with, while the entry's URL holds the filters chosen since);
 * then that entry's camera / selection / sheet. */
export function resumeMap(
  initialQuery: DiscoveryQuery,
  initialView: "map" | "list",
  location: { pathname: string; search: string } | null,
  historyState: unknown
): { query: DiscoveryQuery; view: "map" | "list"; entry: MapEntry | null } {
  let query = initialQuery;
  let view = initialView;
  // A bare /map URL says nothing beyond the server's own first render.
  if (location && location.pathname === "/map" && location.search.replace(/^\?/, "") !== "") {
    const p = new URLSearchParams(location.search);
    const parsed = paramsToQuery(p);
    // Near Me is never resumed from a URL: the page asks again.
    if (!parsed.near) {
      const withGeo: DiscoveryQuery = hasGeo(parsed) ? parsed : { ...parsed, bbox: initialQuery.bbox };
      if (keyOf(withGeo) !== keyOf(initialQuery)) query = withGeo;
    }
    view = mapView(p.get("view"));
  }
  return { query, view, entry: readEntry(historyState, keyOf(query)) };
}

/** The history state to write for the current /map context. */
export function mapEntryState(current: unknown, entry: Omit<MapEntry, "v">): Record<string, unknown> {
  return { ...(current && typeof current === "object" ? (current as Record<string, unknown>) : {}), [MAP_ENTRY_KEY]: { v: 1, ...entry } };
}

// ---------------------------------------------------------------- archives

export const GEO_VIEW_TTL_MS = 30 * 60 * 1000;
export const geoViewStorageKey = (surface: string, key: string) => `findmi-geo-view:${surface}:${key}`;

export interface GeoViewHint {
  key: string;
  viewport: Bbox | null;
  selected: string | null;
  sheet: RestoredSheet;
  t: number;
}

/** A stored archive map context, if it's for this result set and recent. */
export function parseGeoViewHint(raw: string | null, key: string, now = Date.now()): GeoViewHint | null {
  if (!raw) return null;
  try {
    const h = JSON.parse(raw) as Partial<GeoViewHint>;
    if (h.key !== key || typeof h.t !== "number" || now - h.t > GEO_VIEW_TTL_MS || h.t > now + 60_000) return null;
    return {
      key,
      viewport: validBbox(h.viewport),
      selected: typeof h.selected === "string" ? h.selected : null,
      sheet: SHEETS.includes(h.sheet as RestoredSheet) ? (h.sheet as RestoredSheet) : "peek",
      t: h.t,
    };
  } catch {
    return null;
  }
}
