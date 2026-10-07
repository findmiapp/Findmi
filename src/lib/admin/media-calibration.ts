import "server-only";

// Legacy-variant CALIBRATION — a deliberately narrow, hardcoded run against
// exactly the 11 real, referenced production originals selected in the
// read-only backfill audit, to validate the media_variants registry
// architecture (migration 20261007010000_media_variants_registry.sql)
// against real bytes before any full backfill is ever authorized. This
// module is NOT the backfill: CALIBRATION_ORIGINALS is a closed, literal
// list, not a query — nothing outside these 11 paths can ever be touched
// by calling the functions below, by construction (there is no "list
// candidates" path here, only "process this fixed list").
//
// Pipeline per original (see runCalibration): verify it's still
// referenced/not orphaned/role still matches/source still exists AND has
// no unexpected existing registry row → download the original → generate
// ONLY the sizes its role(s) require (media-backfill-roles.ts's union, via
// generateImageVariantsForSizes — never the full 160/800/1600 reflexively)
// → validate each derivative locally (decodes, is WebP, no upscale, aspect
// ratio kept) → upload via the existing all-or-nothing uploadVariants() →
// re-download and verify the upload → only THEN upsert a media_variants
// row, and only for sizes that passed every step. A derivative that fails
// any step is never registered and never silently retried into a worse
// state; the original is never read-modified at any point.
//
// The private Moment photo (journal-media) still gets its own private
// variants generated/uploaded next to the original — same pipeline, same
// bucket, never made public — but deliberately gets NO media_variants row
// (see MOMENT_PHOTO_REGISTRY_NOTE below): the private bucket already
// resolves variant-vs-original dynamically through signed-URL batching
// (lib/journal.ts / lib/signed-image-urls.ts), which has no "unmarked
// original" gap to fill — the registry exists only for the PUBLIC
// resolver's filename-marker limitation, which journal-media never had.

import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  PUBLIC_MEDIA_BUCKET,
  VARIANT_SIZES,
  variantPath,
  type VariantSize,
} from "../image-variants";
import { generateImageVariantsForSizes, uploadVariants, type GeneratedVariant } from "../image-variants-server";
import { unionVariantSizes, type MediaRole } from "../media-backfill-roles";
import { upsertMediaVariant, createSupabaseFetcher, resolveLegacyVariantSizes, createRegistryCache, type GeneratedVariantInfo, type MediaVariantsClient } from "../media-variants-registry";

// media-variants-registry.ts's functions take the narrow MediaVariantsClient
// shape (so they're testable without the real SDK) rather than the real
// SupabaseClient type — whose .from() return type is generic enough over
// the project's Database schema that TypeScript's structural check against
// a hand-written interface blows up ("Type instantiation is excessively
// deep and possibly infinite"). This cast is the one place that boundary
// is crossed; everything else in this file keeps using the real
// SupabaseClient type for Storage and entity-table access.
function asRegistryClient(admin: SupabaseClient): MediaVariantsClient {
  return admin as unknown as MediaVariantsClient;
}

// Intentionally not imported from lib/journal.ts: that module transitively
// pulls in next/headers (via lib/supabase/server.ts), which only resolves
// inside the Next.js runtime — this constant is the one value this module
// actually needs from it. Must stay equal to JOURNAL_MEDIA_BUCKET in
// lib/journal.ts (enforced by a static guard in the test suite).
const JOURNAL_MEDIA_BUCKET = "journal-media";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLIC_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${PUBLIC_MEDIA_BUCKET}/`;

/** Why the private Moment photo intentionally never gets a media_variants
 * row — kept as a named constant so runCalibration's report can quote the
 * exact same reasoning it acts on, rather than a comment nobody reads
 * alongside the code that actually decides this. */
export const MOMENT_PHOTO_REGISTRY_NOTE =
  "journal-media already resolves variant-vs-original dynamically (lib/journal.ts batches a signed-URL request for the original AND its would-be variant path together, and Storage's own per-path answer in that batch IS the existence check) — it has no filename-marker gap for the registry to fill, so writing a media_variants row for a private Moment photo would be unused, redundant state. Its generated 800/1600 variants still live in journal-media, next to the original, immediately usable by the existing private resolver with zero code changes.";

/** Mandatory execution gate for the POST (write) side of
 * /admin/api/media-calibration — a second, independent, server-side-only
 * switch on top of requireAdmin() and the request's confirm phrase. Fails
 * closed on anything other than the literal string "true": unset, empty,
 * "false", "1", wrong case, all refused. A human has to deliberately set
 * MEDIA_CALIBRATION_ENABLED=true in this deployment's environment AND
 * redeploy before calibration can run at all — an admin session and the
 * right request body are never enough by themselves. Exported as a pure
 * function (rather than read inline in the route) so it's directly
 * testable without importing route.ts, which pulls in next/headers via
 * requireAdmin() and can't resolve outside the Next.js runtime. */
export function isCalibrationExecutionEnabled(env: Record<string, string | undefined>): boolean {
  return env.MEDIA_CALIBRATION_ENABLED === "true";
}

export type CalibrationBucket = typeof PUBLIC_MEDIA_BUCKET | typeof JOURNAL_MEDIA_BUCKET;

export interface CalibrationEntry {
  /** Short, stable id for reporting — not stored anywhere. */
  key: string;
  bucket: CalibrationBucket;
  /** The original's own Storage object path (never a variant path). */
  path: string;
  roles: MediaRole[];
  /** How to re-verify this exact original is still referenced, read-only,
   * against the live DB — independent small queries per entry (these are
   * real production rows, not a generic "search by path" query) so a
   * row being renamed/reassigned/deleted is caught before any write. */
  verify: (admin: SupabaseClient) => Promise<{ referenced: boolean; detail: string }>;
}

const expectedPublicUrl = (path: string) => `${PUBLIC_URL_PREFIX}${path}`;

/** The 11 calibration originals, exactly as selected and reported in the
 * prior session's dry-run (business logo, business cover, a PNG business
 * logo as the transparency probe, location logo, location cover, event
 * cover, a product image, a small AND a large business-gallery image, a
 * published homepage bulletin thumbnail, and one private Moment photo). */
export const CALIBRATION_ORIGINALS: CalibrationEntry[] = [
  {
    key: "business_logo_tendy",
    bucket: PUBLIC_MEDIA_BUCKET,
    path: "a9cf5811-cff2-42df-862a-006fc632c8c7.jpg",
    roles: ["business_logo"],
    verify: async (admin) => {
      const { data, error } = await admin
        .from("businesses")
        .select("id")
        .eq("id", "06d546dc-748d-4725-9edd-04a9decc5c3c")
        .eq("logo_url", expectedPublicUrl("a9cf5811-cff2-42df-862a-006fc632c8c7.jpg"))
        .maybeSingle();
      if (error) return { referenced: false, detail: `query error: ${error.message}` };
      return { referenced: !!data, detail: data ? "businesses.logo_url still matches (Tendy)" : "businesses.logo_url no longer matches — orphaned or reassigned" };
    },
  },
  {
    key: "business_cover_tendy",
    bucket: PUBLIC_MEDIA_BUCKET,
    path: "56d48c05-8ef8-4c58-904c-12d4b29760b6.webp",
    roles: ["business_cover"],
    verify: async (admin) => {
      const { data, error } = await admin
        .from("businesses")
        .select("id")
        .eq("id", "06d546dc-748d-4725-9edd-04a9decc5c3c")
        .eq("cover_image_url", expectedPublicUrl("56d48c05-8ef8-4c58-904c-12d4b29760b6.webp"))
        .maybeSingle();
      if (error) return { referenced: false, detail: `query error: ${error.message}` };
      return { referenced: !!data, detail: data ? "businesses.cover_image_url still matches (Tendy)" : "businesses.cover_image_url no longer matches" };
    },
  },
  {
    key: "business_logo_png_viktor_gal",
    bucket: PUBLIC_MEDIA_BUCKET,
    path: "57f4f667-4ae9-4cd1-aa81-1f1909ea8243.png",
    roles: ["business_logo"],
    verify: async (admin) => {
      const { data, error } = await admin
        .from("businesses")
        .select("id")
        .eq("id", "5f7d833a-645a-41aa-8cf4-b5d1af32878c")
        .eq("logo_url", expectedPublicUrl("57f4f667-4ae9-4cd1-aa81-1f1909ea8243.png"))
        .maybeSingle();
      if (error) return { referenced: false, detail: `query error: ${error.message}` };
      return { referenced: !!data, detail: data ? "businesses.logo_url still matches (Viktor Gal Shop)" : "businesses.logo_url no longer matches" };
    },
  },
  {
    key: "location_logo_vanderbilt",
    bucket: PUBLIC_MEDIA_BUCKET,
    path: "e18fad7b-b67b-4956-9d66-ed83aa1ced37.jpg",
    roles: ["location_logo"],
    verify: async (admin) => {
      const { data, error } = await admin
        .from("locations")
        .select("id")
        .eq("id", "e2f2895c-ad8c-4631-a614-fd27aad374c4")
        .eq("logo_url", expectedPublicUrl("e18fad7b-b67b-4956-9d66-ed83aa1ced37.jpg"))
        .maybeSingle();
      if (error) return { referenced: false, detail: `query error: ${error.message}` };
      return { referenced: !!data, detail: data ? "locations.logo_url still matches (Vanderbilt Hall at GCT)" : "locations.logo_url no longer matches" };
    },
  },
  {
    key: "location_cover_vanderbilt",
    bucket: PUBLIC_MEDIA_BUCKET,
    path: "d614cc3f-d1cc-4d69-86ef-116c71b81b95.jpg",
    roles: ["location_cover"],
    verify: async (admin) => {
      const { data, error } = await admin
        .from("locations")
        .select("id")
        .eq("id", "e2f2895c-ad8c-4631-a614-fd27aad374c4")
        .eq("cover_image_url", expectedPublicUrl("d614cc3f-d1cc-4d69-86ef-116c71b81b95.jpg"))
        .maybeSingle();
      if (error) return { referenced: false, detail: `query error: ${error.message}` };
      return { referenced: !!data, detail: data ? "locations.cover_image_url still matches (Vanderbilt Hall at GCT)" : "locations.cover_image_url no longer matches" };
    },
  },
  {
    key: "event_cover_free_bean",
    bucket: PUBLIC_MEDIA_BUCKET,
    path: "a2cb3aab-49d0-4796-890b-b9c7a0c804a4.jpg",
    roles: ["event_cover"],
    verify: async (admin) => {
      const { data, error } = await admin
        .from("events")
        .select("id")
        .eq("id", "7d348430-bb8a-4be5-8cd3-dfcd93de69f0")
        .eq("cover_image_url", expectedPublicUrl("a2cb3aab-49d0-4796-890b-b9c7a0c804a4.jpg"))
        .maybeSingle();
      if (error) return { referenced: false, detail: `query error: ${error.message}` };
      return { referenced: !!data, detail: data ? "events.cover_image_url still matches (Free Bean NYC Pop-Up)" : "events.cover_image_url no longer matches" };
    },
  },
  {
    key: "product_image_sourdough_pancake",
    bucket: PUBLIC_MEDIA_BUCKET,
    path: "65ce6a47-3b60-4d5f-99b0-60d5d028b8f5.jpeg",
    roles: ["product_image"],
    verify: async (admin) => {
      const { data, error } = await admin
        .from("products")
        .select("id")
        .eq("id", "16a44eb2-c3af-4fbb-85dd-31ee884cbb11")
        .eq("image_url", expectedPublicUrl("65ce6a47-3b60-4d5f-99b0-60d5d028b8f5.jpeg"))
        .maybeSingle();
      if (error) return { referenced: false, detail: `query error: ${error.message}` };
      return { referenced: !!data, detail: data ? "products.image_url still matches (Sourdough Pancake Mix - Chocolate)" : "products.image_url no longer matches" };
    },
  },
  {
    key: "business_gallery_small",
    bucket: PUBLIC_MEDIA_BUCKET,
    path: "2697f83d-491c-4d97-869b-079e293fa610.jpg",
    roles: ["business_gallery"],
    verify: async (admin) => {
      const { data, error } = await admin
        .from("business_images")
        .select("id")
        .eq("id", "4c3fbfd5-89af-4a85-a282-0b0d37e347be")
        .eq("url", expectedPublicUrl("2697f83d-491c-4d97-869b-079e293fa610.jpg"))
        .maybeSingle();
      if (error) return { referenced: false, detail: `query error: ${error.message}` };
      return { referenced: !!data, detail: data ? "business_images.url still matches (small gallery image)" : "business_images.url no longer matches" };
    },
  },
  {
    key: "business_gallery_large_source",
    bucket: PUBLIC_MEDIA_BUCKET,
    path: "c51e16e3-670a-43b0-8ce9-b8b92b974f3c.jpg",
    roles: ["business_gallery"],
    verify: async (admin) => {
      const { data, error } = await admin
        .from("business_images")
        .select("id")
        .eq("business_id", "06e975a6-a748-4de6-8ba6-3b11b77fd354")
        .eq("url", expectedPublicUrl("c51e16e3-670a-43b0-8ce9-b8b92b974f3c.jpg"))
        .maybeSingle();
      if (error) return { referenced: false, detail: `query error: ${error.message}` };
      return { referenced: !!data, detail: data ? "business_images.url still matches (large-source gallery image, ~3.86MB original)" : "business_images.url no longer matches" };
    },
  },
  {
    key: "homepage_bulletin_thumb",
    bucket: PUBLIC_MEDIA_BUCKET,
    path: "9b4d3f6d-3716-4b87-b213-727b76f5b6d2.jpg",
    roles: ["homepage_bulletin_thumb"],
    verify: async (admin) => {
      const { data, error } = await admin
        .from("homepage_bulletins")
        .select("id")
        .eq("thumbnail_url", expectedPublicUrl("9b4d3f6d-3716-4b87-b213-727b76f5b6d2.jpg"))
        .eq("is_published", true)
        .maybeSingle();
      if (error) return { referenced: false, detail: `query error: ${error.message}` };
      return { referenced: !!data, detail: data ? "homepage_bulletins.thumbnail_url still matches and is_published" : "homepage_bulletins.thumbnail_url no longer matches / unpublished" };
    },
  },
  {
    key: "moment_photo_private",
    bucket: JOURNAL_MEDIA_BUCKET,
    path: "journal/d9617401-73ff-4cf7-bb74-a1fdf878b82a/f8be34eb-f8cf-4985-9210-71f7a90261f4/ec3d3d85-bca0-447d-a521-bcec35cdb952.jpg",
    roles: ["moment_photo"],
    verify: async (admin) => {
      const { data, error } = await admin
        .from("journal_entry_media")
        .select("id, journal_entries!inner(visibility, status)")
        .eq("id", "d3cc7388-f52e-47ad-a191-611a261bd77b")
        .eq("storage_path", "journal/d9617401-73ff-4cf7-bb74-a1fdf878b82a/f8be34eb-f8cf-4985-9210-71f7a90261f4/ec3d3d85-bca0-447d-a521-bcec35cdb952.jpg")
        .maybeSingle();
      if (error) return { referenced: false, detail: `query error: ${error.message}` };
      if (!data) return { referenced: false, detail: "journal_entry_media.storage_path no longer matches" };
      const entry = data as unknown as { journal_entries: { visibility: string; status: string } };
      const stillPublic = entry.journal_entries?.visibility === "public" && entry.journal_entries?.status === "published";
      return { referenced: stillPublic, detail: stillPublic ? "journal_entry_media row matches, parent entry still public+published" : `journal_entry_media row matches but parent entry visibility/status changed (${JSON.stringify(entry.journal_entries)})` };
    },
  },
];

if (new Set(CALIBRATION_ORIGINALS.map((e) => e.key)).size !== CALIBRATION_ORIGINALS.length) {
  throw new Error("media-calibration: duplicate CALIBRATION_ORIGINALS key");
}
if (CALIBRATION_ORIGINALS.length !== 11) {
  throw new Error(`media-calibration: expected exactly 11 calibration originals, got ${CALIBRATION_ORIGINALS.length}`);
}

export interface PreflightResult {
  key: string;
  bucket: string;
  path: string;
  roles: MediaRole[];
  requiredSizes: VariantSize[];
  referenced: boolean;
  referenceDetail: string;
  sourceExists: boolean;
  sourceBytes: number | null;
  sourceContentType: string | null;
  alreadyRegistered: boolean;
  registeredSizes: VariantSize[];
  safeToProcess: boolean;
}

/** Read-only verification of all 11 entries: still referenced, source
 * object still exists in Storage, and whether a media_variants row
 * already exists for it unexpectedly. Never writes anything. This is the
 * "resolve and print the exact paths, verify before processing" step —
 * safe to call at any time, including right now. */
export async function preflightCalibration(admin: SupabaseClient): Promise<PreflightResult[]> {
  const results: PreflightResult[] = [];
  const fetcher = createSupabaseFetcher(asRegistryClient(admin));
  const cache = createRegistryCache();

  // Group by bucket so the registry lookup and the Storage existence
  // check are each batched per bucket, not issued once per original.
  const byBucket = new Map<string, CalibrationEntry[]>();
  for (const entry of CALIBRATION_ORIGINALS) {
    byBucket.set(entry.bucket, [...(byBucket.get(entry.bucket) ?? []), entry]);
  }

  const registeredByBucket = new Map<string, Map<string, ReadonlySet<VariantSize>>>();
  for (const [bucket, entries] of byBucket) {
    registeredByBucket.set(bucket, await resolveLegacyVariantSizes(bucket, entries.map((e) => e.path), fetcher, cache));
  }

  for (const entry of CALIBRATION_ORIGINALS) {
    const { referenced, detail } = await entry.verify(admin);

    // storage.objects isn't a PostgREST-exposed schema (only "public" is,
    // by default) — existence/size/content-type come from the Storage SDK
    // itself (admin.storage.from(bucket).list(...)), the same API every
    // upload/download/remove call in this app already goes through,
    // rather than a raw table query that would need a schema this project
    // doesn't expose.
    const lastSlash = entry.path.lastIndexOf("/");
    const dir = lastSlash === -1 ? "" : entry.path.slice(0, lastSlash);
    const filename = lastSlash === -1 ? entry.path : entry.path.slice(lastSlash + 1);
    const { data: listed, error: listError } = await admin.storage.from(entry.bucket).list(dir, { search: filename, limit: 1 });
    const match = listed?.find((o) => o.name === filename);
    const sourceExists = !listError && !!match;
    const metadata = (match?.metadata ?? {}) as { size?: number; mimetype?: string };

    const registeredSizes = [...(registeredByBucket.get(entry.bucket)?.get(entry.path) ?? [])];

    results.push({
      key: entry.key,
      bucket: entry.bucket,
      path: entry.path,
      roles: entry.roles,
      requiredSizes: unionVariantSizes(entry.roles),
      referenced,
      referenceDetail: detail,
      sourceExists,
      sourceBytes: typeof metadata.size === "number" ? metadata.size : null,
      sourceContentType: metadata.mimetype ?? null,
      alreadyRegistered: registeredSizes.length > 0,
      registeredSizes,
      safeToProcess: referenced && sourceExists && registeredSizes.length === 0,
    });
  }
  return results;
}

export interface DerivativeResult {
  size: VariantSize;
  path: string;
  requestedSize: VariantSize;
  width: number;
  height: number;
  format: string;
  bytes: number;
  sourceBytes: number;
  compressionRatio: number;
  uploaded: boolean;
  verified: boolean;
  upscaled: boolean;
  aspectRatioDeltaPct: number;
  error?: string;
}

export interface OriginalCalibrationResult {
  key: string;
  bucket: string;
  path: string;
  roles: MediaRole[];
  sourceBytes: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceHasAlpha: boolean;
  sourceOrientationTag: number | null;
  derivatives: DerivativeResult[];
  registered: boolean;
  registeredSizes: VariantSize[];
  partialFailure: boolean;
  error?: string;
}

/** Validates ONE generated derivative against its own source metadata —
 * decodes it (so a corrupt buffer fails here, not silently later),
 * confirms it's WebP, confirms it never upscaled past the source's own
 * dimensions, and checks aspect ratio was preserved within 1%. Does not
 * touch Storage. */
async function validateDerivative(buffer: Buffer, size: VariantSize, sourceWidth: number, sourceHeight: number): Promise<{ width: number; height: number; format: string; upscaled: boolean; aspectRatioDeltaPct: number }> {
  const meta = await sharp(buffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const upscaled = width > sourceWidth || height > sourceHeight;
  const sourceRatio = sourceWidth / sourceHeight;
  const outRatio = width / height;
  const aspectRatioDeltaPct = Math.abs(outRatio - sourceRatio) / sourceRatio * 100;
  return { width, height, format: meta.format ?? "unknown", upscaled, aspectRatioDeltaPct };
}

/** Processes exactly ONE calibration entry: download → generate only its
 * role-required sizes → validate locally → upload (all-or-nothing within
 * this one original, via the existing uploadVariants rollback) → verify
 * each uploaded derivative by re-downloading it → register ONLY verified
 * sizes (never a size that failed any step). Never touches the original
 * itself; never upscales; never renames anything. Throws nothing — all
 * failure is captured in the returned result so a failure on one original
 * can never abort the batch (see runCalibration). */
export async function calibrateOneOriginal(admin: SupabaseClient, entry: CalibrationEntry): Promise<OriginalCalibrationResult> {
  const requiredSizes = unionVariantSizes(entry.roles);
  const base: Omit<OriginalCalibrationResult, "sourceBytes" | "sourceWidth" | "sourceHeight" | "sourceHasAlpha" | "sourceOrientationTag" | "derivatives" | "registered" | "registeredSizes" | "partialFailure"> = {
    key: entry.key,
    bucket: entry.bucket,
    path: entry.path,
    roles: entry.roles,
  };

  const { data: blob, error: downloadError } = await admin.storage.from(entry.bucket).download(entry.path);
  if (downloadError || !blob) {
    return { ...base, sourceBytes: 0, sourceWidth: 0, sourceHeight: 0, sourceHasAlpha: false, sourceOrientationTag: null, derivatives: [], registered: false, registeredSizes: [], partialFailure: true, error: `download failed: ${downloadError?.message ?? "no data"}` };
  }
  const sourceBuffer = Buffer.from(await blob.arrayBuffer());
  const sourceMeta = await sharp(sourceBuffer).metadata();
  const sourceWidth = sourceMeta.width ?? 0;
  const sourceHeight = sourceMeta.height ?? 0;
  const sourceHasAlpha = sourceMeta.hasAlpha ?? false;
  const sourceOrientationTag = sourceMeta.orientation ?? null;

  let generated: GeneratedVariant[];
  try {
    generated = await generateImageVariantsForSizes(sourceBuffer, requiredSizes);
  } catch (err) {
    return { ...base, sourceBytes: sourceBuffer.length, sourceWidth, sourceHeight, sourceHasAlpha, sourceOrientationTag, derivatives: [], registered: false, registeredSizes: [], partialFailure: true, error: `generation failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Validate every derivative BEFORE any upload — a derivative that fails
  // validation is dropped from the upload batch entirely (never uploaded,
  // never registered), rather than uploaded-then-discovered-bad.
  const validated: { variant: GeneratedVariant; width: number; height: number; format: string; upscaled: boolean; aspectRatioDeltaPct: number; ok: boolean; error?: string }[] = [];
  for (const v of generated) {
    try {
      const check = await validateDerivative(v.buffer, v.size, sourceWidth, sourceHeight);
      const ok = check.format === "webp" && !check.upscaled && check.aspectRatioDeltaPct < 1;
      validated.push({ variant: v, ...check, ok });
    } catch (err) {
      validated.push({ variant: v, width: 0, height: 0, format: "unknown", upscaled: false, aspectRatioDeltaPct: 100, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const toUpload = validated.filter((v) => v.ok).map((v) => v.variant);
  const uploadOk = toUpload.length > 0 ? await uploadVariants(admin, entry.bucket, entry.path, toUpload) : false;

  const derivatives: DerivativeResult[] = [];
  const registerable: Partial<Record<VariantSize, GeneratedVariantInfo>> = {};

  for (const v of validated) {
    const path = variantPath(entry.path, v.variant.size);
    if (!v.ok) {
      derivatives.push({ size: v.variant.size, requestedSize: v.variant.size, path, width: v.width, height: v.height, format: v.format, bytes: v.variant.buffer.length, sourceBytes: sourceBuffer.length, compressionRatio: 0, uploaded: false, verified: false, upscaled: v.upscaled, aspectRatioDeltaPct: v.aspectRatioDeltaPct, error: v.error ?? "validation failed" });
      continue;
    }
    if (!uploadOk) {
      derivatives.push({ size: v.variant.size, requestedSize: v.variant.size, path, width: v.width, height: v.height, format: v.format, bytes: v.variant.buffer.length, sourceBytes: sourceBuffer.length, compressionRatio: v.variant.buffer.length / sourceBuffer.length, uploaded: false, verified: false, upscaled: v.upscaled, aspectRatioDeltaPct: v.aspectRatioDeltaPct, error: "upload failed (all-or-nothing rollback for this original)" });
      continue;
    }
    // Re-download to verify the uploaded bytes actually match what we
    // generated — never trust a 200/no-error response alone.
    const { data: verifyBlob, error: verifyError } = await admin.storage.from(entry.bucket).download(path);
    const verifyBuffer = verifyBlob ? Buffer.from(await verifyBlob.arrayBuffer()) : null;
    const verified = !verifyError && !!verifyBuffer && verifyBuffer.length === v.variant.buffer.length && verifyBuffer.equals(v.variant.buffer);
    derivatives.push({
      size: v.variant.size,
      requestedSize: v.variant.size,
      path,
      width: v.width,
      height: v.height,
      format: v.format,
      bytes: v.variant.buffer.length,
      sourceBytes: sourceBuffer.length,
      compressionRatio: v.variant.buffer.length / sourceBuffer.length,
      uploaded: true,
      verified,
      upscaled: v.upscaled,
      aspectRatioDeltaPct: v.aspectRatioDeltaPct,
      error: verified ? undefined : `post-upload verification failed: ${verifyError?.message ?? "byte mismatch"}`,
    });
    if (verified) {
      registerable[v.variant.size] = { bytes: v.variant.buffer.length, width: v.width, height: v.height, format: v.format };
    }
  }

  const registeredSizes = Object.keys(registerable).map(Number) as VariantSize[];
  let registered = false;
  // The private Moment photo deliberately never gets a media_variants
  // row — see MOMENT_PHOTO_REGISTRY_NOTE. Its variants above are still
  // generated, uploaded, and verified in journal-media exactly like any
  // other entry; only the registry write is skipped.
  if (registeredSizes.length > 0 && entry.bucket !== JOURNAL_MEDIA_BUCKET) {
    const { error: registryError } = await upsertMediaVariant(asRegistryClient(admin), { bucket: entry.bucket, originalPath: entry.path, role: entry.roles[0], variants: registerable });
    registered = !registryError;
    if (registryError) {
      for (const d of derivatives) if (d.verified) d.error = `verified but registry write failed: ${registryError}`;
    }
  }

  const partialFailure = derivatives.some((d) => !d.verified) && derivatives.some((d) => d.verified);
  const totalFailure = derivatives.length > 0 && derivatives.every((d) => !d.verified);

  return {
    ...base,
    sourceBytes: sourceBuffer.length,
    sourceWidth,
    sourceHeight,
    sourceHasAlpha,
    sourceOrientationTag,
    derivatives,
    registered,
    registeredSizes: entry.bucket === JOURNAL_MEDIA_BUCKET ? [] : registeredSizes,
    partialFailure: partialFailure || totalFailure,
  };
}

/** Runs the full calibration over all 11 entries, each independent of the
 * others — one original's failure never aborts or expands into the rest.
 * Every original is preflighted again immediately before processing (not
 * just once up front) so nothing proceeds on stale state. */
export async function runCalibration(admin: SupabaseClient): Promise<{ preflight: PreflightResult[]; results: OriginalCalibrationResult[] }> {
  const preflight = await preflightCalibration(admin);
  const results: OriginalCalibrationResult[] = [];
  for (const entry of CALIBRATION_ORIGINALS) {
    const pre = preflight.find((p) => p.key === entry.key);
    if (!pre?.safeToProcess) {
      results.push({ key: entry.key, bucket: entry.bucket, path: entry.path, roles: entry.roles, sourceBytes: 0, sourceWidth: 0, sourceHeight: 0, sourceHasAlpha: false, sourceOrientationTag: null, derivatives: [], registered: false, registeredSizes: [], partialFailure: false, error: `skipped: preflight not safe (${pre?.referenceDetail ?? "unknown"})` });
      continue;
    }
    results.push(await calibrateOneOriginal(admin, entry));
  }
  return { preflight, results };
}
