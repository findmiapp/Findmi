import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeFetchImage, safeFetchSvg, SAFE_FETCH_SVG_MAX_BYTES, type SafeFetchImageResult } from "./safe-fetch";
import { isSvgCandidateUrl } from "./brand-website-extract";
import { validateImageFile, type ImageValidationResult } from "./imageUploadValidation";
import { storePublicImage } from "./image-variants-server";
import { randomUUID } from "node:crypto";

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
/** Declared types accepted as a FIRST gate (the bytes still decide). */
export const BRAND_IMAGE_DECLARED_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/jpg",
  "image/pjpeg",
  "application/octet-stream",
  "binary/octet-stream",
]);
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
  /** VCL A3c — SVG logo candidates only (default: safeFetchSvg). */
  fetchSvg?: (url: string) => Promise<SafeFetchImageResult>;
}

const defaultDeps: BrandImageDeps = { fetchImage: (url) => safeFetchImage(url), fetchSvg: (url) => safeFetchSvg(url) };

// ── VCL A3c — SVG logo → raster ───────────────────────────────────────────
//
// An external SVG LOGO candidate (strong logo evidence only — see
// svgLogoCandidatesFrom) is converted server-side into a PNG and then held
// to exactly the same checks as any raster logo. The SVG is never stored,
// served or put in the DOM; only the verified PNG continues.
//
// Security boundary (two layers):
//   1. inspectSvg — a strict, conservative gate on the raw text: plain
//      UTF-8 XML whose root is <svg>; no DOCTYPE/entities, stylesheet
//      processing instructions, scripts, event handlers, foreignObject,
//      <image>/media/embeds, @import/@font-face; every href / url() must be
//      a same-document "#fragment" reference. Bounded size, element and
//      <use> counts, and sane width/height/viewBox. Anything uncertain is
//      rejected (the candidate is simply dropped).
//   2. librsvg (via sharp/libvips) on an in-memory BUFFER: no base URL, no
//      script execution, no http(s)/file resource loading from a buffer,
//      and libvips' default (non-"unlimited") SVG loader bounds document
//      size. Rendering runs under limitInputPixels and a timeout.
// Text (<text>) renders with server fonts only; there are no web fonts.

export const SVG_RASTER_LONG_SIDE = 800;
export const SVG_MAX_ELEMENTS = 5000;
export const SVG_MAX_USE_ELEMENTS = 200;
export const SVG_MAX_DIMENSION = 10_000;
export const SVG_MAX_VIEWBOX = 100_000;
export const SVG_RASTER_TIMEOUT_MS = 5_000;

export type SvgRejection =
  | "too_large"
  | "not_svg"
  | "doctype"
  | "script"
  | "event_handler"
  | "external_reference"
  | "embedded_content"
  | "too_complex"
  | "bad_dimensions";

const SVG_FORBIDDEN: [RegExp, SvgRejection][] = [
  [/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i, "doctype"],
  [/<\s*script\b|javascript:/i, "script"],
  [/\son[a-z]+\s*=/i, "event_handler"],
  [/<\s*(foreignObject|image|iframe|embed|object|audio|video|canvas|feImage)\b/i, "embedded_content"],
  [/@import|@font-face/i, "external_reference"],
];

function rootSvgTag(text: string): string | null {
  const m = text.match(/<svg\b[^>]{0,4000}>/i);
  return m ? m[0] : null;
}

function attrOf(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])([^"']*)\\1`, "i"));
  return m ? m[2].trim() : null;
}

/** width/height: unitless or px → number; relative units → null (the
 * viewBox decides); anything else, or out of bounds → "invalid". */
function pxLength(value: string | null): number | null | "invalid" {
  if (value === null) return null;
  const m = value.match(/^([0-9]*\.?[0-9]+)(px)?$/i);
  if (!m) return /^[0-9]*\.?[0-9]+(%|em|ex|pt|pc|cm|mm|in)$/i.test(value) ? null : "invalid";
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 && n <= SVG_MAX_DIMENSION ? n : "invalid";
}

/** Strict safe-subset gate for an untrusted SVG (exported for tests). */
export function inspectSvg(body: Buffer): { ok: true } | { ok: false; reason: SvgRejection } {
  if (body.length === 0 || body.length > SAFE_FETCH_SVG_MAX_BYTES) return { ok: false, reason: "too_large" };
  const text = body.toString("utf8");
  if (text.includes("�") || text.includes("\u0000")) return { ok: false, reason: "not_svg" };
  if (!/^﻿?\s*(<\?xml[^>]{0,200}\?>\s*)?(<!--[\s\S]{0,2000}?-->\s*)*<svg[\s>]/i.test(text)) return { ok: false, reason: "not_svg" };
  for (const [pattern, reason] of SVG_FORBIDDEN) if (pattern.test(text)) return { ok: false, reason };
  // Every reference must stay inside this document.
  for (const m of text.matchAll(/\bhref\s*=\s*(["'])([^"']*)\1/gi)) if (!m[2].trim().startsWith("#")) return { ok: false, reason: "external_reference" };
  if (/\bhref\s*=\s*[^"'\s>]/i.test(text)) return { ok: false, reason: "external_reference" };
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) if (!m[2].trim().startsWith("#")) return { ok: false, reason: "external_reference" };
  if ((text.match(/<[a-zA-Z]/g) ?? []).length > SVG_MAX_ELEMENTS) return { ok: false, reason: "too_complex" };
  if ((text.match(/<\s*use\b/gi) ?? []).length > SVG_MAX_USE_ELEMENTS) return { ok: false, reason: "too_complex" };
  const root = rootSvgTag(text);
  if (!root) return { ok: false, reason: "not_svg" };
  const width = pxLength(attrOf(root, "width"));
  const height = pxLength(attrOf(root, "height"));
  if (width === "invalid" || height === "invalid") return { ok: false, reason: "bad_dimensions" };
  const viewBox = attrOf(root, "viewBox");
  if (viewBox !== null) {
    const parts = viewBox.split(/[\s,]+/).filter(Boolean).map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || Math.abs(n) > SVG_MAX_VIEWBOX) || parts[2] <= 0 || parts[3] <= 0) {
      return { ok: false, reason: "bad_dimensions" };
    }
  } else if (!width || !height) {
    return { ok: false, reason: "bad_dimensions" };
  }
  return { ok: true };
}

/** Renders an INSPECTED SVG to a transparent PNG whose long side is at most
 * SVG_RASTER_LONG_SIDE, preserving aspect ratio (fit inside, never
 * cropped). Null on any failure or timeout. Exported for tests. */
export async function rasterizeSvgLogo(body: Buffer): Promise<Buffer | null> {
  const run = async () => {
    const meta = await sharp(body, { limitInputPixels: BRAND_IMAGE_PIXEL_LIMIT }).metadata();
    if (meta.format !== "svg" || !meta.width || !meta.height) return null;
    // Render the vector at about the target size (never scale a tiny
    // bitmap up); bounded either way.
    const density = Math.min(2400, Math.max(1, (72 * SVG_RASTER_LONG_SIDE) / Math.max(meta.width, meta.height)));
    return sharp(body, { density, limitInputPixels: BRAND_IMAGE_PIXEL_LIMIT })
      .resize({ width: SVG_RASTER_LONG_SIDE, height: SVG_RASTER_LONG_SIDE, fit: "inside", withoutEnlargement: true })
      .png()
      .timeout({ seconds: Math.ceil(SVG_RASTER_TIMEOUT_MS / 1000) })
      .toBuffer();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([run(), new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), SVG_RASTER_TIMEOUT_MS)))]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** SVG logo candidate → verified PNG logo, through the SAME checks as any
 * raster logo. Never throws (the caller catches). */
async function fetchVerifiedSvgLogo(
  url: string,
  deps: BrandImageDeps
): Promise<{ ok: true; image: VerifiedBrandImage } | { ok: false; reason: BrandImageRejection }> {
  const fetched = await (deps.fetchSvg ?? ((u: string) => safeFetchSvg(u)))(url);
  if (!fetched.ok) return { ok: false, reason: "fetch_failed" };
  if (fetched.contentType.split(";")[0].trim().toLowerCase() !== "image/svg+xml") return { ok: false, reason: "type_mismatch" };
  if (!inspectSvg(fetched.body).ok) return { ok: false, reason: "invalid_file" };
  const png = await rasterizeSvgLogo(fetched.body);
  if (!png || png.length === 0) return { ok: false, reason: "unreadable" };
  return verifyRasterBytes(png, "image/png", "logo");
}

/** The raster verification shared by fetched rasters and rasterized SVGs:
 * actual bytes decide the format, declared type must match, dimension /
 * suitability rules, and (covers) the low-information-graphic test. */
export async function verifyRasterBytes(
  body: Buffer,
  declared: string,
  role: BrandImageRole
): Promise<{ ok: true; image: VerifiedBrandImage } | { ok: false; reason: BrandImageRejection }> {
  // The ACTUAL bytes decide the format (validateImageFile sniffs them and
  // reports the real type, which is what gets stored). A CDN's label is
  // only a first gate: real CDNs say image/jpg, octet-stream, or serve a
  // negotiated WebP under a JPEG label — none of which makes the bytes
  // unsafe. Never HEIC (converted) and never anything that isn't an image.
  if (!BRAND_IMAGE_DECLARED_TYPES.has(declared)) return { ok: false, reason: "type_mismatch" };
  const sniffType = declared.startsWith("image/") && declared !== "image/jpg" && declared !== "image/pjpeg" ? declared : "image/png";
  const file = new File([new Uint8Array(body)], "brand-candidate", { type: sniffType });
  const validated = await validateImageFile(file);
  if ("error" in validated) return { ok: false, reason: "invalid_file" };
  if (validated.converted) return { ok: false, reason: "type_mismatch" };
  let width: number | undefined;
  let height: number | undefined;
  try {
    const meta = await sharp(body, { limitInputPixels: BRAND_IMAGE_PIXEL_LIMIT }).metadata();
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
      if (await isLowInformationGraphic(body)) return { ok: false, reason: "graphic" };
    } catch {
      return { ok: false, reason: "unreadable" };
    }
  }
  return { ok: true, image: { role, body, validated, width, height } };
}

/** Fetches and fully verifies one candidate. Never throws. */
export async function fetchVerifiedBrandImage(
  url: string,
  role: BrandImageRole,
  deps: BrandImageDeps = defaultDeps
): Promise<{ ok: true; image: VerifiedBrandImage } | { ok: false; reason: BrandImageRejection }> {
  try {
    // VCL A3c — an SVG LOGO candidate takes the inspect → rasterize path;
    // covers never do (an SVG cover URL still fails the raster fetch).
    if (role === "logo" && isSvgCandidateUrl(url)) return await fetchVerifiedSvgLogo(url, deps);
    const fetched = await deps.fetchImage(url);
    if (!fetched.ok) return { ok: false, reason: "fetch_failed" };
    return await verifyRasterBytes(fetched.body, fetched.contentType.split(";")[0].trim().toLowerCase(), role);
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

// ── Staged verified candidates (one fetch per Build) ─────────────────────
//
// A logo/cover that passed verification during the Build is staged ONCE in
// Findmi storage under brand-drafts/<userId>/<uuid>.<ext> (verified raster
// bytes only; an SVG is staged as its verified PNG). Review shows that
// staged copy and Business creation re-validates and re-hosts it — so a
// verified image can no longer vanish because the third-party site or CDN
// refuses, times out or changes on a second or third fetch. The draft
// cookie (signed, user-bound) carries only the short staging path, and
// every use re-checks that the path belongs to the signed-in user.

export const BRAND_STAGING_PREFIX = "brand-drafts";
const STAGED_PATH = /^brand-drafts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/;
const EXT_TYPE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** True when `path` is a well-formed staging path owned by `userId`. */
export function isStagedPathFor(path: string | null | undefined, userId: string): boolean {
  const m = typeof path === "string" ? STAGED_PATH.exec(path) : null;
  return Boolean(m && m[1] === userId.toLowerCase());
}

/** Stages a VERIFIED image for this user; returns its path or null. */
export async function stageBrandImage(admin: SupabaseClient, userId: string, image: VerifiedBrandImage): Promise<string | null> {
  try {
    const ext = image.validated.extension === "jpeg" ? "jpg" : image.validated.extension;
    if (!EXT_TYPE[ext]) return null;
    const path = `${BRAND_STAGING_PREFIX}/${userId.toLowerCase()}/${randomUUID()}.${ext}`;
    if (!isStagedPathFor(path, userId)) return null;
    const { error } = await admin.storage.from(UPLOAD_BUCKET).upload(path, image.body, { contentType: EXT_TYPE[ext], upsert: false, cacheControl: "600" });
    return error ? null : path;
  } catch {
    return null;
  }
}

/** Public URL of a staged image (display only; the bytes are verified). */
export function stagedBrandImageUrl(admin: SupabaseClient, path: string): string {
  return admin.storage.from(UPLOAD_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Re-loads and RE-VERIFIES a staged image owned by `userId`. */
export async function loadStagedBrandImage(
  admin: SupabaseClient,
  userId: string,
  path: string,
  role: BrandImageRole
): Promise<VerifiedBrandImage | null> {
  if (!isStagedPathFor(path, userId)) return null;
  try {
    const { data, error } = await admin.storage.from(UPLOAD_BUCKET).download(path);
    if (error || !data || data.size > SAFE_FETCH_SVG_MAX_BYTES * 40) return null;
    const ext = path.slice(path.lastIndexOf(".") + 1);
    const verified = await verifyRasterBytes(Buffer.from(await data.arrayBuffer()), EXT_TYPE[ext], role);
    return verified.ok ? verified.image : null;
  } catch {
    return null;
  }
}

/** Removes this user's staged images (best effort; bounded). */
export async function clearStagedBrandImages(admin: SupabaseClient, userId: string): Promise<void> {
  try {
    const folder = `${BRAND_STAGING_PREFIX}/${userId.toLowerCase()}`;
    const { data } = await admin.storage.from(UPLOAD_BUCKET).list(folder, { limit: 50 });
    const paths = (data ?? []).map((f) => `${folder}/${f.name}`).filter((p) => isStagedPathFor(p, userId));
    if (paths.length) await admin.storage.from(UPLOAD_BUCKET).remove(paths);
  } catch {
    // best effort
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
