// Findmi Analytics ingestion — lightweight, same-instance abuse guard.
//
// Same honest limitation as lib/admin/loginRateLimit.ts (which this
// mirrors the shape of, simplified — no exponential backoff/temporary
// block needed for this endpoint, just a rolling cap): a module-level Map
// is not a durable, globally-consistent limiter across Vercel's multiple
// serverless instances. It reliably blocks a single runaway
// client/session from flooding one warm instance, which is the real
// Phase 1 need — not "an elaborate anti-bot platform."
//
// Keyed by session_id (never by raw IP — Findmi does not persist or key
// long-lived state on IP addresses per the completed audit's privacy
// recommendation), so this never needs to touch/store an IP at all.
const WINDOW_MS = 60_000;
const MAX_EVENTS_PER_WINDOW = 60; // generous — far above any real visitor's organic click rate
const MAX_TRACKED_KEYS = 20_000; // crude cap so a long warm instance can't grow this unbounded

const hits = new Map<string, number[]>();

export function isRateLimited(sessionId: string): boolean {
  const now = Date.now();
  const existing = hits.get(sessionId) ?? [];
  const recent = existing.filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_EVENTS_PER_WINDOW) {
    hits.set(sessionId, recent);
    return true;
  }

  recent.push(now);
  hits.set(sessionId, recent);

  if (hits.size > MAX_TRACKED_KEYS) {
    const oldestKey = hits.keys().next().value;
    if (oldestKey !== undefined) hits.delete(oldestKey);
  }
  return false;
}
