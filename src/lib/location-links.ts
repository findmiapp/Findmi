// Public Location links — ONE rule for every public surface that links a
// canonical Location: a public Location page exists only for a LISTED
// Location (getLocationBySlug requires is_demo = false). An unlisted one
// (is_demo = true — e.g. created by Missing-Location Quick Create, waiting
// for Admin review) is still shown by name / address, but never linked,
// so no public page can render a link that 404s. Once Admin lists it, the
// same Location links normally again. Archived / trashed Locations are
// already invisible to public reads (RLS). `is_demo` absent (a row read
// without that column) keeps the previous behavior.
export function publicLocationHref(location: { slug?: string | null; is_demo?: boolean | null } | null | undefined): string | null {
  if (!location?.slug || location.is_demo === true) return null;
  return `/location/${location.slug}`;
}
