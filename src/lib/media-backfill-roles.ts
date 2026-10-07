// Findmi media backfill — role → required variant sizes.
//
// Validated against real display code (grep across every consumer of each
// role's column) in the read-only backfill audit this module implements:
// logos and homepage bulletin thumbnails are never shown hero-sized, so
// generating 1600 for them is pure waste; covers/galleries/flyers are never
// shown at thumbnail size, so generating 160 for them is pure waste.
// Product images are the one role genuinely shown at all three sizes (cart
// thumbnail, card grids, zoomed detail hero). Moment photos use 800+1600
// only, matching the existing resolveSignedImageUrls()/cardUrl/largeUrl
// shape in lib/journal.ts (no 160 "thumb" use of Moment photos exists).
//
// This module is pure data + one pure union helper — no I/O, no Supabase,
// safe to import from anywhere (including tests) without pulling in
// server-only code.

import { VARIANT_SIZES, type VariantSize } from "./image-variants";

export const MEDIA_ROLES = [
  "business_logo",
  "location_logo",
  "business_cover",
  "location_cover",
  "event_cover",
  "business_gallery",
  "event_gallery",
  "appearance_flyer",
  "homepage_bulletin_thumb",
  "product_image",
  "opportunity_image",
  "moment_photo",
] as const;

export type MediaRole = (typeof MEDIA_ROLES)[number];

/** The minimum variant sizes each role's real display code ever requests.
 * A backfill run generates exactly these sizes for a role — never more
 * (no wasted storage/derivative-generation time), never fewer (no missing
 * size at render time). See the module header for how each row was
 * validated. */
export const ROLE_VARIANT_SIZES: Record<MediaRole, readonly VariantSize[]> = {
  business_logo: [160, 800],
  location_logo: [160, 800],
  business_cover: [800, 1600],
  location_cover: [800, 1600],
  event_cover: [800, 1600],
  business_gallery: [800, 1600],
  event_gallery: [800, 1600],
  appearance_flyer: [800, 1600],
  homepage_bulletin_thumb: [160],
  product_image: [160, 800, 1600],
  opportunity_image: [800],
  moment_photo: [800, 1600],
};

/** When one original serves multiple roles (e.g. the same image reused as
 * both a business cover and an event gallery photo), the backfill must
 * generate the UNION of required sizes exactly once — never duplicate
 * derivative files for the same original. Order follows VARIANT_SIZES so
 * the result is always ascending (160, 800, 1600), independent of the
 * order `roles` is given in. */
export function unionVariantSizes(roles: readonly MediaRole[]): VariantSize[] {
  const needed = new Set<VariantSize>();
  for (const role of roles) {
    for (const size of ROLE_VARIANT_SIZES[role]) needed.add(size);
  }
  return VARIANT_SIZES.filter((size) => needed.has(size));
}
