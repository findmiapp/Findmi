// Shared image-upload validation — pure functions only, no auth, no
// Supabase client, no Storage writes. Used by BOTH lib/admin/upload.ts
// (founder/admin uploads, gated by requireAdmin()) and the member-facing
// upload action in account/business/actions.ts (gated by
// requireBusinessMember()) so the actual file-safety rules — allowed MIME
// types, magic-byte verification, size limit, HEIC conversion, SVG
// rejection — live in exactly one place and can never drift between the
// two upload paths. This file never decides WHO may upload; each caller's
// own authorization check runs entirely before it's ever reached, and this
// module has no way to weaken or bypass that.

import convertHeic from "heic-convert";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Byte-offset match helper — shared by the raster-format detector below
 * and the HEIC container-signature check further down. */
function at(header: Uint8Array, offset: number, bytes: number[]): boolean {
  return bytes.every((b, i) => header[offset + i] === b);
}

/** Launch Stability pass — Upload Format Detection Correction. A real
 * production upload (filename "1000089439.webp", browser-reported
 * image/webp) turned out to be genuine JPEG/JFIF bytes once inspected —
 * the filename/MIME and the actual payload disagreed, which the previous
 * MIME-keyed lookup had no way to catch (it trusted file.type as the
 * SOURCE of the extension, and only used magic bytes as a secondary
 * confirmation AFTER that lookup already succeeded — so a wrong file.type
 * rejected a perfectly valid image before the magic-byte check ever ran).
 *
 * Every raster format below is now identified authoritatively from its
 * own actual byte signature — file.type and the filename are never
 * consulted for these four formats at all. A JPEG mislabeled as .webp is
 * now correctly accepted and normalized to JPEG (never uploaded/stored
 * under a false format). This mirrors the same "trust the real bytes,
 * never the client-supplied hint" discipline the HEIC container-signature
 * check below already used — this pass just extends it to every format,
 * closing the one asymmetry that let this incident happen. */
const RASTER_SIGNATURES: { extension: string; contentType: string; matches: (header: Uint8Array) => boolean }[] = [
  { extension: "jpg", contentType: "image/jpeg", matches: (h) => at(h, 0, [0xff, 0xd8, 0xff]) },
  { extension: "png", contentType: "image/png", matches: (h) => at(h, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  {
    extension: "gif",
    contentType: "image/gif",
    matches: (h) => at(h, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || at(h, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), // GIF87a / GIF89a
  },
  { extension: "webp", contentType: "image/webp", matches: (h) => at(h, 0, [0x52, 0x49, 0x46, 0x46]) && at(h, 8, [0x57, 0x45, 0x42, 0x50]) }, // "RIFF"...."WEBP"
];

/** Returns the real format (by its own byte signature), or null if the
 * bytes don't match any supported raster format — the sole authority for
 * "what kind of image is this," independent of file.type/filename. */
function detectRasterFormat(header: Uint8Array): { extension: string; contentType: string } | null {
  for (const sig of RASTER_SIGNATURES) {
    if (sig.matches(header)) return { extension: sig.extension, contentType: sig.contentType };
  }
  return null;
}

// HEIC/HEIF container signature — the ISO-BMFF "ftyp" box's major_brand
// plus compatible_brands list (bytes 4-8 = "ftyp", 8-12 = major_brand,
// then 4-byte brand codes onward). This is the actual file signature, not
// the client-supplied MIME type or filename — checked in addition to (not
// instead of) the MIME/extension hints below, so a mislabeled-but-real
// HEIC file is still caught, and so a file merely NAMED .heic can't skip
// straight to "trusted" without its content agreeing. avif/avis are
// deliberately excluded from this brand set: that's a different, already
// broadly browser-supported HEIF profile, not part of this HEIC-specific
// conversion.
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);

function looksLikeHeicContainer(header: Uint8Array): boolean {
  if (header.length < 12) return false;
  const brandAt = (offset: number) =>
    String.fromCharCode(header[offset], header[offset + 1], header[offset + 2], header[offset + 3]);
  if (brandAt(4) !== "ftyp") return false;
  if (HEIC_BRANDS.has(brandAt(8))) return true; // major_brand
  for (let offset = 16; offset + 4 <= header.length; offset += 4) {
    if (HEIC_BRANDS.has(brandAt(offset))) return true; // compatible_brands
  }
  return false;
}

export interface ImageValidationResult {
  /** The REAL, byte-detected format's extension — never the claimed/
   * filename one. For an accepted upload, always paired with the
   * matching contentType below. */
  extension: string;
  /** The REAL, byte-detected format's content-type. Callers must use
   * THIS value for the Storage upload — never the original File.type,
   * which is a client-supplied, spoofable/unreliable hint that can
   * disagree with the actual bytes (see this pass's own header comment
   * on RASTER_SIGNATURES). */
  contentType: string;
  /** Set only when the original upload needed server-side conversion
   * before it's safe to store (currently: HEIC/HEIF -> JPEG). When
   * present, the caller must upload THIS buffer instead of the original
   * File — the original bytes are never valid to store as-is. Absent for
   * every other format, so existing JPG/PNG/WEBP/GIF upload behavior is
   * unchanged apart from now being detected by real bytes (see above). */
  converted?: { buffer: Buffer };
}

/** Validates an uploaded File against FindMi's supported image rules —
 * size, HEIC/HEIF conversion, SVG rejection, and byte-signature format
 * detection for JPEG/PNG/WEBP/GIF. Returns the REAL detected extension +
 * contentType (and, for a converted HEIC/HEIF file, the ready-to-upload
 * JPEG bytes) on success, or a user-facing error message on failure.
 * Never touches Storage or the database — every caller still owns its
 * own authorization and the actual write.
 *
 * file.type and file.name are used ONLY as hints for the HEIC/HEIF and
 * SVG branches below (both still corroborated or superseded by an actual
 * byte check — see looksLikeHeicContainer and detectRasterFormat) —
 * never as the basis for what extension/contentType a successfully
 * validated raster image is stored under. */
export async function validateImageFile(file: File): Promise<ImageValidationResult | { error: string }> {
  if (file.size === 0) return { error: "No file selected." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "Image must be under 5MB." };

  // Read enough of the header up front for the HEIC container-signature
  // check below (32 bytes comfortably covers ftyp + major_brand + a
  // handful of compatible_brands on real-world files) — the same slice
  // also covers every raster format's magic-byte signature further down.
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());

  // HEIC/HEIF (the default format for iPhone camera photos) — the
  // client-supplied MIME/filename are spoofable hints, so detection also
  // checks the actual container signature; either is enough to attempt
  // conversion, but the conversion itself (which fully decodes the file)
  // is the real, authoritative check that the bytes are genuinely
  // HEIC/HEIF and not just named/labeled that way.
  const isHeic = /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name) || looksLikeHeicContainer(header);
  if (isHeic) {
    try {
      const inputBuffer = Buffer.from(await file.arrayBuffer());
      const outputBuffer = (await convertHeic({ buffer: inputBuffer, format: "JPEG", quality: 0.85 })) as Buffer;
      return { extension: "jpg", contentType: "image/jpeg", converted: { buffer: outputBuffer } };
    } catch {
      // Never let a decode failure (corrupt file, an unsupported HEIC
      // variant, a false-positive container match on a non-image file,
      // etc.) crash the calling Server Action — surface a clean,
      // actionable message instead.
      return {
        error:
          "That HEIC/HEIF photo couldn't be converted. Please try again, or use a JPG or PNG instead. On iPhone, Settings → Camera → Formats → \"Most Compatible\" saves new photos as JPG.",
      };
    }
  }

  if (file.type === "image/svg+xml") {
    return { error: "SVG images aren't supported (they can carry embedded scripts)." };
  }

  // Launch Stability pass — the real bytes are the sole authority here.
  // file.type/filename are never consulted for JPEG/PNG/WEBP/GIF: a file
  // mislabeled .webp whose actual bytes are JPEG is accepted AS JPEG
  // (see RASTER_SIGNATURES' own header comment); a file whose bytes
  // don't match any of the four supported formats is rejected outright,
  // however "image"-like its extension/MIME claims to be.
  const detected = detectRasterFormat(header);
  if (!detected) {
    return { error: "That file doesn't look like a supported image (JPG, PNG, WEBP, or GIF)." };
  }

  return detected;
}
