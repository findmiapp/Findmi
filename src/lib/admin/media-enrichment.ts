import "server-only";
// Admin Media Enrichment — attach an intentionally chosen source image to
// an EXISTING Place / Event / Business, through the same pipeline every
// Findmi image import already uses. No new storage, no new verification:
//
//   cover → fetchVerifiedEventImage + storeEventImage (lib/event-import/media:
//           SSRF-guarded safe fetch, real-bytes validateImageFile, any
//           orientation, ≥ 200px short side, ≤ 4:1)
//   logo  → fetchVerifiedBrandImage(url, "logo") + storeBrandImage
//           (lib/brand-images: same safe fetch, raster or strictly
//           inspected SVG rendered to PNG, logo size/content rules)
//
// Both stores run storePublicImage (findmi-media bucket, server UUID path,
// original + 160/800/1600 WebP variants) and return Findmi's own public
// URL — the third-party URL is never written to a record. The record's
// existing media column is then set to that URL (the same column the
// admin edit form's upload field writes); nothing else on the row changes.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchVerifiedEventImage, storeEventImage, previewEventImage, type EventImageRejection } from "@/lib/event-import/media";
import { fetchVerifiedBrandImage, storeBrandImage, brandImagePreview, brandImageFailureReason, type VerifiedBrandImage } from "@/lib/brand-images";
import { validateFetchUrl } from "@/lib/safe-fetch";

export type MediaEntityType = "location" | "event" | "business";
export type MediaTarget = "cover" | "logo";

/** Which media column each (entity, target) writes — the first version's
 * complete list. Galleries are deliberately not here. */
export const MEDIA_TARGETS: Record<MediaEntityType, Partial<Record<MediaTarget, string>>> = {
  location: { cover: "cover_image_url", logo: "logo_url" },
  event: { cover: "cover_image_url" },
  business: { cover: "cover_image_url", logo: "logo_url" },
};

const TABLES: Record<MediaEntityType, string> = { location: "locations", event: "events", business: "businesses" };
const PUBLIC_PATHS: Record<MediaEntityType, (slug: string) => string> = {
  location: (s) => `/location/${s}`,
  event: (s) => `/event/${s}`,
  business: (s) => `/business/${s}`,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MediaEnrichmentRequest {
  entityType: string;
  entityId: string;
  target: string;
  url: string;
}

export type MediaEnrichmentResult =
  | { ok: true; url: string; column: string; previousUrl: string | null; publicPath: string; adminPath: string }
  | { ok: false; error: string };

export interface MediaEnrichmentDeps {
  verifyCover: typeof fetchVerifiedEventImage;
  storeCover: typeof storeEventImage;
  verifyLogo: typeof fetchVerifiedBrandImage;
  storeLogo: typeof storeBrandImage;
}
const defaultDeps: MediaEnrichmentDeps = {
  verifyCover: fetchVerifiedEventImage,
  storeCover: storeEventImage,
  verifyLogo: fetchVerifiedBrandImage,
  storeLogo: storeBrandImage,
};

const COVER_REASONS: Record<EventImageRejection, string> = {
  fetch_failed: "Couldn't download that image (blocked, missing, too large, or the site refused).",
  invalid_file: "That URL isn't a supported image file (JPEG, PNG, WebP or GIF).",
  type_mismatch: "That URL didn't return an image.",
  unreadable: "That image couldn't be read.",
  unsuitable: "That image is too small or too stretched for a cover (needs ≥ 200px on its short side, ≤ 4:1).",
  store_failed: "The image couldn't be saved to Findmi storage. Please try again.",
};

/** Request shape + URL rules, before anything is fetched. Exported for tests. */
export function checkMediaRequest(req: MediaEnrichmentRequest): { ok: true; type: MediaEntityType; target: MediaTarget; column: string; url: string } | { ok: false; error: string } {
  const type = req.entityType as MediaEntityType;
  if (!(type in MEDIA_TARGETS)) return { ok: false, error: "Choose Place, Event or Business." };
  const target = req.target as MediaTarget;
  const column = MEDIA_TARGETS[type][target];
  if (!column) return { ok: false, error: `A ${type === "location" ? "Place" : type === "event" ? "Event" : "Business"} has no ${req.target} image.` };
  if (!UUID.test(req.entityId ?? "")) return { ok: false, error: "Choose an existing record first." };
  const raw = (req.url ?? "").trim();
  if (!raw) return { ok: false, error: "Paste an image URL." };
  // The same destination rules the fetch itself enforces (https only, no
  // credentials/ports/IP literals, no localhost/internal/special-use
  // names). Private addresses behind a public name are refused again at
  // connect time by safe-fetch's guarded DNS lookup.
  const checked = validateFetchUrl(raw, { allowSharedPlatforms: true });
  if (!checked.ok) return { ok: false, error: checked.code === "blocked_destination" ? "That address isn't allowed." : "Use a full https:// image URL." };
  return { ok: true, type, target, column, url: checked.url.href };
}

/** Fetch → verify → store → write the record's media column. Never throws. */
export async function enrichEntityImage(admin: SupabaseClient, req: MediaEnrichmentRequest, deps: MediaEnrichmentDeps = defaultDeps): Promise<MediaEnrichmentResult> {
  const checked = checkMediaRequest(req);
  if (!checked.ok) return checked;
  const { type, target, column, url } = checked;
  try {
    const { data: row, error: readError } = await admin.from(TABLES[type]).select(`id, slug, ${column}`).eq("id", req.entityId).maybeSingle();
    if (readError) return { ok: false, error: "Couldn't read that record. Please try again." };
    if (!row) return { ok: false, error: "That record no longer exists." };
    const record = row as unknown as Record<string, string | null>;
    const previousUrl = record[column] ?? null;
    const slug = record.slug ?? "";

    let stored: string | null;
    if (target === "logo") {
      const verified = await deps.verifyLogo(url, "logo");
      if (!verified.ok) return { ok: false, error: brandImageFailureReason(verified) };
      stored = await deps.storeLogo(admin, verified.image as VerifiedBrandImage);
    } else {
      const verified = await deps.verifyCover(url);
      if (!verified.ok) return { ok: false, error: COVER_REASONS[verified.reason] };
      stored = await deps.storeCover(admin, verified.image);
    }
    if (!stored) return { ok: false, error: COVER_REASONS.store_failed };

    const { error: writeError } = await admin.from(TABLES[type]).update({ [column]: stored }).eq("id", req.entityId);
    if (writeError) return { ok: false, error: "The image was stored but the record couldn't be updated. Please try again." };
    return {
      ok: true,
      url: stored,
      column,
      previousUrl,
      publicPath: PUBLIC_PATHS[type](slug),
      adminPath: `/admin/${TABLES[type]}/${req.entityId}`,
    };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** A small verified data-URI preview (the admin CSP only allows Findmi /
 * data: images, so the source URL is never shown directly). Nothing is
 * stored. Never throws. */
export async function previewEntityImage(target: string, rawUrl: string): Promise<{ preview: string } | { error: string }> {
  const checked = validateFetchUrl((rawUrl ?? "").trim(), { allowSharedPlatforms: true });
  if (!checked.ok) return { error: checked.code === "blocked_destination" ? "That address isn't allowed." : "Use a full https:// image URL." };
  try {
    if (target === "logo") {
      const verified = await fetchVerifiedBrandImage(checked.url.href, "logo");
      if (!verified.ok) return { error: brandImageFailureReason(verified) };
      const preview = await brandImagePreview(verified.image);
      return preview ? { preview } : { error: "Couldn't make a preview." };
    }
    const result = await previewEventImage(checked.url.href);
    if (result.reason === null) return { preview: result.preview };
    return { error: result.reason === "preview_failed" ? "Couldn't make a preview." : COVER_REASONS[result.reason] };
  } catch {
    return { error: "Couldn't make a preview." };
  }
}
