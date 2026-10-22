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
 * "Usable" is the shared image check (non-blank http(s) URL or site path; the literal
 * strings "null"/"undefined" that bad imports leave behind are rejected).
 *
 * Use this module for every consumer Location query/render decision — do not write
 * `logo && cover` checks in components. */

export interface LocationDiscoveryFields {
  is_demo?: boolean | null;
  logo_url?: string | null;
  cover_image_url?: string | null;
}

/** Both images present and usable. */
export function hasDiscoveryImagery(location: LocationDiscoveryFields | null | undefined): boolean {
  return Boolean(location) && hasUsableImageUrl(location?.logo_url) && hasUsableImageUrl(location?.cover_image_url);
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
 * incomplete Location can never displace a complete one). It matches the usual invalid
 * forms (null, blank, "null"/"undefined", a value that is not an http(s) URL or site
 * path); the in-memory predicate above stays the exact guard for anything it can't
 * express. `query` is any PostgREST filter builder on `locations`. */
export function applyLocationDiscoveryFilter(query: any): any {
  return query
    .eq("is_demo", false)
    .or("logo_url.ilike.http://%,logo_url.ilike.https://%,logo_url.ilike./%")
    .or("cover_image_url.ilike.http://%,cover_image_url.ilike.https://%,cover_image_url.ilike./%");
}
