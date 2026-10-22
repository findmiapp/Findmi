import { hasUsableImageUrl } from "./featured-locations";

/** Location CONSUMER-DISCOVERY eligibility — one rule, one place.
 *
 * A Location may appear as a Location card / result / link on a consumer discovery
 * surface only when it is (a) publicly listed (`is_demo = false`) AND (b) has BOTH a
 * usable Logo and a usable Cover Image. Everything about a Location that is NOT
 * consumer discovery is untouched: an incomplete Location is a full citizen of the
 * Findmi graph — it can be created, imported, matched, deduplicated, picked for an
 * Event or Appearance, attached to a Business's Find Us Here, managed and administered.
 * If it is attached to a public Event / Appearance / Business, that relationship is
 * kept and its name/address is still shown in context — it just isn't rendered as a
 * clickable Location card or link. Add the missing image and it becomes eligible again
 * automatically (and loses eligibility again if either image is removed): nothing is
 * stored or deleted, the rule is evaluated from the Location's own columns.
 *
 * "Usable" means the image can actually RENDER on Findmi, decided from the stored value
 * alone (no network call on a request): the shared check (non-blank http(s) URL or site
 * path; the literal strings "null"/"undefined" that bad imports leave behind are rejected)
 * AND a location the app is configured to display — Findmi's own Supabase Storage public
 * objects, the other hosts next.config.js / the CSP allow (Unsplash, Tally's CDN), or a
 * site path. A string that merely LOOKS like an image URL on any other host would render
 * as a blank dark card (the browser's CSP refuses it), so it does not count.
 *
 * Use this module for every consumer Location query/render decision — do not write
 * `logo && cover` checks in components. */

export interface LocationDiscoveryFields {
  is_demo?: boolean | null;
  logo_url?: string | null;
  cover_image_url?: string | null;
}

/** The places an image may be served from — the SAME list as next.config.js
 * `images.remotePatterns` and the CSP `img-src`. Supabase objects must be PUBLIC storage
 * objects (`/storage/v1/object/public/…`): signed/private or API URLs don't render. */
const RENDERABLE_IMAGE_URL = [
  /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/[^\s]+$/i,
  /^https:\/\/images\.unsplash\.com\/[^\s]+$/i,
  /^https:\/\/([a-z0-9-]+\.)*tally\.so\/[^\s]+$/i,
  /^\/[^\s/][^\s]*$/,
];

/** A stored image value Findmi can actually display (see the module note). */
export function isRenderableImageUrl(url: string | null | undefined): url is string {
  if (!hasUsableImageUrl(url)) return false;
  const value = url.trim();
  return RENDERABLE_IMAGE_URL.some((re) => re.test(value));
}

/** Both images present and renderable. */
export function hasDiscoveryImagery(location: LocationDiscoveryFields | null | undefined): boolean {
  return Boolean(location) && isRenderableImageUrl(location?.logo_url) && isRenderableImageUrl(location?.cover_image_url);
}

/** Listed AND fully imaged. An unlisted (`is_demo`) Location is never discoverable. */
export function isLocationDiscoverable(location: LocationDiscoveryFields | null | undefined): boolean {
  return Boolean(location) && location?.is_demo !== true && hasDiscoveryImagery(location);
}

/** Narrows already-loaded rows (the exact, in-memory form of the rule). */
export function discoverableLocations<T extends LocationDiscoveryFields>(rows: readonly T[]): T[] {
  return rows.filter((r) => isLocationDiscoverable(r));
}

/** The database form of the rule, so a `limit()` is applied to ELIGIBLE rows (an
 * incomplete Location can never displace a complete one). Same allowed locations as
 * RENDERABLE_IMAGE_URL; the in-memory predicate above stays the exact guard for anything
 * a LIKE pattern can't express. `query` is any PostgREST filter builder on `locations`. */
export const RENDERABLE_IMAGE_LIKE_PATTERNS = [
  "https://%.supabase.co/storage/v1/object/public/%",
  "https://images.unsplash.com/%",
  "https://%.tally.so/%",
  "/%",
] as const;

const imageColumnFilter = (column: string) => RENDERABLE_IMAGE_LIKE_PATTERNS.map((p) => `${column}.ilike.${p}`).join(",");

export function applyLocationDiscoveryFilter(query: any): any {
  return query.eq("is_demo", false).or(imageColumnFilter("logo_url")).or(imageColumnFilter("cover_image_url"));
}
