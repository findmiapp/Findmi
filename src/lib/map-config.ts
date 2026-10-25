// Discovery Map — client-safe map configuration. The basemap is MapLibre GL
// (open-source WebGL renderer: native clustering, symbol/icon layers,
// no per-load vendor fee) on a vector style. The default style is
// OpenFreeMap's keyless public "positron" — a subdued light basemap so
// Findmi's own content is the interface. Any MapLibre-compatible style can
// be swapped in with NEXT_PUBLIC_MAP_STYLE_URL (e.g. a MapTiler / Stadia
// style URL whose public key is domain-restricted by that provider); the
// CSP in next.config.mjs allows exactly that URL's origin.

import type { Bbox } from "@/lib/discovery/map-core";

export const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/positron";

/** Glyph font stack used for marker labels — must exist on the style's
 * glyph server (OpenFreeMap serves Noto Sans). Override alongside a
 * different style with NEXT_PUBLIC_MAP_LABEL_FONT. */
export const MAP_LABEL_FONT = (process.env.NEXT_PUBLIC_MAP_LABEL_FONT || "Noto Sans Regular").split(",").map((s) => s.trim());
export const MAP_LABEL_FONT_BOLD = MAP_LABEL_FONT.map((f) => f.replace(/Regular$/, "Bold"));

/** Where the map opens when the URL names no place and the viewer hasn't
 * shared a location: lower/mid Manhattan (Findmi's launch market). */
export const DEFAULT_MAP_BBOX: Bbox = [-74.025, 40.7, -73.955, 40.77];

/** Near Me radius when the viewer opts in (miles). */
export const NEAR_ME_RADIUS_MILES = 1.5;
