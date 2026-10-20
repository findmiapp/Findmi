// JerseyCity.guide — product-layer config. JC reuses Findmi's data layer
// (lib/data.ts) but none of its public UI; everything JC-specific that
// isn't a component or route lives here.

/** Jersey City is an Area under the North Jersey Market. Neighborhoods are
 * (future) child Areas of it — see getJcScope in ./data.ts. */
export const JC_MARKET_SLUG = "north-jersey";
export const JC_AREA_SLUG = "jersey-city";

/** Canonical Census Place for Jersey City, NJ (census_geographies). JC
 * scope = the curated Jersey City Area (and its child neighborhoods) OR
 * this canonical place — never free-text city matching. */
export const JC_GEO_PLACE_KEY = "place:3436000";

export const JC_SITE_URL = "https://jerseycity.guide";
export const JC_BASE = "/jc";

/** Every JC link goes through this, so the domain rewrite in next.config
 * stays the single place that knows about the /jc prefix. */
export function jcHref(path = ""): string {
  if (!path || path === "/") return JC_BASE;
  return `${JC_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

/** A discovery module renders only when it has at least this many items.
 * Never pad a rail to look full. */
export const MIN_RAIL_ITEMS = 3;

/** Home modules — JC's editorial choice of which Findmi categories to
 * feature. Event modules name categories at whatever level JC means; a
 * top-level category automatically includes all of its current and future
 * subcategories via Findmi's shared hierarchy rule (see
 * resolveEventCategorySlugs in ./data.ts). Location categories are flat. */
export const PLACE_MODULES = [
  { key: "eat-drink", title: "Eat & Drink", slugs: ["restaurant", "bar-lounge", "brewery-taproom"] },
  { key: "coffee", title: "Coffee", slugs: ["cafe-coffee-shop"] },
] as const;

export const EVENT_MODULES = [
  { key: "pop-ups", title: "Pop-Ups & Markets", slugs: ["shopping-retail", "local-festivals-street-fairs"] },
  { key: "things-to-do", title: "Things To Do", slugs: ["arts-culture", "entertainment", "music-nightlife", "workshops-classes", "sports-fitness"] },
] as const;

export const PLACE_FILTERS = [
  { slug: "", label: "All" },
  { slug: "restaurant", label: "Restaurants" },
  { slug: "cafe-coffee-shop", label: "Coffee" },
  { slug: "bar-lounge", label: "Bars" },
  { slug: "park-outdoor-space", label: "Outdoors" },
  { slug: "retail-store", label: "Shops" },
  { slug: "gallery", label: "Galleries" },
] as const;

export const EVENT_WINDOWS = [
  { slug: "", label: "Upcoming" },
  { slug: "today", label: "Today" },
  { slug: "weekend", label: "This Weekend" },
  { slug: "week", label: "This Week" },
] as const;

/** Development-only preview fixtures (./preview-fixture.ts). Opt-in via
 * JC_PREVIEW_FIXTURES=1 and hard-disabled on a Vercel production
 * deployment, so fake content can never reach the live site. */
export function jcPreviewEnabled(): boolean {
  if (process.env.VERCEL_ENV === "production") return false;
  return process.env.JC_PREVIEW_FIXTURES === "1";
}
