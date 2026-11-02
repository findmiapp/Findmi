/** Media URL validation shared by the gallery write paths and the public
 * readers (2026-11-02 incident hardening). A gallery row is only ever a URL
 * string; one malformed value must neither be persisted nor reach a public
 * renderer, where next/image throws on an unparseable `src`. */

import { isRenderableImageUrl } from "./location-eligibility";

const PUBLIC_STORAGE_SEGMENT = "/storage/v1/object/public/";

/** The READ-side check is the existing one (lib/location-eligibility): the
 * same host list as next.config.js `images.remotePatterns` and the CSP. */
export { isRenderableImageUrl };

/** Uploaded by Findmi: a public object in this project's Supabase Storage.
 * The strict WRITE-side check — what our upload actions return is the only
 * thing a gallery save may store. `supabaseUrl` defaults to the configured
 * project URL; pass one explicitly in tests. */
export function isFindmiStorageImageUrl(value: unknown, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): value is string {
  if (typeof value !== "string" || value !== value.trim() || !/^https?:\/\//i.test(value) || /\s/.test(value)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!parsed.pathname.startsWith(PUBLIC_STORAGE_SEGMENT)) return false;
  if (!supabaseUrl) return parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co");
  try {
    return parsed.origin === new URL(supabaseUrl).origin;
  } catch {
    return false;
  }
}

/** Cleans a submitted gallery list: valid Findmi Storage URLs only, first
 * occurrence kept, order preserved. */
export function cleanGalleryUrls(values: readonly unknown[], supabaseUrl?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const url = typeof v === "string" ? v.trim() : v;
    if (!isFindmiStorageImageUrl(url, supabaseUrl) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** Read-side filter for a list of stored gallery URLs. */
export function renderableImageUrls(values: readonly unknown[]): string[] {
  return values.flatMap((v) => (typeof v === "string" && isRenderableImageUrl(v) ? [v.trim()] : []));
}
