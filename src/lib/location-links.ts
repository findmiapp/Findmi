// Public Location links — TWO distinct questions, never mixed:
//
//   DISCOVERY   "may Findmi proactively surface this Location?" — listed AND Logo AND Cover
//               (lib/location-eligibility.ts). Decided by the discovery QUERIES (/locations,
//               Featured, search, Market/Area, rails, sitemap); a Location that fails it never
//               becomes a card in any of them.
//   CONTEXT     "may this reference lead to the Location's page?" — a person who opened an
//               Event, Appearance, Business, Moment or a parent place and wants to know
//               WHERE. Any listed Location has a page (an unfinished one is noindex and shows
//               what Findmi really knows), so a contextual link works whether or not the
//               Location is discovery-ready. An UNLISTED Location (is_demo) has no public page,
//               so it is shown by name / address only.
//
// `publicLocationHref` is the CONTEXT link — the one helper every contextual reference uses.
export function publicLocationHref(
  location: { slug?: string | null; is_demo?: boolean | null } | null | undefined
): string | null {
  if (!location?.slug || location.is_demo === true) return null;
  return `/location/${location.slug}`;
}
