// Business Public Profile — Appearance Image Fallback refinement. Shared
// by the Featured Appearance card (BusinessPublicView.tsx) and the
// FindMi Here "Cards" view (AppearanceCarousel.tsx) — both previously
// fell straight through to the business's own cover_image_url whenever an
// appearance had no dedicated image, which made every image-less
// appearance on a profile show the exact same photo (see the Native Rose
// production screenshot this pass was filed against). This resolves, per
// appearance, to a real photo spread across whatever the business already
// has, before finally giving up and using the cover.

/** Deterministic (never Math.random) index derivation from a stable
 * string id — the same appearance always resolves to the same gallery
 * image across renders/visits (no hydration mismatch, no flicker between
 * requests), while different appearances naturally spread across
 * whatever gallery images exist instead of all picking the first one. */
function stableIndex(id: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % length;
}

/** Resolves the single real photo an appearance should display, in this
 * precedence:
 *   1. `specificImageUrl` — the most specific real image already
 *      attached to this exact appearance, already resolved by the
 *      caller (its own flyer_image_url, or its linked Event's own
 *      cover_image_url when event-backed). Never recomputed here, so a
 *      genuinely event-backed appearance's own real cover photo (e.g.
 *      illy's "A Cup of Love") is never silently swapped for a generic
 *      gallery photo.
 *   2. A deterministic pick from the business's own existing gallery
 *      (business_images — already fetched by the caller; this performs
 *      no query of its own and never persists anything), so repeated
 *      image-less appearances spread across real photography the
 *      business already has instead of all repeating the same cover.
 *   3. The business's own cover_image_url.
 *   4. null — the caller's own designed neutral fallback takes over.
 * Invalid/empty gallery entries are filtered out before indexing; an
 * empty gallery (after filtering) is treated the same as no gallery. */
export function resolveAppearanceDisplayImage({
  appearanceId,
  specificImageUrl,
  galleryImages,
  businessCoverUrl,
}: {
  appearanceId: string;
  specificImageUrl: string | null;
  galleryImages: string[];
  businessCoverUrl: string | null;
}): string | null {
  if (specificImageUrl) return specificImageUrl;

  const validGallery = galleryImages.filter((url): url is string => typeof url === "string" && url.length > 0);
  if (validGallery.length > 0) {
    return validGallery[stableIndex(appearanceId, validGallery.length)];
  }

  return businessCoverUrl ?? null;
}
