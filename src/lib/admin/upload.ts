"use server";

import { requireAdmin } from "./auth";
import { getAdminSupabase } from "./supabase-admin";

const BUCKET = "findmi-media";
const MAX_BYTES = 5 * 1024 * 1024;

// Security Pass 6 — explicit allowlist, matching the same set
// lib/admin/appearance-import.ts's validateImportImage() already
// established as FindMi's supported upload types (that function's own
// comment calls itself a reuse of "the same concepts as
// lib/admin/upload.ts's uploadImage()"). image/svg+xml is deliberately
// excluded — an SVG can carry embedded <script>, and this bucket serves
// files back publicly with their original content-type. image/avif was
// considered (the task's own example allowlist includes it) but left out:
// nothing in FindMi currently produces, reads, or expects an AVIF image
// anywhere, so adding first-time support for a new format isn't this
// hardening pass's call to make unprompted — add "image/avif": "avif" to
// MIME_TO_EXTENSION below (and to MAGIC_BYTE_CHECKS if magic-byte
// verification should cover it too) if that's ever actually wanted.
const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** First few bytes of each allowed format — all four have a short, fixed,
 * unambiguous signature, so this catches a file whose actual bytes don't
 * match its claimed (client-supplied, spoofable) MIME type. Deliberately
 * NOT attempted for formats with no simple fixed signature (e.g. AVIF's
 * ISOBMFF "ftyp" box can carry several different valid major/compatible
 * brand values) — a real image parser would be needed to do that safely,
 * which this pass isn't adding. */
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

/** Uploads one image to the public findmi-media bucket and returns its
 * public URL — the same kind of URL string every image_url/logo_url/
 * cover_image_url field already stores, so no other code needs to change
 * to consume it.
 *
 * Security Pass 4 — this is a "use server" export like any admin Server
 * Action (its own importers, GalleryField.tsx/ImageField.tsx, are
 * currently admin-only, but this function has no way to know that at
 * runtime), so it independently verifies an admin session before touching
 * Storage, rather than trusting that only an already-gated admin page
 * would ever call it. */
export async function uploadImage(formData: FormData): Promise<{ url?: string; error?: string }> {
  try {
    await requireAdmin();
  } catch {
    return { error: "Unauthorized." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file selected." };
  if (file.size > MAX_BYTES) return { error: "Image must be under 5MB." };

  // HEIC/HEIF (the default format for iPhone camera photos) uploads and
  // stores fine, but almost no browser can render it in an <img>/next/image
  // element — the previous symptom was exactly this: a real Storage URL
  // that always shows as a broken image. Checked ahead of the allowlist
  // below purely for this specific, friendlier error message; a HEIC file
  // would also fail the allowlist check either way.
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

  // Spoofed/mislabeled MIME check — the browser-reported Content-Type is
  // entirely client-supplied and easy to fake; this confirms the file's
  // actual bytes match what it claims to be for every format above (all
  // four have a short, fixed signature — see matchesMagicBytes()).
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!matchesMagicBytes(header, file.type)) {
    return { error: "That file doesn't look like a valid image of the type it claims to be." };
  }

  const supabase = getAdminSupabase();
  if (!supabase) return { error: "Storage isn't configured on the server." };

  // Path is built entirely from server-generated values — a random UUID
  // plus the extension looked up from the validated MIME type above, never
  // anything derived from the submitted filename. The original filename
  // (arbitrary, admin-supplied) never touches the storage path at all.
  const path = `${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) return { error: error.message };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}
