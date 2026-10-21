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
//
// The source URL may be a direct image OR an official webpage. A direct
// image is handled exactly as before. When the guarded image fetch says the
// URL isn't an image, the page itself is read once through the guarded
// HTML fetch (safeFetchEventPage: same destination/DNS/redirect/TLS/
// timeout/size rules), its representative image is resolved
// (representativePageImages: og:image:secure_url → og:image →
// twitter:image → JSON-LD → conservative fallback; parsing only, no page
// script runs), and each candidate goes through the SAME guarded fetch +
// verification as a direct image. Provenance (source page + resolved image
// URL) is kept as a small JSON sidecar next to the stored original.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchVerifiedEventImage, storeEventImage, type EventImageRejection, type VerifiedEventImage } from "@/lib/event-import/media";
import { fetchVerifiedBrandImage, storeBrandImage, brandImagePreview, brandImageFailureReason, type VerifiedBrandImage } from "@/lib/brand-images";
import { representativePageImages, type PageImageSource } from "@/lib/event-import/extract";
import { validateFetchUrl, safeFetchImage, safeFetchBrandImage, safeFetchSvg, safeFetchEventPage, type SafeFetchImageResult, type SafeFetchResult } from "@/lib/safe-fetch";

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
const BUCKET = "findmi-media";
const PUBLIC_SEGMENT = `/storage/v1/object/public/${BUCKET}/`;
/** Candidates tried from one page before giving up. */
const MAX_PAGE_CANDIDATES = 4;
const PAGE_SOURCES: ReadonlySet<PageImageSource> = new Set(["og:image:secure_url", "og:image", "twitter:image", "jsonld", "page"]);

export interface MediaEnrichmentRequest {
  entityType: string;
  entityId: string;
  target: string;
  /** A direct image URL or an official webpage. */
  url: string;
  /** The image a Preview resolved from the webpage and the admin confirmed;
   * still fetched and verified like any other image. */
  resolvedImageUrl?: string | null;
  /** Which page tag that confirmed image came from (provenance only). */
  resolvedFrom?: string | null;
}

/** Where the stored image came from. */
export interface MediaProvenance {
  /** The webpage the image was resolved from (null for a direct image). */
  sourcePageUrl: string | null;
  /** The image URL that was actually fetched. */
  resolvedImageUrl: string;
  resolvedFrom: PageImageSource | "direct";
}

export type MediaEnrichmentResult =
  | ({ ok: true; url: string; column: string; previousUrl: string | null; publicPath: string; adminPath: string } & MediaProvenance)
  | { ok: false; error: string; sourcePageUrl?: string | null; resolvedImageUrl?: string | null };

export type MediaPreviewResult = ({ preview: string } & MediaProvenance) | { error: string; sourcePageUrl?: string | null; resolvedImageUrl?: string | null };

export interface MediaEnrichmentDeps {
  fetchCoverImage: (url: string) => Promise<SafeFetchImageResult>;
  fetchLogoImage: (url: string) => Promise<SafeFetchImageResult>;
  fetchSvg: (url: string) => Promise<SafeFetchImageResult>;
  fetchPage: (url: string) => Promise<SafeFetchResult>;
  storeCover: typeof storeEventImage;
  storeLogo: typeof storeBrandImage;
}
// The same fetchers each existing pipeline uses by default.
const defaultDeps: MediaEnrichmentDeps = {
  fetchCoverImage: (url) => safeFetchImage(url),
  fetchLogoImage: (url) => safeFetchBrandImage(url),
  fetchSvg: (url) => safeFetchSvg(url),
  fetchPage: (url) => safeFetchEventPage(url),
  storeCover: storeEventImage,
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

function checkUrl(raw: string | null | undefined): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "Paste a source URL." };
  // The same destination rules the fetch itself enforces (https only, no
  // credentials/ports/IP literals, no localhost/internal/special-use
  // names). Private addresses behind a public name are refused again at
  // connect time by safe-fetch's guarded DNS lookup, on every redirect.
  const checked = validateFetchUrl(trimmed, { allowSharedPlatforms: true });
  if (!checked.ok) return { ok: false, error: checked.code === "blocked_destination" ? "That address isn't allowed." : "Use a full https:// URL." };
  return { ok: true, url: checked.url.href };
}

/** Request shape + URL rules, before anything is fetched. Exported for tests. */
export function checkMediaRequest(req: MediaEnrichmentRequest): { ok: true; type: MediaEntityType; target: MediaTarget; column: string; url: string } | { ok: false; error: string } {
  const type = req.entityType as MediaEntityType;
  if (!(type in MEDIA_TARGETS)) return { ok: false, error: "Choose Place, Event or Business." };
  const target = req.target as MediaTarget;
  const column = MEDIA_TARGETS[type][target];
  if (!column) return { ok: false, error: `A ${type === "location" ? "Place" : type === "event" ? "Event" : "Business"} has no ${req.target} image.` };
  if (!UUID.test(req.entityId ?? "")) return { ok: false, error: "Choose an existing record first." };
  const url = checkUrl(req.url);
  if (!url.ok) return url;
  return { ok: true, type, target, column, url: url.url };
}

type Verified = { kind: "cover"; image: VerifiedEventImage } | { kind: "logo"; image: VerifiedBrandImage };
/** `notImage`: the guarded image fetch says this URL isn't an image (an
 * HTML page, or a page host the image fetch doesn't accept) — the only
 * case in which the URL is then read as a webpage. */
type VerifyOutcome = { ok: true; verified: Verified } | { ok: false; error: string; notImage: boolean };

/** One image URL through the existing pipeline's own verification. */
async function verifyImage(target: MediaTarget, url: string, deps: MediaEnrichmentDeps): Promise<VerifyOutcome> {
  let code: string | null = null;
  const record = (fetcher: (u: string) => Promise<SafeFetchImageResult>) => async (u: string) => {
    const r = await fetcher(u);
    if (!r.ok) code = r.code;
    return r;
  };
  const notImage = () => code === "unsupported_content" || code === "blocked_destination";
  if (target === "logo") {
    const v = await fetchVerifiedBrandImage(url, "logo", { fetchImage: record(deps.fetchLogoImage), fetchSvg: record(deps.fetchSvg) });
    return v.ok ? { ok: true, verified: { kind: "logo", image: v.image } } : { ok: false, error: brandImageFailureReason(v), notImage: notImage() || v.reason === "type_mismatch" };
  }
  const v = await fetchVerifiedEventImage(url, { fetchImage: record(deps.fetchCoverImage) });
  return v.ok ? { ok: true, verified: { kind: "cover", image: v.image } } : { ok: false, error: COVER_REASONS[v.reason], notImage: notImage() || v.reason === "type_mismatch" };
}

type Resolved = { ok: true; verified: Verified } & MediaProvenance;
type Unresolved = { ok: false; error: string; sourcePageUrl?: string | null; resolvedImageUrl?: string | null };

/** Source URL → one verified image (direct, or resolved from the page). */
export async function resolveSourceImage(
  target: MediaTarget,
  sourceUrl: string,
  confirmed: { url?: string | null; from?: string | null } | null,
  deps: MediaEnrichmentDeps = defaultDeps
): Promise<Resolved | Unresolved> {
  // A Preview already resolved and showed this image: verify exactly it.
  const confirmedImageUrl = confirmed?.url;
  if (confirmedImageUrl && confirmedImageUrl !== sourceUrl) {
    const checked = checkUrl(confirmedImageUrl);
    if (!checked.ok) return { ok: false, error: checked.error, sourcePageUrl: sourceUrl, resolvedImageUrl: confirmedImageUrl };
    const v = await verifyImage(target, checked.url, deps);
    if (!v.ok) return { ok: false, error: v.error, sourcePageUrl: sourceUrl, resolvedImageUrl: checked.url };
    const from = PAGE_SOURCES.has(confirmed?.from as PageImageSource) ? (confirmed?.from as PageImageSource) : "page";
    return { ok: true, verified: v.verified, sourcePageUrl: sourceUrl, resolvedImageUrl: checked.url, resolvedFrom: from };
  }

  const direct = await verifyImage(target, sourceUrl, deps);
  if (direct.ok) return { ok: true, verified: direct.verified, sourcePageUrl: null, resolvedImageUrl: sourceUrl, resolvedFrom: "direct" };
  if (!direct.notImage) return { ok: false, error: direct.error, resolvedImageUrl: sourceUrl };

  const page = await deps.fetchPage(sourceUrl);
  if (!page.ok) {
    return {
      ok: false,
      error: page.code === "blocked_destination" ? "That address isn't allowed." : "That URL isn't an image, and the webpage couldn't be read (blocked, missing, too large, or the site refused).",
      sourcePageUrl: sourceUrl,
    };
  }
  const pageUrl = page.url.href;
  const candidates = representativePageImages(page.html, page.url);
  if (candidates.length === 0) {
    return { ok: false, error: "That webpage doesn't declare a representative image (no og:image, twitter:image or structured image). Paste a direct image URL instead.", sourcePageUrl: pageUrl };
  }
  let firstError: Unresolved | null = null;
  for (const c of candidates.slice(0, MAX_PAGE_CANDIDATES)) {
    const v = await verifyImage(target, c.url, deps);
    if (v.ok) return { ok: true, verified: v.verified, sourcePageUrl: pageUrl, resolvedImageUrl: c.url, resolvedFrom: c.source };
    firstError ??= { ok: false, error: `The page's image couldn't be used: ${v.error}`, sourcePageUrl: pageUrl, resolvedImageUrl: c.url };
  }
  return firstError ?? { ok: false, error: "The page's image couldn't be used.", sourcePageUrl: pageUrl };
}

/** Best-effort provenance sidecar next to the stored original
 * (<path>.provenance.json in findmi-media). Never fails the row. */
async function writeProvenance(admin: SupabaseClient, storedUrl: string, p: MediaProvenance & { entityType: string; entityId: string; column: string }): Promise<void> {
  try {
    const i = storedUrl.indexOf(PUBLIC_SEGMENT);
    if (i === -1) return;
    const path = `${decodeURIComponent(storedUrl.slice(i + PUBLIC_SEGMENT.length).split("?")[0])}.provenance.json`;
    const body = JSON.stringify({
      source_page_url: p.sourcePageUrl,
      resolved_source_image_url: p.resolvedImageUrl,
      resolved_from: p.resolvedFrom,
      entity_type: p.entityType,
      entity_id: p.entityId,
      column: p.column,
      stored_at: new Date().toISOString(),
    });
    await admin.storage.from(BUCKET).upload(path, new Blob([body], { type: "application/json" }), { contentType: "application/json", upsert: false });
  } catch {
    // provenance is a record, never a gate
  }
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

    const resolved = await resolveSourceImage(target, url, { url: req.resolvedImageUrl, from: req.resolvedFrom }, deps);
    if (!resolved.ok) return resolved;
    const stored = resolved.verified.kind === "logo" ? await deps.storeLogo(admin, resolved.verified.image) : await deps.storeCover(admin, resolved.verified.image);
    if (!stored) return { ok: false, error: COVER_REASONS.store_failed, sourcePageUrl: resolved.sourcePageUrl, resolvedImageUrl: resolved.resolvedImageUrl };

    const { error: writeError } = await admin.from(TABLES[type]).update({ [column]: stored }).eq("id", req.entityId);
    if (writeError) return { ok: false, error: "The image was stored but the record couldn't be updated. Please try again." };
    const provenance: MediaProvenance = { sourcePageUrl: resolved.sourcePageUrl, resolvedImageUrl: resolved.resolvedImageUrl, resolvedFrom: resolved.resolvedFrom };
    await writeProvenance(admin, stored, { ...provenance, entityType: type, entityId: req.entityId, column });
    return { ok: true, url: stored, column, previousUrl, publicPath: PUBLIC_PATHS[type](slug), adminPath: `/admin/${TABLES[type]}/${req.entityId}`, ...provenance };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** A small verified data-URI preview of the image this source resolves to
 * (the admin CSP only allows Findmi / data: images, so the source is never
 * shown directly). Reads no record and writes nothing. Never throws. */
export async function previewEntityImage(target: string, rawUrl: string, deps: MediaEnrichmentDeps = defaultDeps): Promise<MediaPreviewResult> {
  const checked = checkUrl(rawUrl);
  if (!checked.ok) return { error: checked.error };
  try {
    const resolved = await resolveSourceImage(target === "logo" ? "logo" : "cover", checked.url, null, deps);
    if (!resolved.ok) return { error: resolved.error, sourcePageUrl: resolved.sourcePageUrl ?? null, resolvedImageUrl: resolved.resolvedImageUrl ?? null };
    const image = resolved.verified.kind === "logo" ? resolved.verified.image : ({ ...resolved.verified.image, role: "cover" } as VerifiedBrandImage);
    const preview = await brandImagePreview(image);
    if (!preview) return { error: "Couldn't make a preview.", sourcePageUrl: resolved.sourcePageUrl, resolvedImageUrl: resolved.resolvedImageUrl };
    return { preview, sourcePageUrl: resolved.sourcePageUrl, resolvedImageUrl: resolved.resolvedImageUrl, resolvedFrom: resolved.resolvedFrom };
  } catch {
    return { error: "Couldn't make a preview." };
  }
}
