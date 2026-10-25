import "server-only";
import { stripImageMetadata } from "./image-metadata";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeFetchBrandImage, safeFetchSvg, SAFE_FETCH_SVG_MAX_BYTES, type SafeFetchContentIssue, type SafeFetchFailure, type SafeFetchImageResult } from "./safe-fetch";
import { inlineSvgMarkup, isInlineSvgCandidate, isSvgCandidateUrl } from "./brand-website-extract";
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
  "image/avif",
  "image/x-png",
  "application/octet-stream",
  "binary/octet-stream",
]);
const UPLOAD_BUCKET = "findmi-media";
const PREVIEW_MAX_BYTES = 120 * 1024;

/** Brand media acceptance contract (Brand media pipeline):
 *
 *   SECURITY / INTEGRITY (hard): safe fetch, real image bytes (signature),
 *   successful decode under BRAND_IMAGE_PIXEL_LIMIT, ≤ 6000px long side
 *   (logos) / ≤ 10000px (covers), strict SVG inspection.
 *   PROVENANCE: only identity-sourced URLs ever reach logo verification
 *   (lib/brand-website-extract); covers only from share/hero evidence.
 *   CONTENT (objective): not blank / near-blank, not a featureless
 *   one-colour block (logoContent); covers not a low-information graphic.
 *   SIZE: a RASTER logo must have usable resolution (≥ 120px long side,
 *   ≥ 40px short side); a VECTOR logo is rendered at SVG_RASTER_LONG_SIDE,
 *   so resolution is never the problem.
 *   ASPECT: for logos only a SANITY bound (LOGO_MAX_ASPECT), not a design
 *   preference — square, round, badge, tall and very wide wordmarks all
 *   pass. Beyond 24:1 a mark is a line: even 800px wide it is ≤ 33px tall,
 *   and such assets are rules, dividers and progress bars, not identity.
 *   Covers keep their landscape window (they fill a fixed banner crop).
 * Exported for tests. */
export const LOGO_MAX_ASPECT = 24;
/** @deprecated name kept for callers/tests: the one logo sanity bound. */
export const SVG_WORDMARK_MAX_RATIO = LOGO_MAX_ASPECT;
export function isSuitableBrandImage(role: BrandImageRole, width: number, height: number, opts: { vectorWordmark?: boolean } = {}): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (role === "logo") {
    if (long > 6000 || long < 120 || long / short > LOGO_MAX_ASPECT) return false;
    return opts.vectorWordmark ? true : short >= 40;
  }
  return width >= 600 && height >= 300 && width / height >= 1.2 && width / height <= 3.5 && long <= 10000;
}

export interface VerifiedBrandImage {
  role: BrandImageRole;
  body: Buffer;
  validated: ImageValidationResult;
  width: number;
  height: number;
  /** Diagnostics: how the verified bytes were normalized, if at all. */
  normalized?: "avif" | "dark_plate";
}

export type BrandImageRejection = "fetch_failed" | "invalid_file" | "type_mismatch" | "unreadable" | "unsuitable" | "graphic" | "blank";

/** Why a candidate's fetch failed — the safe-fetch failure code and the
 * last HTTP status, nothing else (no URL, query, body or headers). Lets
 * diagnostics tell "the CDN refused (403)" from a timeout, a rejected
 * redirect or a non-image response. */
export interface BrandImageFetchDetail {
  code: SafeFetchFailure | "error";
  status?: number;
  /** The response's media type (sanitized), when one arrived. */
  type?: string;
  /** Which unsupported_content case: media_type / encoding / decode. */
  issue?: SafeFetchContentIssue;
  /** The candidate path's file extension ("jpg", "webp", "none") — never the URL. */
  ext?: string;
}

/** A candidate URL's path extension, lowercased letters/digits only (exported for tests). */
export function candidateExtension(url: string): string {
  try {
    const m = /\.([a-z0-9]{1,5})$/i.exec(new URL(url).pathname);
    return m ? m[1].toLowerCase() : "none";
  } catch {
    return "none";
  }
}

/** Why an image that arrived was refused as a logo/cover — measurements
 * only (never markup, bytes or URLs):
 *   aspect_ratio / too_small / too_large / no_dimensions — the suitability
 *     rule that failed;
 *   blank / near_white / solid_fill — what an SVG mark actually draws.
 * width/height are the checked (rendered) pixels; ink is drawn coverage %. */
export type BrandImageMeasureCode = "aspect_ratio" | "too_small" | "too_large" | "no_dimensions" | "blank" | "near_white" | "solid_fill";
export interface BrandImageMeasure {
  code: BrandImageMeasureCode;
  width?: number;
  height?: number;
  ink?: number;
}

/** Diagnostics label for a failed verification (exported for tests):
 * "fetch_failed:unsupported_content:200:media_type:image/avif",
 * "unsuitable:aspect_ratio:800x53:r15.1", "blank:near_white:800x80:r10.0:ink31.2" —
 * reason, safe-fetch code, status, media type and measurements only. */
export function brandImageFailureReason(r: { reason: BrandImageRejection; fetch?: BrandImageFetchDetail; measure?: BrandImageMeasure }): string {
  if (r.fetch) {
    const f = r.fetch;
    return `${r.reason}:${f.code}${f.status !== undefined ? `:${f.status}` : ""}${f.issue ? `:${f.issue}` : ""}${f.type ? `:${f.type}` : ""}${f.ext ? `:ext=${f.ext}` : ""}`;
  }
  if (r.measure) {
    const m = r.measure;
    const dims = m.width && m.height ? `:${m.width}x${m.height}:r${(Math.max(m.width, m.height) / Math.min(m.width, m.height)).toFixed(1)}` : "";
    return `${r.reason}:${m.code}${dims}${m.ink !== undefined ? `:ink${m.ink}` : ""}`;
  }
  return r.reason;
}

type VerifyResult = { ok: true; image: VerifiedBrandImage } | { ok: false; reason: BrandImageRejection; fetch?: BrandImageFetchDetail; measure?: BrandImageMeasure };
const safeType = (t: string | undefined) => {
  const v = (t ?? "").toLowerCase().split(";")[0].trim();
  return /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,60}$/.test(v) ? v : undefined;
};
const fetchFailure = (f: { code: SafeFetchFailure; status?: number; contentType?: string; contentIssue?: SafeFetchContentIssue }): VerifyResult => {
  const type = safeType(f.contentType);
  return {
    ok: false,
    reason: "fetch_failed",
    fetch: {
      code: f.code,
      ...(typeof f.status === "number" ? { status: f.status } : {}),
      ...(f.contentIssue ? { issue: f.contentIssue } : {}),
      ...(type ? { type } : {}),
    },
  };
};

/** Which suitability rule failed (exported for tests); null = suitable. */
export function brandImageSuitabilityFailure(role: BrandImageRole, width: number, height: number, opts: { vectorWordmark?: boolean } = {}): BrandImageMeasureCode | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "no_dimensions";
  if (isSuitableBrandImage(role, width, height, opts)) return null;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (role === "logo") {
    if (long > 6000) return "too_large";
    if (long / short > LOGO_MAX_ASPECT) return "aspect_ratio";
    return "too_small";
  }
  if (long > 10000) return "too_large";
  if (width < 600 || height < 300) return "too_small";
  return "aspect_ratio";
}

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

// Brand media uses the Brand image capability (adds AVIF / image/x-png
// labels); Event Import keeps the narrower shared safeFetchImage.
const defaultDeps: BrandImageDeps = { fetchImage: (url) => safeFetchBrandImage(url), fetchSvg: (url) => safeFetchSvg(url) };

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
): Promise<VerifyResult> {
  const fetched = await (deps.fetchSvg ?? ((u: string) => safeFetchSvg(u)))(url);
  if (!fetched.ok) return fetchFailure(fetched);
  if (fetched.contentType.split(";")[0].trim().toLowerCase() !== "image/svg+xml") return { ok: false, reason: "type_mismatch" };
  return verifySvgLogoBody(fetched.body);
}

/** One SVG logo body (fetched or inline) → verified PNG: strict inspection,
 * rasterization, a visible-mark check, then the raster checks with the
 * vector-wordmark aspect allowance. */
async function verifySvgLogoBody(body: Buffer): Promise<VerifyResult> {
  if (!inspectSvg(body).ok) return { ok: false, reason: "invalid_file" };
  const png = await rasterizeSvgLogo(body);
  if (!png || png.length === 0) return { ok: false, reason: "unreadable" };
  // Content (blank / block / light-on-clear) is checked for EVERY logo in
  // verifyRasterBytes — raster files and rendered SVGs alike.
  return verifyRasterBytes(png, "image/png", "logo", { vectorWordmark: true });
}

/** What a rasterized SVG mark actually draws (exported for tests), measured
 * on a ≤ 200px thumbnail: "ink" = pixels with alpha ≥ 32.
 *   visible — at least 1% ink, and that ink is not all near-white (a white
 *             mark on a transparent background is invisible on Findmi's
 *             white surfaces — empty beats an invisible logo);
 *   solid   — ≥ 97% ink AND ≥ 97% of it one colour: a featureless filled
 *             block. A badge logo (lettering on a filled shape — white on
 *             black, navy on gold) is fully opaque but two-tone, so it is
 *             NOT solid. Colours are quantized to 3 bits per channel. */
export const SVG_INK_MIN = 0.01;
export const SVG_INK_SOLID = 0.97;
export async function svgLogoInk(png: Buffer): Promise<{ coverage: number; visible: boolean; solid: boolean; lightOnClear: boolean }> {
  const { data, info } = await sharp(png, { limitInputPixels: BRAND_IMAGE_PIXEL_LIMIT })
    .ensureAlpha()
    .resize(200, 200, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  let ink = 0;
  let dark = 0;
  const colours = new Map<number, number>();
  for (let i = 0; i + 3 < data.length; i += info.channels) {
    if (data[i + 3] < 32) continue;
    ink += 1;
    // Rec. 601 luma; anything not near-white counts as visible ink.
    if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 235) dark += 1;
    const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
    colours.set(key, (colours.get(key) ?? 0) + 1);
  }
  const coverage = pixels ? ink / pixels : 0;
  const dominant = ink ? Math.max(...colours.values()) / ink : 0;
  const visible = coverage >= SVG_INK_MIN && dark / pixels >= SVG_INK_MIN;
  return {
    coverage,
    visible,
    solid: coverage >= SVG_INK_SOLID && dominant >= SVG_INK_SOLID,
    // A real mark drawn only in white/near-white on a transparent
    // background (common for brands with dark headers): content exists,
    // it just needs a dark plate to be visible on Findmi's light surfaces.
    lightOnClear: !visible && coverage >= SVG_INK_MIN && coverage < SVG_INK_SOLID,
  };
}
/** The same content measurement, for every logo (raster or rendered SVG). */
export const logoContent = (png: Buffer) => svgLogoInk(png);
/** Plate colour behind a light-only transparent logo (near-black). */
export const LOGO_DARK_PLATE = "#111111";

// ── AVIF: identified by its bytes, decoded, normalized ───────────────────
/** True for an AVIF file by its ISO-BMFF signature (ftyp + an avif/avis
 * brand). Exported for tests. HEIC (HEVC) is NOT AVIF and is refused. */
export function isAvifBytes(b: Buffer): boolean {
  if (b.length < 16 || b.toString("latin1", 4, 8) !== "ftyp") return false;
  const brands = new Set<string>([b.toString("latin1", 8, 12)]);
  const box = Math.min(b.readUInt32BE(0), 64, b.length);
  for (let o = 16; o + 4 <= box; o += 4) brands.add(b.toString("latin1", o, o + 4));
  return brands.has("avif") || brands.has("avis");
}
/** AVIF bytes → normalized WebP (first frame, EXIF orientation applied),
 * decoded by the trusted image stack under the pixel limit and a timeout.
 * Null when the bytes aren't a decodable AV1 image. */
export async function normalizeAvif(body: Buffer): Promise<Buffer | null> {
  try {
    const meta = await sharp(body, { limitInputPixels: BRAND_IMAGE_PIXEL_LIMIT }).metadata();
    if (meta.format !== "heif" || meta.compression !== "av1" || !meta.width || !meta.height) return null;
    return await sharp(body, { limitInputPixels: BRAND_IMAGE_PIXEL_LIMIT, animated: false }).rotate().webp({ quality: 90 }).timeout({ seconds: 10 }).toBuffer();
  } catch {
    return null;
  }
}

/** Modern site extraction — the page's INLINE SVG brand mark (carried as an
 * untrusted data: candidate, never fetched): the same strict inspection,
 * rasterization and raster verification as a fetched SVG logo. Never
 * stored or served as SVG. */
async function verifyInlineSvgLogo(url: string): Promise<VerifyResult> {
  const markup = inlineSvgMarkup(url);
  if (!markup) return { ok: false, reason: "invalid_file" };
  return verifySvgLogoBody(Buffer.from(markup, "utf8"));
}

/** The raster verification shared by fetched rasters and rasterized SVGs:
 * actual bytes decide the format, declared type must match, dimension /
 * suitability rules, and (covers) the low-information-graphic test. */
export async function verifyRasterBytes(
  body: Buffer,
  declared: string,
  role: BrandImageRole,
  opts: { vectorWordmark?: boolean } = {}
): Promise<VerifyResult> {
  // The ACTUAL bytes decide the format (validateImageFile sniffs them and
  // reports the real type, which is what gets stored). A CDN's label is
  // only a first gate: real CDNs say image/jpg, octet-stream, or serve a
  // negotiated WebP under a JPEG label — none of which makes the bytes
  // unsafe. Never HEIC (converted) and never anything that isn't an image.
  if (!BRAND_IMAGE_DECLARED_TYPES.has(declared)) return { ok: false, reason: "type_mismatch" };
  let normalized: VerifiedBrandImage["normalized"];
  // AVIF (whatever the label): identified by its bytes, decoded by the
  // trusted stack and normalized to WebP — only the normalized bytes go on.
  if (isAvifBytes(body)) {
    const webp = await normalizeAvif(body);
    if (!webp) return { ok: false, reason: "invalid_file" };
    body = webp;
    declared = "image/webp";
    normalized = "avif";
  }
  const sniffType = declared.startsWith("image/") && !["image/jpg", "image/pjpeg", "image/avif", "image/x-png"].includes(declared) ? declared : "image/png";
  let validated = await validateImageFile(new File([new Uint8Array(body)], "brand-candidate", { type: sniffType }));
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
  if (!width || !height || !isSuitableBrandImage(role, width, height, opts)) {
    return { ok: false, reason: "unsuitable", measure: { code: brandImageSuitabilityFailure(role, width ?? 0, height ?? 0, opts) ?? "no_dimensions", ...(width && height ? { width, height } : {}) } };
  }
  // Every logo must actually show something: blank / near-blank and
  // featureless one-colour blocks are refused; a light-only mark on a
  // transparent background is kept on a dark plate so it stays visible.
  if (role === "logo") {
    try {
      const ink = await logoContent(body);
      const at = { width, height, ink: Math.round(ink.coverage * 1000) / 10 };
      if (ink.solid) return { ok: false, reason: "unsuitable", measure: { code: "solid_fill", ...at } };
      if (!ink.visible && !ink.lightOnClear) return { ok: false, reason: "blank", measure: { code: ink.coverage < SVG_INK_MIN ? "blank" : "near_white", ...at } };
      if (ink.lightOnClear) {
        body = await sharp(body, { limitInputPixels: BRAND_IMAGE_PIXEL_LIMIT, animated: false }).flatten({ background: LOGO_DARK_PLATE }).png().toBuffer();
        const plated = await validateImageFile(new File([new Uint8Array(body)], "brand-candidate", { type: "image/png" }));
        if ("error" in plated) return { ok: false, reason: "unreadable" };
        validated = plated;
        normalized = "dark_plate";
      }
    } catch {
      return { ok: false, reason: "unreadable" };
    }
  }
  // A cover must be a picture, not a wordmark/logo share graphic. When
  // in doubt the cover is dropped (a human can add one at review).
  if (role === "cover") {
    try {
      if (await isLowInformationGraphic(body)) return { ok: false, reason: "graphic" };
    } catch {
      return { ok: false, reason: "unreadable" };
    }
  }
  return { ok: true, image: { role, body, validated, width, height, ...(normalized ? { normalized } : {}) } };
}

/** Fetches and fully verifies one candidate. Never throws. */
export async function fetchVerifiedBrandImage(
  url: string,
  role: BrandImageRole,
  deps: BrandImageDeps = defaultDeps
): Promise<VerifyResult> {
  try {
    // VCL A3c — an SVG LOGO candidate takes the inspect → rasterize path;
    // covers never do (an SVG cover URL still fails the raster fetch).
    if (role === "logo" && isSvgCandidateUrl(url)) return await fetchVerifiedSvgLogo(url, deps);
    // An inline brand mark is a logo only; as a cover it is refused.
    if (isInlineSvgCandidate(url)) return role === "logo" ? await verifyInlineSvgLogo(url) : { ok: false, reason: "type_mismatch" };
    const fetched = await deps.fetchImage(url);
    if (!fetched.ok) {
      const failed = fetchFailure(fetched);
      return !failed.ok && failed.fetch ? { ...failed, fetch: { ...failed.fetch, ext: candidateExtension(url) } } : failed;
    }
    return await verifyRasterBytes(fetched.body, fetched.contentType.split(";")[0].trim().toLowerCase(), role);
  } catch {
    return { ok: false, reason: "fetch_failed", fetch: { code: "error" } };
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
    // Image metadata privacy (Phase 2A): imported images are stored
    // without EXIF/XMP/IPTC, like every user upload.
    const stripped = await stripImageMetadata(image.body, EXT_TYPE[ext]);
    if ("error" in stripped) return null;
    const { error } = await admin.storage.from(UPLOAD_BUCKET).upload(path, stripped.buffer, { contentType: EXT_TYPE[ext], upsert: false, cacheControl: "600" });
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
