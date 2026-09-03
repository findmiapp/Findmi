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

// Security Pass 6 — explicit allowlist (unchanged from its original home
// in lib/admin/upload.ts). image/svg+xml is deliberately excluded — an
// SVG can carry embedded <script>, and this bucket serves files back
// publicly with their original content-type.
const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** First few bytes of each allowed format — catches a file whose actual
 * bytes don't match its claimed (client-supplied, spoofable) MIME type. */
function matchesMagicBytes(header: Uint8Array, mimeType: string): boolean {
  const at = (offset: number, bytes: number[]) => bytes.every((b, i) => header[offset + i] === b);
  switch (mimeType) {
    case "image/jpeg":
      return at(0, [0xff, 0xd8, 0xff]);
    case "image/png":
      return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif":
      return at(0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || at(0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF87a / GIF89a
    case "image/webp":
      return at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]); // "RIFF"...."WEBP"
    default:
      return false;
  }
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
  extension: string;
  /** Set only when the original upload needed server-side conversion
   * before it's safe to store (currently: HEIC/HEIF -> JPEG). When
   * present, the caller must upload THIS buffer/contentType instead of
   * the original File — the original bytes are never valid to store as-
   * is. Absent for every other format, so existing JPG/PNG/WEBP/GIF
   * upload behavior is completely unchanged. */
  converted?: { buffer: Buffer; contentType: string };
}

/** Validates an uploaded File against FindMi's supported image rules —
 * size, HEIC/HEIF conversion, SVG rejection, MIME allowlist, and a magic-
 * byte check that the file's real bytes match what it claims to be.
 * Returns the safe extension (and, for a converted HEIC/HEIF file, the
 * ready-to-upload JPEG bytes) to store it under on success, or a user-
 * facing error message on failure. Never touches Storage or the
 * database — every caller still owns its own authorization and the
 * actual write. */
export async function validateImageFile(file: File): Promise<ImageValidationResult | { error: string }> {
  if (file.size === 0) return { error: "No file selected." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "Image must be under 5MB." };

  // Read enough of the header up front for the HEIC container-signature
  // check below (32 bytes comfortably covers ftyp + major_brand + a
  // handful of compatible_brands on real-world files) — the same slice
  // also covers the 16-byte magic-byte checks further down.
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
      return { extension: "jpg", converted: { buffer: outputBuffer, contentType: "image/jpeg" } };
    } catch {
      // Never let a decode failure (corrupt file, an unsupported HEIC
      // variant, a false-positive container match on a non-image file,
      // etc.) crash the calling Server Action — surface a clean,
      // actionable message instead.
      return {
        error:
          "That HEIC/HEIF photo couldn't be converted. Please try again, or use a JPG or PNG instead — on iPhone, Settings → Camera → Formats → \"Most Compatible\" saves new photos as JPG.",
      };
    }
  }

  if (file.type === "image/svg+xml") {
    return { error: "SVG images aren't supported (they can carry embedded scripts)." };
  }

  const extension = MIME_TO_EXTENSION[file.type];
  if (!extension) {
    return { error: "Only JPG, PNG, WEBP, or GIF images are supported." };
  }

  if (!matchesMagicBytes(header, file.type)) {
    return { error: "That file doesn't look like a valid image of the type it claims to be." };
  }

  return { extension };
}
