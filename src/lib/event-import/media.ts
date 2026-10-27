import "server-only";
// Event Import — Event images. ONE path for every imported Event image (a
// new import's Event cover, a hosted import's cover, a recovered legacy
// Event's cover):
//
//   remote image → safe-fetch (SSRF-guarded image profile)
//               → validateImageFile (the actual bytes decide the type —
//                 the same validation an uploaded Event cover gets)
//               → Event image fit check
//               → storePublicImage (Findmi storage, original + WebP
//                 variants, server UUID path — the same pipeline the Event
//                 Manager's own cover upload uses)
//               → Findmi's public URL (never the third-party URL).
//
// Not the Brand helpers' "cover" role: that one is a Brand header rule
// (landscape 1.2–3.5:1 only, text-heavy "graphics" refused), which would
// throw away ordinary Event art — square Luma covers, portrait flyers,
// posters with text. An image that can't be fetched or verified is
// reported as such; nothing is ever substituted for it.
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeFetchImage, type SafeFetchImageResult } from "../safe-fetch";
import { validateImageFile, type ImageValidationResult } from "../imageUploadValidation";
import { storePublicImage } from "../image-variants-server";

const UPLOAD_BUCKET = "findmi-media";
export const EVENT_IMAGE_PIXEL_LIMIT = 40_000_000;
/** Labels a CDN may put on a real image (the bytes still decide). */
const DECLARED_TYPES = new Set(["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp", "image/gif", "image/avif", "application/octet-stream", "binary/octet-stream"]);

export type EventImageRejection = "fetch_failed" | "invalid_file" | "type_mismatch" | "unreadable" | "unsuitable" | "store_failed";

/** An Event image: any orientation (square covers, portrait flyers,
 * landscape banners), at least 200px on its short side, not a sliver
 * (≤ 4:1), ≤ 10000px. Exported for tests. */
export function isSuitableEventImage(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  return short >= 200 && long <= 10000 && long / short <= 4;
}

export interface VerifiedEventImage {
  body: Buffer;
  validated: ImageValidationResult;
  width: number;
  height: number;
}

export interface EventImageDeps {
  fetchImage: (url: string) => Promise<SafeFetchImageResult>;
}
const defaultDeps: EventImageDeps = { fetchImage: (url) => safeFetchImage(url) };

/** Fetches and verifies one Event image. Never throws. */
export async function fetchVerifiedEventImage(url: string, deps: EventImageDeps = defaultDeps): Promise<{ ok: true; image: VerifiedEventImage } | { ok: false; reason: EventImageRejection }> {
  try {
    const fetched = await deps.fetchImage(url);
    if (!fetched.ok) return { ok: false, reason: "fetch_failed" };
    const declared = fetched.contentType.split(";")[0].trim().toLowerCase();
    if (!DECLARED_TYPES.has(declared)) return { ok: false, reason: "type_mismatch" };
    const sniffType = declared.startsWith("image/") && declared !== "image/jpg" && declared !== "image/pjpeg" ? declared : "image/png";
    const validated = await validateImageFile(new File([new Uint8Array(fetched.body)], "event-image", { type: sniffType }));
    if ("error" in validated) return { ok: false, reason: "invalid_file" };
    if (validated.converted) return { ok: false, reason: "type_mismatch" };
    let width: number | undefined;
    let height: number | undefined;
    try {
      const meta = await sharp(fetched.body, { limitInputPixels: EVENT_IMAGE_PIXEL_LIMIT }).metadata();
      width = meta.width;
      height = meta.pageHeight ?? meta.height;
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    if (!width || !height || !isSuitableEventImage(width, height)) return { ok: false, reason: "unsuitable" };
    return { ok: true, image: { body: fetched.body, validated, width, height } };
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
}

/** Stores a VERIFIED Event image in Findmi storage; Findmi's public URL or null. */
export async function storeEventImage(admin: SupabaseClient, image: VerifiedEventImage): Promise<string | null> {
  try {
    const file = new File([new Uint8Array(image.body)], `event-cover.${image.validated.extension}`, { type: image.validated.contentType });
    const stored = await storePublicImage(admin, UPLOAD_BUCKET, image.validated, file);
    if ("error" in stored) return null;
    return admin.storage.from(UPLOAD_BUCKET).getPublicUrl(stored.path).data.publicUrl;
  } catch {
    return null;
  }
}

/** An owner's UPLOADED flyer, used as the Event image only because they
 * chose "Use This Image For The Event" in Review. The same Event image rules
 * as every imported cover — the bytes decide the type (validateImageFile,
 * HEIC/HEIF converted to JPEG exactly as every upload), the Event image fit
 * check, then storeEventImage (storePublicImage: metadata stripped, original
 * + WebP variants). Nothing is stored for a file that fails. Never throws. */
export async function storeUploadedEventImage(admin: SupabaseClient, file: unknown, maxBytes: number): Promise<{ ok: true; url: string } | { ok: false; reason: EventImageRejection | "too_large" }> {
  try {
    if (!(file instanceof File) || file.size === 0) return { ok: false, reason: "invalid_file" };
    if (file.size > maxBytes) return { ok: false, reason: "too_large" };
    const validated = await validateImageFile(file);
    if ("error" in validated) return { ok: false, reason: "invalid_file" };
    const body = validated.converted?.buffer ?? Buffer.from(await file.arrayBuffer());
    let width: number | undefined;
    let height: number | undefined;
    try {
      const meta = await sharp(body, { limitInputPixels: EVENT_IMAGE_PIXEL_LIMIT }).metadata();
      width = meta.width;
      height = meta.pageHeight ?? meta.height;
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    if (!width || !height || !isSuitableEventImage(width, height)) return { ok: false, reason: "unsuitable" };
    const url = await storeEventImage(admin, { body, validated, width, height });
    return url ? { ok: true, url } : { ok: false, reason: "store_failed" };
  } catch {
    return { ok: false, reason: "store_failed" };
  }
}

/** True for an image already in Findmi's own Event-image storage (an Event
 * cover uploaded in Review by uploadImportEventCover / adminUploadEventCover)
 * — the save path keeps it as-is instead of fetching and copying it again.
 * Exact public-bucket prefix only; no path tricks. */
export function isStoredEventImageUrl(admin: SupabaseClient, url: string): boolean {
  if (typeof url !== "string" || url.length > 2048 || url.includes("..") || /[?#\s]/.test(url)) return false;
  try {
    const prefix = admin.storage.from(UPLOAD_BUCKET).getPublicUrl("").data.publicUrl.replace(/\/?$/, "/");
    return /^https:\/\//i.test(prefix) && url.startsWith(prefix) && url.length > prefix.length;
  } catch {
    return false;
  }
}

/** Plain-language reason an uploaded Event cover wasn't accepted. */
export function uploadedEventImageError(reason: EventImageRejection | "too_large"): string {
  if (reason === "too_large") return "That image is too large. Choose a smaller one.";
  if (reason === "unsuitable") return "That image is too small or too narrow for an Event image.";
  if (reason === "invalid_file" || reason === "type_mismatch" || reason === "unreadable") return "That file isn't a supported image.";
  return "Couldn't upload that image. Please try again.";
}

/** The one call every Event import path uses: fetch → verify → store. */
export async function recoverEventImage(admin: SupabaseClient, url: string, deps: EventImageDeps = defaultDeps): Promise<{ ok: true; url: string } | { ok: false; reason: EventImageRejection }> {
  const verified = await fetchVerifiedEventImage(url, deps);
  if (!verified.ok) return verified;
  const stored = await storeEventImage(admin, verified.image);
  return stored ? { ok: true, url: stored } : { ok: false, reason: "store_failed" };
}

const EVENT_PREVIEW_MAX_BYTES = 120 * 1024;
const EVENT_PREVIEW_QUALITIES = [72, 60, 45];

export type EventImagePreview = { preview: string; reason: null } | { preview: null; reason: EventImageRejection | "preview_failed" };

/** Admin Review preview of a candidate Event image. The page's CSP only
 * allows Findmi's own / data: images, so a third-party image URL can't be
 * shown directly (and isn't opened up): the image goes through the SAME
 * fetch + verification recoverEventImage uses (fetchVerifiedEventImage:
 * SSRF-guarded fetch, real-bytes type check, size / pixel / shape limits),
 * and only a small re-encoded WebP data URI of a verified image comes out.
 * Nothing is stored — a preview never means the image was saved. */
export async function previewEventImage(url: string, deps: EventImageDeps = defaultDeps): Promise<EventImagePreview> {
  const verified = await fetchVerifiedEventImage(url, deps);
  if (!verified.ok) return { preview: null, reason: verified.reason };
  try {
    for (const quality of EVENT_PREVIEW_QUALITIES) {
      const out = await sharp(verified.image.body, { limitInputPixels: EVENT_IMAGE_PIXEL_LIMIT, animated: false })
        .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      if (out.length <= EVENT_PREVIEW_MAX_BYTES) return { preview: `data:image/webp;base64,${out.toString("base64")}`, reason: null };
    }
  } catch {
    // fall through
  }
  return { preview: null, reason: "preview_failed" };
}
