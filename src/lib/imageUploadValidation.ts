// Shared image-upload validation — pure functions only, no auth, no
// Supabase client, no Storage writes. Used by BOTH lib/admin/upload.ts
// (founder/admin uploads, gated by requireAdmin()) and the member-facing
// upload action in account/business/actions.ts (gated by
// requireBusinessMember()) so the actual file-safety rules — allowed MIME
// types, magic-byte verification, size limit, HEIC/SVG rejection — live
// in exactly one place and can never drift between the two upload paths.
// This file never decides WHO may upload; each caller's own
// authorization check runs entirely before it's ever reached, and this
// module has no way to weaken or bypass that.

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

export interface ImageValidationResult {
  extension: string;
}

/** Validates an uploaded File against FindMi's supported image rules —
 * size, HEIC/SVG rejection, MIME allowlist, and a magic-byte check that
 * the file's real bytes match what it claims to be. Returns the safe
 * extension to store it under on success, or a user-facing error message
 * on failure. Never touches Storage or the database — every caller still
 * owns its own authorization and the actual write. */
export async function validateImageFile(file: File): Promise<ImageValidationResult | { error: string }> {
  if (file.size === 0) return { error: "No file selected." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "Image must be under 5MB." };

  // HEIC/HEIF (the default format for iPhone camera photos) uploads and
  // stores fine, but almost no browser can render it in an <img>/next/image
  // element — checked ahead of the allowlist purely for this specific,
  // friendlier error message; a HEIC file would also fail the allowlist
  // check either way.
  const isHeic = /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
  if (isHeic) {
    return {
      error:
        "HEIC/HEIF photos aren't supported (most browsers can't display them). Please use a JPG or PNG — on iPhone, Settings → Camera → Formats → \"Most Compatible\" saves new photos as JPG.",
    };
  }

  if (file.type === "image/svg+xml") {
    return { error: "SVG images aren't supported (they can carry embedded scripts)." };
  }

  const extension = MIME_TO_EXTENSION[file.type];
  if (!extension) {
    return { error: "Only JPG, PNG, WEBP, or GIF images are supported." };
  }

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!matchesMagicBytes(header, file.type)) {
    return { error: "That file doesn't look like a valid image of the type it claims to be." };
  }

  return { extension };
}
