import { headers } from "next/headers";

/**
 * Best-effort, same-instance failed-login throttle for /admin/login.
 *
 * WHAT THIS IS NOT: Vercel serverless/edge functions are ephemeral and can
 * run as multiple concurrent instances across regions, so this
 * module-level Map is NOT a durable, globally-consistent rate limiter — an
 * attacker whose requests land on different cold-started instances (or a
 * distributed attacker) can partially bypass the counter below. A real
 * distributed limiter would need a persistent store (Vercel KV/Upstash
 * Redis, or a new Postgres table) — deliberately out of scope for this
 * pass (no new dependencies, no schema changes). See the pass's report for
 * the recommended durable follow-up.
 *
 * WHAT THIS DOES reliably provide, with zero new infrastructure:
 *   1. A deliberate, increasing delay applied to every failed attempt
 *      before responding — this happens synchronously within the single
 *      request handling that attempt, so it slows brute-forcing no matter
 *      which instance serves the request.
 *   2. A same-instance failure counter with a temporary block once a
 *      rolling-window threshold is crossed — real protection in the
 *      common case (a low-traffic admin-only route tends to stay on one
 *      warm instance for a while), never represented as a hard guarantee.
 *
 * Never stores the submitted password or any credential material — only
 * an IP string and failure timestamps.
 */

const WINDOW_MS = 15 * 60 * 1000; // rolling window for counting failures
const MAX_ATTEMPTS = 5; // failures allowed inside the window before a block
const BLOCK_MS = 15 * 60 * 1000; // temporary block duration once tripped
const BASE_DELAY_MS = 400;
const MAX_DELAY_MS = 8000; // also the flat delay applied while blocked

interface Entry {
  failures: number[]; // failure timestamps within the current window
  blockedUntil: number | null;
}

const attempts = new Map<string, Entry>();

// Crude cap on the map's size so a long-lived warm instance being hit from
// many different IPs can't grow this unbounded.
const MAX_TRACKED_KEYS = 5000;

async function clientKey(): Promise<string> {
  const h = await headers();
  // Vercel's edge network sets x-forwarded-for on every request it
  // proxies; the first entry is the real client IP.
  const forwarded = h.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const real = h.get("x-real-ip");
  if (real) return real;
  // No IP available (unexpected outside Vercel) — degrade to one shared
  // bucket rather than disabling limiting entirely.
  return "unknown";
}

function pruneOld(entry: Entry, now: number): void {
  entry.failures = entry.failures.filter((t) => now - t < WINDOW_MS);
}

function evictOldestIfFull(): void {
  if (attempts.size <= MAX_TRACKED_KEYS) return;
  const oldestKey = attempts.keys().next().value;
  if (oldestKey !== undefined) attempts.delete(oldestKey);
}

export interface LoginAttemptState {
  blocked: boolean;
  /** Delay (ms) to apply before responding — increases smoothly with
   * recent failures rather than jumping only once blocked, so the
   * response timing doesn't itself reveal the exact moment a block
   * started. */
  delayMs: number;
}

/** Call once per login submission, before checking the password. */
export async function checkLoginAttempt(): Promise<LoginAttemptState> {
  const key = await clientKey();
  const now = Date.now();
  const entry = attempts.get(key) ?? { failures: [], blockedUntil: null };
  pruneOld(entry, now);

  if (entry.blockedUntil !== null) {
    if (now < entry.blockedUntil) {
      attempts.set(key, entry);
      return { blocked: true, delayMs: MAX_DELAY_MS };
    }
    // Block has expired — start clean.
    entry.blockedUntil = null;
    entry.failures = [];
  }

  const delayMs = Math.min(BASE_DELAY_MS * 2 ** entry.failures.length, MAX_DELAY_MS);
  attempts.set(key, entry);
  return { blocked: false, delayMs };
}

/** Records one failed attempt, tripping a temporary block once the
 * rolling window's threshold is reached. Only call this when the client
 * wasn't already blocked (checkLoginAttempt().blocked === false) — no
 * need to keep extending a block that's already active. */
export async function recordFailedAttempt(): Promise<void> {
  const key = await clientKey();
  const now = Date.now();
  const entry = attempts.get(key) ?? { failures: [], blockedUntil: null };
  pruneOld(entry, now);
  entry.failures.push(now);
  if (entry.failures.length >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_MS;
  }
  attempts.set(key, entry);
  evictOldestIfFull();
}

/** Clears this client's failure history on a successful login. */
export async function clearLoginAttempts(): Promise<void> {
  const key = await clientKey();
  attempts.delete(key);
}
