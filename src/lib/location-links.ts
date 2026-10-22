import { isLocationDiscoverable } from "./location-eligibility";

// Public Location links — ONE rule for every public surface that links a
// canonical Location: a Location is linked as a consumer Location only when it is
// discoverable (lib/location-eligibility.ts: listed AND both Logo and Cover Image).
// Otherwise it is still shown by name / address in context, but never linked as a
// Location card/link. (Its direct /location/[slug] URL, if one exists, keeps working —
// see getLocationBySlug — so shared links and printed QR codes never break; the page
// is simply kept out of discovery and search engines.) Archived / trashed Locations
// are already invisible to public reads (RLS). The image keys are REQUIRED in the type
// so a caller that doesn't read them fails to compile rather than silently linking.
export function publicLocationHref(
  location: { slug?: string | null; is_demo?: boolean | null; logo_url: string | null | undefined; cover_image_url: string | null | undefined } | null | undefined
): string | null {
  if (!location?.slug || !isLocationDiscoverable(location)) return null;
  return `/location/${location.slug}`;
}
