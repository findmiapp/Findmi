import "server-only";
import { headers } from "next/headers";

/** Brand Onboarding V1.1B — website-analysis throttle, separate from the
 * /join/brand lookup throttle (a website fetch costs far more than a
 * lookup). Best-effort and NON-DISTRIBUTED, the same honest limitation as
 * lib/brand-lookup-rate-limit.ts: module-level Maps live in ONE serverless
 * instance, so requests on other instances are counted separately. The
 * real abuse control is that analysis requires a signed-in account; this
 * only stops one client hammering one warm instance. Nothing is persisted.
 *
 *   per user:   5 / 10 minutes and 20 / day
 *   per IP:    20 / 10 minutes
 *   per instance: at most 3 website fetches in flight */

export const WEBSITE_ANALYSIS_WINDOW_MS = 10 * 60 * 1000;
export const WEBSITE_ANALYSIS_DAY_MS = 24 * 60 * 60 * 1000;
export const WEBSITE_ANALYSIS_USER_MAX_PER_WINDOW = 5;
export const WEBSITE_ANALYSIS_USER_MAX_PER_DAY = 20;
export const WEBSITE_ANALYSIS_IP_MAX_PER_WINDOW = 20;
export const WEBSITE_FETCH_MAX_CONCURRENT = 3;
const MAX_TRACKED_KEYS = 5000;

interface Bucket {
  hits: Map<string, number[]>;
  windowMs: number;
  max: number;
}

const userWindow: Bucket = { hits: new Map(), windowMs: WEBSITE_ANALYSIS_WINDOW_MS, max: WEBSITE_ANALYSIS_USER_MAX_PER_WINDOW };
const userDay: Bucket = { hits: new Map(), windowMs: WEBSITE_ANALYSIS_DAY_MS, max: WEBSITE_ANALYSIS_USER_MAX_PER_DAY };
const ipWindow: Bucket = { hits: new Map(), windowMs: WEBSITE_ANALYSIS_WINDOW_MS, max: WEBSITE_ANALYSIS_IP_MAX_PER_WINDOW };

function recent(bucket: Bucket, key: string, now: number): number[] {
  return (bucket.hits.get(key) ?? []).filter((t) => now - t < bucket.windowMs);
}

function record(bucket: Bucket, key: string, times: number[], now: number): void {
  times.push(now);
  bucket.hits.delete(key); // re-insert so Map order tracks recency for eviction
  bucket.hits.set(key, times);
  if (bucket.hits.size > MAX_TRACKED_KEYS) {
    const oldest = bucket.hits.keys().next().value;
    if (oldest !== undefined) bucket.hits.delete(oldest);
  }
}

/** Pure core (exported for tests): records one analysis for this user + IP
 * at `now` and reports whether it is over ANY limit. A limited attempt is
 * recorded nowhere, so windows recover on schedule. */
export function recordWebsiteAnalysisAttempt(userKey: string, ipKey: string, now: number = Date.now()): boolean {
  const u = recent(userWindow, userKey, now);
  const d = recent(userDay, userKey, now);
  const i = recent(ipWindow, ipKey, now);
  if (u.length >= userWindow.max || d.length >= userDay.max || i.length >= ipWindow.max) return true;
  record(userWindow, userKey, u, now);
  record(userDay, userKey, d, now);
  record(ipWindow, ipKey, i, now);
  return false;
}

let inFlight = 0;

/** Claims one of the per-instance fetch slots; returns its release
 * function, or null when all slots are busy. Release is idempotent. */
export function tryAcquireWebsiteFetchSlot(): (() => void) | null {
  if (inFlight >= WEBSITE_FETCH_MAX_CONCURRENT) return null;
  inFlight += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight -= 1;
  };
}

/** Test helper — clears every in-memory window and slot. */
export function resetWebsiteAnalysisRateLimit(): void {
  userWindow.hits.clear();
  userDay.hits.clear();
  ipWindow.hits.clear();
  inFlight = 0;
}

/** Same client-key resolution as the lookup limiter: first
 * x-forwarded-for entry (set by Vercel's edge), then x-real-ip. */
export async function websiteAnalysisClientIp(): Promise<string> {
  const h = await headers();
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (first) return first;
  return h.get("x-real-ip") ?? "unknown";
}
