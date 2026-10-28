// Product Want / Demand — pure rules (client + server + tests). The data
// itself is public.product_wants (supabase/migrations/
// 20261124000000_product_wants.sql): one canonical "this person wants this
// Product" relationship, separate from Save and from Marketplace.

/** Where a Want came from — recorded for demand attribution. */
export const WANT_SOURCES = ["product_page", "product_card", "saved_sheet", "things_i_want"] as const;
export type WantSource = (typeof WANT_SOURCES)[number];

export function sanitizeWantSource(value: unknown): WantSource | null {
  return typeof value === "string" && (WANT_SOURCES as readonly string[]).includes(value) ? (value as WantSource) : null;
}

/** e.g. the cart's "business:<slug>" channel; short, printable, optional. */
export function sanitizeWantChannel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v && v.length <= 120 && /^[\w:./-]+$/.test(v) ? v : null;
}

/** Signed-out interest dedupes on Product + this normalized form. */
export function normalizeWantEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v.length < 3 || v.length > 320) return null;
  // Deliberately simple: one @, something on both sides, a dot in the domain.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isProductId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Aggregate-only demand line for a Business. Never implies purchase. */
export function demandSentence(count: number, marketplaceEligible: boolean): string | null {
  if (count <= 0) return null;
  const people = count === 1 ? "1 person wants this product." : `${count} people want this product.`;
  return marketplaceEligible ? people : `${people} Complete Marketplace setup to let customers purchase it through Findmi.`;
}

// ── signed-out submission throttle ───────────────────────────────────────
// Best-effort, per-instance (same honest limitation as
// lib/brand-lookup-rate-limit.ts): stops one client hammering a warm
// instance; not a global guarantee. Nothing persisted.
export const WANT_EMAIL_WINDOW_MS = 10 * 60 * 1000;
export const WANT_EMAIL_MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();

export function recordWantEmailAttempt(key: string, now: number = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WANT_EMAIL_WINDOW_MS);
  if (recent.length >= WANT_EMAIL_MAX_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.delete(key);
  hits.set(key, recent);
  if (hits.size > 5000) {
    const oldest = hits.keys().next().value;
    if (oldest !== undefined) hits.delete(oldest);
  }
  return false;
}

export function resetWantEmailRateLimit(): void {
  hits.clear();
}
