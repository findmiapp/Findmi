import "server-only";
import { headers } from "next/headers";

/** Guest-First Experience Completion pass — abuse control for anonymous
 * factual Location submission ("I'm Just Adding It To Findmi" with no
 * account). Same honest, best-effort, non-distributed shape as
 * lib/admin/loginRateLimit.ts and lib/brand-website-rate-limit.ts: a
 * module-level Map lives in ONE serverless instance, so a distributed
 * attacker spread across instances is only partially slowed — real
 * protection in the common case, never represented as a hard guarantee.
 * No new dependencies, no schema, nothing persisted beyond this process's
 * memory.
 *
 *   per IP: 5 anonymous Location submissions / 60 minutes
 */

export const ANONYMOUS_LOCATION_WINDOW_MS = 60 * 60 * 1000;
export const ANONYMOUS_LOCATION_MAX_PER_WINDOW = 5;
const MAX_TRACKED_KEYS = 5000;

const hits = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  return (hits.get(key) ?? []).filter((t) => now - t < ANONYMOUS_LOCATION_WINDOW_MS);
}

/** Pure core (exported for tests): records one anonymous submission
 * attempt for `ipKey` at `now` and reports whether it is already over the
 * limit. An over-limit attempt is recorded nowhere, so the window
 * recovers on schedule rather than being extended by the rejected taps
 * themselves. */
export function recordAnonymousLocationSubmission(ipKey: string, now: number = Date.now()): boolean {
  const times = recent(ipKey, now);
  if (times.length >= ANONYMOUS_LOCATION_MAX_PER_WINDOW) return true;
  times.push(now);
  hits.delete(ipKey); // re-insert so Map order tracks recency for eviction
  hits.set(ipKey, times);
  if (hits.size > MAX_TRACKED_KEYS) {
    const oldest = hits.keys().next().value;
    if (oldest !== undefined) hits.delete(oldest);
  }
  return false;
}

/** Same client-key resolution every other best-effort limiter in this
 * codebase uses: first x-forwarded-for entry (set by Vercel's edge), then
 * x-real-ip, else one shared "unknown" bucket. */
export async function anonymousLocationClientIp(): Promise<string> {
  const h = await headers();
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (first) return first;
  return h.get("x-real-ip") ?? "unknown";
}

/** Test helper — clears the in-memory window. */
export function resetAnonymousLocationRateLimit(): void {
  hits.clear();
}
