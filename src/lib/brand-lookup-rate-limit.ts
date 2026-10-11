import "server-only";
import { headers } from "next/headers";

/** Find Your Brand (/join/brand) lookup throttle — best-effort and
 * NON-DISTRIBUTED, the same honest limitation as lib/admin/loginRateLimit.ts
 * and lib/analytics/rateLimit.ts: a module-level Map lives in one serverless
 * instance only, so requests landing on other instances are counted
 * separately. It reliably stops a single client from hammering one warm
 * instance; it is not a global guarantee. Nothing is persisted — only an
 * in-memory IP → timestamps map that is pruned and capped. */

export const BRAND_LOOKUP_WINDOW_MS = 10 * 60 * 1000;
export const BRAND_LOOKUP_MAX_PER_WINDOW = 30;
const MAX_TRACKED_KEYS = 5000;

const hits = new Map<string, number[]>();

/** Pure core (exported for tests): records one attempt for `key` at `now`
 * and reports whether it is over the limit. A limited attempt is not
 * recorded, so the window recovers on schedule. */
export function recordBrandLookupAttempt(key: string, now: number = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < BRAND_LOOKUP_WINDOW_MS);
  if (recent.length >= BRAND_LOOKUP_MAX_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.delete(key); // re-insert so Map order tracks recency for eviction
  hits.set(key, recent);
  if (hits.size > MAX_TRACKED_KEYS) {
    const oldest = hits.keys().next().value;
    if (oldest !== undefined) hits.delete(oldest);
  }
  return false;
}

/** Test helper — clears the in-memory window. */
export function resetBrandLookupRateLimit(): void {
  hits.clear();
}

/** Same client-key resolution as loginRateLimit.ts: first x-forwarded-for
 * entry (set by Vercel's edge), then x-real-ip, else one shared bucket. */
async function clientKey(): Promise<string> {
  const h = await headers();
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (first) return first;
  return h.get("x-real-ip") ?? "unknown";
}

export async function isBrandLookupRateLimited(): Promise<boolean> {
  return recordBrandLookupAttempt(await clientKey());
}
