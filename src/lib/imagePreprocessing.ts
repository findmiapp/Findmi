// Journal Image Performance V1 — client-side preprocessing for NEW photo
// uploads. Native browser APIs only (createImageBitmap + canvas); no new
// npm dependency. Existing uploaded media is never touched by this file —
// it only ever runs on a File the user is about to upload.
//
// Image-generic on purpose (no Journal concepts baked in) so Business/
// Event/Location galleries can reuse it later without copying logic — see
// the image-performance implementation pass's own note on why those
// galleries aren't ported to it in this same pass.
//
// Scope: photographic JPEG/WEBP/PNG uploads. HEIC/HEIF deliberately
// bypasses this entirely and continues through the existing server-side
// heic-convert path unchanged — see isHeicLike's own note on why.

const MAX_LONG_EDGE = 2048;
const JPEG_QUALITY = 0.82;

// Conservative "already small enough, don't bother re-encoding" threshold
// for non-PNG sources. Chosen well above what a typical already-optimized/
// previously-shared photo weighs (commonly well under 1MB) and well below
// a typical un-resized phone camera original (commonly several MB), so a
// deliberately-chosen smaller photo isn't needlessly re-encoded (and
// possibly degraded) a second time, while a genuine multi-MB original
// still gets the full treatment.
const SKIP_IF_UNDER_BYTES = 1.5 * 1024 * 1024;

function isHeicLike(file: File): boolean {
  // Mirrors the same hint-based check validateImageFile() uses before its
  // own authoritative byte-signature check — good enough here because this
  // is only ever a "should I even try to touch this file" gate; the real
  // safety authority is still the server. A false negative (an HEIC file
  // this misses) just means it goes through the resize path below, which
  // falls back to returning the original file untouched on any decode
  // failure anyway — never a broken upload either way.
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

function isPng(file: File): boolean {
  return file.type === "image/png" || /\.png$/i.test(file.name);
}

function withJpegExtension(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base || "photo"}.jpg`;
}

/**
 * Resizes/recompresses a photographic upload client-side before it ever
 * reaches the network, so the bytes that actually leave the phone (and
 * later get served back out — FindMi's Supabase-hosted images intentionally
 * bypass next/image's own optimizer, see SupabaseImage.tsx) are a sensible
 * size instead of the full original phone resolution.
 *
 * Always falls back to returning the ORIGINAL file, unchanged, on any
 * unsupported API, decode failure, or unexpected error, and never returns
 * a result larger than the original — preprocessing can only make an
 * upload smaller/faster, never block or worsen it. The existing server-side
 * validateImageFile() remains the real authority on what's safe to store.
 */
export async function preprocessImageForUpload(file: File): Promise<File> {
  if (isHeicLike(file)) return file; // unchanged — existing server path owns this
  if (typeof createImageBitmap !== "function") return file;

  const png = isPng(file);

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = bitmap;
    const longEdge = Math.max(width, height);
    const needsResize = longEdge > MAX_LONG_EDGE;

    // PNG Safety — the only lever this utility pulls for a PNG is
    // resizing an oversized image; it never recompresses a PNG that's
    // already within the dimension cap, however large its file size,
    // because PNG has no quality dial and this deliberately never
    // converts PNG to JPEG (a transparent PNG flattened to JPEG would
    // bake in an incorrect background) — see this file's header note.
    // Non-PNG sources also get recompressed when already small-dimension
    // but poorly compressed, since a JPEG quality setting is a safe,
    // simple lever there.
    const shouldProcess = png ? needsResize : needsResize || file.size > SKIP_IF_UNDER_BYTES;
    if (!shouldProcess) {
      bitmap.close();
      return file;
    }

    const scale = needsResize ? MAX_LONG_EDGE / longEdge : 1; // never upscale
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const outputType = png ? "image/png" : "image/jpeg";
    const quality = png ? undefined : JPEG_QUALITY;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, quality));
    if (!blob || blob.size === 0 || blob.size >= file.size) return file;

    const outputName = png ? file.name : withJpegExtension(file.name);
    return new File([blob], outputName, { type: outputType, lastModified: Date.now() });
  } catch {
    return file; // any decode/encode failure — upload the original, unchanged
  }
}
