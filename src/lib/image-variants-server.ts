import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { VARIANT_SIZES, markedOriginalName, variantPath, type VariantSize } from "./image-variants";

// Findmi image variants — server-side generation + storage. See
// lib/image-variants.ts for the path convention. Variants are an
// OPTIMIZATION LAYER: the original is always the canonical asset, never
// modified, and a variant failure never fails the user's upload.

/** WebP settings per size — photographic quality, not byte-chasing.
 * alphaQuality 100 keeps transparent logo edges clean; smartSubsample
 * keeps saturated edges (red/aqua type, logos) crisp. */
export const VARIANT_WEBP: Record<VariantSize, { quality: number }> = {
  160: { quality: 82 },
  800: { quality: 80 },
  1600: { quality: 82 },
};
export const VARIANT_CACHE_CONTROL = "31536000"; // immutable content under a fresh path
const MAX_INPUT_PIXELS = 80_000_000;

export interface GeneratedVariant {
  size: VariantSize;
  buffer: Buffer;
  width: number;
  height: number;
}

/** Formats variants are generated for. GIF is left as-is (animation would
 * be flattened); HEIC/HEIF arrive here already converted to JPEG by
 * validateImageFile (sharp's bundled libheif has no HEVC decoder). */
export function canGenerateVariants(contentType: string): boolean {
  return /^image\/(jpeg|png|webp)$/i.test(contentType);
}

/** 160/800/1600 WebP variants: longest edge ≤ size, aspect ratio kept,
 * never upscaled, EXIF orientation applied (then stripped), alpha kept,
 * converted to sRGB. Throws on undecodable/animated input. */
export async function generateImageVariants(input: Buffer): Promise<GeneratedVariant[]> {
  const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if ((meta.pages ?? 1) > 1) throw new Error("animated image — variants skipped");
  return Promise.all(
    VARIANT_SIZES.map(async (size) => {
      const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
        .webp({ quality: VARIANT_WEBP[size].quality, alphaQuality: 100, smartSubsample: true, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      return { size, buffer: data, width: info.width, height: info.height };
    })
  );
}

/** Uploads generated variants for `originalPath`. All-or-nothing: on any
 * failure the variants already written are removed again, so a path
 * either has every variant or none. Never touches the original. */
async function uploadVariants(admin: SupabaseClient, bucket: string, originalPath: string, variants: GeneratedVariant[]): Promise<boolean> {
  const paths = variants.map((v) => variantPath(originalPath, v.size));
  const results = await Promise.all(
    variants.map((v, i) =>
      admin.storage
        .from(bucket)
        .upload(paths[i], v.buffer, { contentType: "image/webp", upsert: false, cacheControl: VARIANT_CACHE_CONTROL })
        .then(({ error }) => !error)
        .catch(() => false)
    )
  );
  if (results.every(Boolean)) return true;
  await admin.storage.from(bucket).remove(paths.filter((_, i) => results[i])).catch(() => undefined);
  return false;
}

/** The one upload path for PUBLIC images (findmi-media): validate first
 * (caller), then variants → original. When every variant is stored the
 * original gets the marked name (see lib/image-variants.ts), otherwise the
 * plain `{uuid}.{ext}` name exactly as before — the upload itself only
 * fails if the ORIGINAL can't be stored. */
export async function storePublicImage(
  admin: SupabaseClient,
  bucket: string,
  validated: { extension: string; contentType: string; converted?: { buffer: Buffer } },
  file: File
): Promise<{ path: string; variants: boolean } | { error: string }> {
  const id = randomUUID();
  let variantsStored = false;
  let markedPath: string | null = null;
  if (canGenerateVariants(validated.contentType)) {
    try {
      const source = validated.converted?.buffer ?? Buffer.from(await file.arrayBuffer());
      const variants = await generateImageVariants(source);
      markedPath = markedOriginalName(id, validated.extension);
      variantsStored = await uploadVariants(admin, bucket, markedPath, variants);
      if (!variantsStored) console.warn("[image-variants] variant upload failed; storing original only", { bucket });
    } catch (err) {
      console.warn("[image-variants] variant generation skipped", { bucket, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  const path = variantsStored && markedPath ? markedPath : `${id}.${validated.extension}`;
  const { error } = await admin.storage.from(bucket).upload(path, validated.converted?.buffer ?? file, {
    contentType: validated.contentType,
    upsert: false,
    cacheControl: VARIANT_CACHE_CONTROL, // fresh UUID path, never overwritten
  });
  if (error) {
    if (variantsStored) await admin.storage.from(bucket).remove(VARIANT_SIZES.map((s) => variantPath(path, s))).catch(() => undefined);
    return { error: error.message };
  }
  return { path, variants: variantsStored };
}

/** Generates and stores the private variants of an already-stored journal
 * original (read back from Storage when `source` isn't supplied). Returns
 * whether variants exist afterwards. Safe to call off the request path. */
export async function storePrivateVariants(admin: SupabaseClient, bucket: string, originalPath: string, source?: Buffer): Promise<boolean> {
  try {
    let input = source;
    if (!input) {
      const { data, error } = await admin.storage.from(bucket).download(originalPath);
      if (error || !data) throw new Error(error?.message ?? "download failed");
      input = Buffer.from(await data.arrayBuffer());
    }
    const ok = await uploadVariants(admin, bucket, originalPath, await generateImageVariants(input));
    if (!ok) console.warn("[image-variants] private variant upload failed", { bucket });
    return ok;
  } catch (err) {
    console.warn("[image-variants] private variant generation skipped", { bucket, reason: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Variant paths to remove alongside an original (missing ones are fine). */
export function variantPathsFor(originalPath: string): string[] {
  return VARIANT_SIZES.map((s) => variantPath(originalPath, s));
}

/** Runs `task` over items with bounded concurrency (sharp is CPU-heavy). */
export async function mapLimit<T>(items: T[], limit: number, task: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await task(items[next++]);
    })
  );
}
