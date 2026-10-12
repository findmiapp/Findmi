import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeFetchImage, type SafeFetchImageResult } from "./safe-fetch";
import { validateImageFile, type ImageValidationResult } from "./imageUploadValidation";
import { storePublicImage } from "./image-variants-server";

/** Brand Onboarding V1.1C — logo / cover candidates found on a brand's
 * website. A candidate URL is untrusted at every step (even when it
 * arrives inside a signed draft cookie — signing only stops a visitor
 * substituting a URL, not a hostile site serving a hostile file):
 *
 *   safe fetch (lib/safe-fetch image profile: https, SSRF-guarded DNS,
 *     re-validated redirects, PNG/JPEG/WebP/GIF only, ≤ 5 MB)
 *   → validateImageFile (actual bytes decide the format; SVG refused;
 *     HEIC refused here) and declared type must match the bytes
 *   → sharp metadata under a pixel limit → logo/cover suitability rules
 *   → covers only: not a low-information graphic (isLowInformationGraphic)
 *
 * Previews are small re-encoded WebP data URIs (never a hotlink, never
 * stored). Storage happens ONLY via storeBrandImage, called by
 * createMemberBusiness after the Business exists and only for a candidate
 * the owner left selected — so nothing is stored for rejected,
 * deselected or abandoned candidates. */

export type BrandImageRole = "logo" | "cover";

export const BRAND_IMAGE_PIXEL_LIMIT = 40_000_000;
const UPLOAD_BUCKET = "findmi-media";
const PREVIEW_MAX_BYTES = 120 * 1024;

/** Logo: at least 120px on the long side and 40px on the short side, not
 * a sliver (≤ 6:1), ≤ 6000px. Cover: landscape ≥ 600×300, ≥ 1.2:1,
 * ≤ 10000px. Exported for tests. */
export function isSuitableBrandImage(role: BrandImageRole, width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (role === "logo") return long >= 120 && short >= 40 && long / short <= 6 && long <= 6000;
  return width >= 600 && height >= 300 && width / height >= 1.2 && long <= 10000;
}

export interface VerifiedBrandImage {
  role: BrandImageRole;
  body: Buffer;
  validated: ImageValidationResult;
  width: number;
  height: number;
}

export type BrandImageRejection = "fetch_failed" | "invalid_file" | "type_mismatch" | "unreadable" | "unsuitable" | "graphic";

/** Low-information graphic test for COVER candidates (exported for
 * tests): a 64px thumbnail (transparency flattened onto white), colours
 * quantized to 3 bits per channel. A wordmark/logo on a flat background is
 * dominated by one colour with only a handful of others; photographs and
 * rich illustrations are not. Deliberately conservative — BOTH must hold:
 *   - the most common colour covers ≥ 60% of the image, AND
 *   - at most 6 colours each cover ≥ 1% of it.
 * Limits: it measures colour distribution, not meaning — a minimal
 * product shot on a seamless backdrop can look "graphic", and a busy
 * multicolour wordmark can pass. */
export const GRAPHIC_TOP_COLOR_MIN = 0.6;
export const GRAPHIC_MAX_SIGNIFICANT_COLORS = 6;
export async function isLowInformationGraphic(body: Buffer): Promise<boolean> {
  const { data, info } = await sharp(body, { limitInputPixels: BRAND_IMAGE_PIXEL_LIMIT, animated: false })
    .flatten({ background: "#ffffff" })
    .resize(64, 64, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  if (!pixels) return false;
  const counts = new Map<number, number>();
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const values = [...counts.values()];
  const top = Math.max(...values) / pixels;
  const significant = values.filter((n) => n / pixels >= 0.01).length;
  return top >= GRAPHIC_TOP_COLOR_MIN && significant <= GRAPHIC_MAX_SIGNIFICANT_COLORS;
}

export interface BrandImageDeps {
  fetchImage: (url: string) => Promise<SafeFetchImageResult>;
}

const defaultDeps: BrandImageDeps = { fetchImage: (url) => safeFetchImage(url) };

/** Fetches and fully verifies one candidate. Never throws. */
export async function fetchVerifiedBrandImage(
  url: string,
  role: BrandImageRole,
  deps: BrandImageDeps = defaultDeps
): Promise<{ ok: true; image: VerifiedBrandImage } | { ok: false; reason: BrandImageRejection }> {
  try {
    const fetched = await deps.fetchImage(url);
    if (!fetched.ok) return { ok: false, reason: "fetch_failed" };
    const declared = fetched.contentType.split(";")[0].trim().toLowerCase();
    const file = new File([new Uint8Array(fetched.body)], "brand-candidate", { type: declared });
    const validated = await validateImageFile(file);
    if ("error" in validated) return { ok: false, reason: "invalid_file" };
    // The bytes must be what the server said they are (and never a
    // converted HEIC — those aren't offered as brand candidates).
    if (validated.converted || validated.contentType !== declared) return { ok: false, reason: "type_mismatch" };
    let width: number | undefined;
    let height: number | undefined;
    try {
      const meta = await sharp(fetched.body, { limitInputPixels: BRAND_IMAGE_PIXEL_LIMIT }).metadata();
      width = meta.width;
      height = meta.pageHeight ?? meta.height;
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    if (!width || !height || !isSuitableBrandImage(role, width, height)) return { ok: false, reason: "unsuitable" };
    // A cover must be a picture, not a wordmark/logo share graphic. When
    // in doubt the cover is dropped (a human can add one at review).
    if (role === "cover") {
      try {
        if (await isLowInformationGraphic(fetched.body)) return { ok: false, reason: "graphic" };
      } catch {
        return { ok: false, reason: "unreadable" };
      }
    }
    return { ok: true, image: { role, body: fetched.body, validated, width, height } };
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
}

/** Preview re-encode qualities, tried in order until the data URI fits
 * PREVIEW_MAX_BYTES (a detailed photo can exceed it at the first). */
const PREVIEW_QUALITIES = [72, 60, 45];

/** A small re-encoded WebP preview as a data URI (first frame only), or
 * null. Never stored, never a remote URL. */
export async function brandImagePreview(image: VerifiedBrandImage): Promise<string | null> {
  try {
    const box = image.role === "logo" ? { width: 256, height: 256 } : { width: 640, height: 360 };
    for (const quality of PREVIEW_QUALITIES) {
      const out = await sharp(image.body, { limitInputPixels: BRAND_IMAGE_PIXEL_LIMIT, animated: false })
        .resize({ ...box, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      if (out.length <= PREVIEW_MAX_BYTES) return `data:image/webp;base64,${out.toString("base64")}`;
    }
    return null;
  } catch {
    return null;
  }
}

/** Re-hosts a VERIFIED image in Findmi storage through the existing image
 * pipeline (original + 160/800/1600 WebP variants, server UUID path) and
 * returns Findmi's public URL — never the third-party URL. */
export async function storeBrandImage(admin: SupabaseClient, image: VerifiedBrandImage): Promise<string | null> {
  try {
    const file = new File([new Uint8Array(image.body)], `brand-${image.role}.${image.validated.extension}`, {
      type: image.validated.contentType,
    });
    const stored = await storePublicImage(admin, UPLOAD_BUCKET, image.validated, file);
    if ("error" in stored) return null;
    return admin.storage.from(UPLOAD_BUCKET).getPublicUrl(stored.path).data.publicUrl;
  } catch {
    return null;
  }
}

// ── Preview cache ─────────────────────────────────────────────────────────

const PREVIEW_TTL_MS = 10 * 60 * 1000;
/** A failed FETCH (network/timeout/remote refusal) may be transient: it is
 * remembered only briefly, so a reload soon retries. Deterministic
 * rejections (not an image, wrong shape, a logo-like cover) keep the
 * normal TTL. */
const PREVIEW_TRANSIENT_TTL_MS = 60 * 1000;
const PREVIEW_CACHE_MAX = 100;

export type BrandPreviewFailure = BrandImageRejection | "preview_failed";
export interface BrandPreviewResult {
  /** Verified, re-encoded WebP data URI — or null. */
  preview: string | null;
  /** Why there is no preview (null when there is one). Safe codes only. */
  reason: BrandPreviewFailure | null;
}

const previewCache = new Map<string, { result: BrandPreviewResult; at: number }>();

/** Review-page preview for a candidate URL with the reason when there is
 * none: verify (fetch + validate + suitability, the SAME checks storage
 * uses) then thumbnail. Not a proxy — only a URL already recorded on a
 * candidate is ever passed in, and only a re-encoded thumbnail of a fully
 * verified image comes out. In-memory per-instance cache of the RESULT
 * only. */
export async function previewBrandCandidateResult(
  url: string,
  role: BrandImageRole,
  now: number = Date.now(),
  deps: BrandImageDeps = defaultDeps
): Promise<BrandPreviewResult> {
  const key = `${role}|${url}`;
  const hit = previewCache.get(key);
  const ttl = hit?.result.reason === "fetch_failed" ? PREVIEW_TRANSIENT_TTL_MS : PREVIEW_TTL_MS;
  if (hit && now - hit.at < ttl) return hit.result;
  const verified = await fetchVerifiedBrandImage(url, role, deps);
  let result: BrandPreviewResult;
  if (!verified.ok) result = { preview: null, reason: verified.reason };
  else {
    const preview = await brandImagePreview(verified.image);
    result = preview ? { preview, reason: null } : { preview: null, reason: "preview_failed" };
  }
  previewCache.delete(key);
  previewCache.set(key, { result, at: now });
  while (previewCache.size > PREVIEW_CACHE_MAX) {
    const oldest = previewCache.keys().next().value;
    if (oldest === undefined) break;
    previewCache.delete(oldest);
  }
  return result;
}

/** previewBrandCandidateResult → the data URI or null (unchanged API). */
export async function previewBrandCandidate(
  url: string,
  role: BrandImageRole,
  now: number = Date.now(),
  deps: BrandImageDeps = defaultDeps
): Promise<string | null> {
  return (await previewBrandCandidateResult(url, role, now, deps)).preview;
}

/** Test helper. */
export function resetBrandPreviewCache(): void {
  previewCache.clear();
}
