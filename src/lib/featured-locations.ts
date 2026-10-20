// Homepage Featured Locations — image eligibility. A merchandising rule for
// this ONE carousel (never applied to /locations, /discover or any other
// feed): a Location qualifies only with a real cover image, and its
// "Happening Here" rail only ever lists happenings that have a real image of
// their own. Records without one are skipped here — never hidden or changed
// anywhere else, and never given a placeholder to pass. Pure, no I/O (no
// network image checks at render time): "usable" means a non-empty URL string
// the image component can request.

/** A stored image reference that is worth rendering: a non-blank string that
 * is an http(s) URL or a site-relative path. Rejects null/undefined/blank and
 * the literal strings "null"/"undefined" that bad imports leave behind. */
export function hasUsableImageUrl(url: string | null | undefined): url is string {
  if (typeof url !== "string") return false;
  const value = url.trim();
  if (!value || /^(null|undefined)$/i.test(value)) return false;
  return /^https?:\/\//i.test(value) || value.startsWith("/");
}

interface FeaturedCandidate {
  cover_image_url: string | null;
  activityCount?: number;
  activities?: { imageUrl: string | null }[];
}

/** Narrows already-loaded Location candidates to the ones the homepage may
 * feature, THEN applies the carousel limit — so image-less records never
 * displace valid ones. Happenings without a usable image are dropped from
 * each Location's rail; a Location left with none is not featured. */
export function selectFeaturedLocations<T extends FeaturedCandidate>(candidates: T[], limit: number): T[] {
  const eligible: T[] = [];
  for (const location of candidates) {
    if (!hasUsableImageUrl(location.cover_image_url)) continue;
    if ((location.activityCount ?? 0) <= 0) continue;
    const activities = (location.activities ?? []).filter((a) => hasUsableImageUrl(a.imageUrl));
    if (activities.length === 0) continue;
    eligible.push({ ...location, activities });
  }
  return eligible.slice(0, limit);
}
