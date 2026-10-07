import "server-only";

// Legacy-variant registry — the durable record of which PRE-EXISTING
// (unmarked) findmi-media originals have had WebP derivatives generated
// for them by a backfill. New uploads never need this: a successful
// upload gets the `.fv1.` filename marker (see image-variants.ts) and
// resolves its variants with zero DB lookup, forever. Only unmarked
// legacy originals — which can't encode "variants exist" in their own
// name, since they were never renamed and never will be (existing public
// URLs must never change) — need this table to escape the "always falls
// back to the original" behavior that's correct-but-suboptimal today.
//
// Schema (applied via a migration, NOT by this module):
//   media_variants (
//     bucket         text not null,
//     original_path  text not null,
//     variants       jsonb not null,   -- {"160": {...}, "800": {...}, ...}
//     role           text,             -- observability only, never read here
//     generated_at   timestamptz not null default now(),
//     primary key (bucket, original_path)
//   )
// One row per ORIGINAL, not per variant: the variant's own Storage path is
// always `variantPath(original_path, size)` (image-variants.ts) — a pure
// function of two columns this table already has — so a per-variant row
// would just be a second, driftable copy of information already derivable
// for free. `variants` holds only genuinely per-size facts (bytes/width/
// height/format) that aren't derivable. Service-role only: RLS enabled,
// zero anon/authenticated policies (no client ever writes or reads this
// table directly — only through the batched server-side lookup below).
//
// Batching: a page that renders N legacy images calls
// resolveLegacyVariantSizes() ONCE with all N paths, which issues at most
// one `.in("original_path", paths)` query for whatever isn't already
// cached — never one query per image (no N+1), mirroring
// signed-image-urls.ts's signImageUrls() for the private-media side.
//
// Caching: unlike signed URLs, a registry row has no expiring token — it's
// written once by a backfill/upload-replace flow and read many times — so
// entries are reused far longer. A short reuse window still bounds
// staleness after an upsert/delete without requiring every write path to
// also bust a cache it may not even share a process with.

import { VARIANT_SIZES, type VariantSize } from "./image-variants";

export const MEDIA_VARIANTS_TABLE = "media_variants";

const REGISTRY_REUSE_MS = 10 * 60 * 1000;

/** Row shape as read back from the registry table — only the columns this
 * module actually consumes. */
export interface MediaVariantRow {
  original_path: string;
  variants: Record<string, unknown>;
}

/** Dependency-injected lookup, so resolveLegacyVariantSizes can be tested
 * without a real Supabase client (same pattern as Signer in
 * signed-image-urls.ts). `createSupabaseFetcher` below is the real one. */
export type Fetcher = (bucket: string, paths: string[]) => Promise<MediaVariantRow[] | null>;

export interface RegistryCache {
  get(key: string): { sizes: ReadonlySet<VariantSize> | null } | undefined;
  set(key: string, sizes: ReadonlySet<VariantSize> | null): void;
}

export function createRegistryCache({ now = Date.now, max = 5000 }: { now?: () => number; max?: number } = {}): RegistryCache {
  const map = new Map<string, { sizes: ReadonlySet<VariantSize> | null; at: number }>();
  return {
    get(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (now() - e.at >= REGISTRY_REUSE_MS) {
        map.delete(key);
        return undefined;
      }
      return { sizes: e.sizes };
    },
    set(key, sizes) {
      map.delete(key);
      map.set(key, { sizes, at: now() });
      while (map.size > max) map.delete(map.keys().next().value as string);
    },
  };
}

function cacheKey(bucket: string, path: string): string {
  return `${bucket}\u0000${path}`;
}

function sizesFromRow(row: MediaVariantRow): ReadonlySet<VariantSize> {
  const keys = Object.keys(row.variants ?? {}).map(Number);
  return new Set(VARIANT_SIZES.filter((size) => keys.includes(size)));
}

/** Registered variant sizes for each of `paths`, in at most ONE query for
 * whatever isn't already cached. A path with no registry row (the normal
 * case for most legacy originals — no backfill has reached them yet) is
 * simply absent from the result, which callers must treat exactly like
 * "no variants" — the pre-existing, safe fallback to the original. */
export async function resolveLegacyVariantSizes(
  bucket: string,
  paths: string[],
  fetch: Fetcher,
  cache: RegistryCache,
): Promise<Map<string, ReadonlySet<VariantSize>>> {
  const unique = [...new Set(paths)];
  const missing = unique.filter((p) => cache.get(cacheKey(bucket, p)) === undefined);
  if (missing.length > 0) {
    const rows = await fetch(bucket, missing).catch(() => null);
    if (rows) {
      const answered = new Set<string>();
      for (const row of rows) {
        answered.add(row.original_path);
        cache.set(cacheKey(bucket, row.original_path), sizesFromRow(row));
      }
      // A path the table has no row for at all is "no variants" — cache
      // that too, so it doesn't get re-queried on every render.
      for (const p of missing) if (!answered.has(p)) cache.set(cacheKey(bucket, p), null);
    }
  }
  const out = new Map<string, ReadonlySet<VariantSize>>();
  for (const p of unique) {
    const sizes = cache.get(cacheKey(bucket, p))?.sizes;
    if (sizes) out.set(p, sizes);
  }
  return out;
}

/** Minimal client surface this module needs — satisfied by a real
 * SupabaseClient, and trivially stubbable in tests without importing
 * @supabase/supabase-js. */
export interface MediaVariantsClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        in(column: string, values: string[]): Promise<{ data: MediaVariantRow[] | null; error: { message: string } | null }>;
      };
    };
    upsert(
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ): Promise<{ error: { message: string } | null }>;
    delete(): {
      eq(column: string, value: string): {
        eq(column: string, value: string): Promise<{ error: { message: string } | null }>;
      };
    };
  };
}

/** The real, Storage-backed Fetcher — one `.in("original_path", paths)`
 * query per call, scoped to `bucket`. */
export function createSupabaseFetcher(admin: MediaVariantsClient): Fetcher {
  return async (bucket, paths) => {
    if (paths.length === 0) return [];
    const { data, error } = await admin.from(MEDIA_VARIANTS_TABLE).select("original_path, variants").eq("bucket", bucket).in("original_path", paths);
    if (error) throw new Error(error.message);
    return data ?? [];
  };
}

export type GeneratedVariantInfo = { bytes: number; width: number; height: number; format: string };

/** Records that `originalPath` now has real derivatives at the given
 * sizes. Idempotent: re-running a backfill for the same original replaces
 * its row (the `bucket, original_path` primary key — see schema above —
 * makes this a plain upsert, never a duplicate insert). */
export async function upsertMediaVariant(
  admin: MediaVariantsClient,
  params: { bucket: string; originalPath: string; role?: string | null; variants: Partial<Record<VariantSize, GeneratedVariantInfo>> },
): Promise<{ error?: string }> {
  const { error } = await admin.from(MEDIA_VARIANTS_TABLE).upsert(
    {
      bucket: params.bucket,
      original_path: params.originalPath,
      role: params.role ?? null,
      variants: params.variants,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "bucket,original_path" },
  );
  return error ? { error: error.message } : {};
}

/** Cleans up a registry row — e.g. when an original is deleted or
 * replaced by a newer upload. Standalone capability (no existing upload
 * action currently deletes a replaced original's own file either — see
 * the backfill audit — so this is intentionally not wired into any
 * upload action in this pass). A path with no row is a harmless no-op. */
export async function deleteMediaVariant(admin: MediaVariantsClient, bucket: string, originalPath: string): Promise<{ error?: string }> {
  const { error } = await admin.from(MEDIA_VARIANTS_TABLE).delete().eq("bucket", bucket).eq("original_path", originalPath);
  return error ? { error: error.message } : {};
}
