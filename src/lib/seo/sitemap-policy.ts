/** Pure sitemap rules (tested in tests/index-hygiene.test.mjs).
 *
 * Static paths: only indexable editorial/discovery landing pages. Never a
 * noindex family (search, account, creation, checkout, …). */
export const SITEMAP_STATIC_PATHS = [
  "",
  "/discover",
  "/businesses",
  "/events",
  "/locations",
  "/moments",
  "/marketplace",
  "/join",
  "/join/business",
  "/about",
  "/privacy",
  "/terms",
] as const;

/** The URL a Business/Event/Location page declares as its canonical: its
 * public handle when it has one (see resolveCanonicalUrl in the public
 * views), else its typed slug route. */
export function canonicalEntityPath(type: "business" | "event" | "location", slug: string, handle: string | null | undefined): string {
  return handle ? `/${handle}` : `/${type}/${slug}`;
}
