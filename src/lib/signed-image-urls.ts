// Signed URLs for PRIVATE images (journal-media), with display variants
// and a conservative in-process cache. Pure + dependency-injected (the
// signer and clock are parameters) so tests/image-variants.test.mjs can
// exercise it without Storage.
//
// Variants: for each original path, the wanted variant path is signed in
// the SAME batch as the original. Storage answers per path, so a missing
// variant (every pre-existing photo, or one still being generated) simply
// falls back to the original URL — no extra request, no 404 in the page.
// Variants are signed like originals: private, time-limited.
//
// Caching: Supabase mints a new token (so a new URL) on every sign, which
// defeated browser caching across renders. A signed URL is reused for at
// most 45 minutes of its 60-minute life, so anything served has ≥15
// minutes left. The cache is keyed by storage path and only consulted for
// paths the caller already obtained through its own RLS-gated row read —
// it never grants access the caller couldn't otherwise get (equivalent to
// signing again). Per-item "not found" answers are remembered for only 5
// minutes so a freshly generated variant is picked up quickly. Whole-call
// failures are never cached. Process-local (each server instance has its
// own); nothing is persisted.
import { sizeToVariant, variantPath, type ImageSize } from "./image-variants";

export const SIGNED_URL_TTL_SECONDS = 60 * 60;
export const SIGNED_URL_REUSE_MS = 45 * 60 * 1000;
export const MISSING_REUSE_MS = 5 * 60 * 1000;

export type Signer = (paths: string[], ttlSeconds: number) => Promise<{ path: string | null; signedUrl: string | null; error: string | null }[] | null>;

export interface SignedUrlCache {
  get(path: string): { url: string | null } | undefined;
  set(path: string, url: string | null): void;
  readonly size: number;
}

export function createSignedUrlCache({ now = Date.now, max = 5000 }: { now?: () => number; max?: number } = {}): SignedUrlCache {
  const map = new Map<string, { url: string | null; at: number }>();
  return {
    get(path) {
      const e = map.get(path);
      if (!e) return undefined;
      if (now() - e.at >= (e.url ? SIGNED_URL_REUSE_MS : MISSING_REUSE_MS)) {
        map.delete(path);
        return undefined;
      }
      return { url: e.url };
    },
    set(path, url) {
      map.delete(path);
      map.set(path, { url, at: now() });
      while (map.size > max) map.delete(map.keys().next().value as string);
    },
    get size() {
      return map.size;
    },
  };
}

/** Signed display URLs for `paths` at each requested size, in ONE signing
 * call for everything not already cached. Result: size → (original path →
 * URL); a size whose variant is missing maps to the original's URL. */
export async function signImageUrls(
  paths: string[],
  sizes: ImageSize[],
  sign: Signer,
  cache: SignedUrlCache
): Promise<Map<ImageSize, Map<string, string>>> {
  const unique = [...new Set(paths)];
  const wanted = new Set<string>();
  for (const p of unique) {
    wanted.add(p);
    for (const s of sizes) {
      const v = sizeToVariant(s);
      if (v) wanted.add(variantPath(p, v));
    }
  }
  const missing = [...wanted].filter((p) => cache.get(p) === undefined);
  if (missing.length > 0) {
    const rows = await sign(missing, SIGNED_URL_TTL_SECONDS).catch(() => null);
    if (rows) {
      const answered = new Set<string>();
      for (const row of rows) {
        if (!row.path) continue;
        answered.add(row.path);
        cache.set(row.path, row.signedUrl && !row.error ? row.signedUrl : null);
      }
      // A path Storage didn't mention at all is treated as missing too.
      for (const p of missing) if (!answered.has(p)) cache.set(p, null);
    }
  }
  const out = new Map<ImageSize, Map<string, string>>();
  for (const s of sizes) {
    const m = new Map<string, string>();
    const v = sizeToVariant(s);
    for (const p of unique) {
      const url = (v ? cache.get(variantPath(p, v))?.url : null) ?? cache.get(p)?.url;
      if (url) m.set(p, url);
    }
    out.set(s, m);
  }
  return out;
}
