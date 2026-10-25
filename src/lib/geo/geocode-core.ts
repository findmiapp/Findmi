// Canonical Location geography — the pure rules (Discovery Engine V1).
//
// A Location owns its coordinate. Geocoding is a CONTROLLED batch process
// (Admin → Locations → Map Placement, src/lib/geo/geocode.ts), never a
// request-time side effect: coordinates are durable data. These rules
// decide when an address is good enough to send, and when a provider's
// answer is good enough to store — an imprecise or ambiguous answer is
// never stored as if it were a real pin.
//
// Mirrors public.location_geocode_address() and the CHECKs in
// supabase/migrations/20261114000000_discovery_engine_map_v1.sql.

import { isValidCoordinate } from "../discovery/map-core";

export const GEOCODE_STATUSES = ["pending", "resolved", "manual", "incomplete", "ambiguous", "failed"] as const;
export type GeocodeStatus = (typeof GEOCODE_STATUSES)[number];
export const GEOCODE_SOURCES = ["geocodio", "census", "manual", "import"] as const;
export type GeocodeSource = (typeof GEOCODE_SOURCES)[number];

/** Attempts before a failing Location stops being retried automatically
 * (Admin can still retry it by hand). */
export const MAX_GEOCODE_ATTEMPTS = 5;
export const MAX_GEOCODE_BATCH = 25;

/** Wait after the 1st, 2nd, 3rd and 4th failed attempt before the next
 * automatic one (a transient provider problem). Then it stops at
 * MAX_GEOCODE_ATTEMPTS and waits for Admin. */
export const RETRY_BACKOFF_MINUTES = [15, 60, 6 * 60, 24 * 60] as const;
/** A claimed `pending` attempt whose worker never finished (a serverless
 * function cut off mid-request) becomes claimable again after this. */
export const CLAIM_LEASE_MINUTES = 10;

/** Is a queued Location due for an automatic attempt now? Only `pending`
 * and `failed` are ever queued — ambiguous / incomplete never retry on
 * their own. */
export function isDue(
  r: { geocode_status: string; geocode_attempts: number; geocode_attempted_at: string | null },
  now: Date,
  ignoreBackoff = false
): boolean {
  if (r.geocode_status !== "pending" && r.geocode_status !== "failed") return false;
  if (r.geocode_attempts >= MAX_GEOCODE_ATTEMPTS) return false;
  if (!r.geocode_attempted_at) return true;
  const since = (now.getTime() - Date.parse(r.geocode_attempted_at)) / 60_000;
  // A claimed pending row may still be in flight — never bypassed.
  if (r.geocode_status === "pending") return since >= CLAIM_LEASE_MINUTES;
  if (ignoreBackoff) return true;
  return since >= RETRY_BACKOFF_MINUTES[Math.min(Math.max(r.geocode_attempts, 1), RETRY_BACKOFF_MINUTES.length) - 1];
}

export interface AddressFields {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

const clean = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ");

/** Same normalization as the SQL function (lower-cased, comma-joined,
 * whitespace collapsed) — what a stored coordinate was derived from. */
export function normalizedAddressKey(a: AddressFields): string | null {
  const parts = [a.address, a.city, a.state, a.postal_code].map(clean).filter(Boolean);
  const s = parts.join(", ").toLowerCase().replace(/\s+/g, " ");
  return s || null;
}

/** An address is geocodable only with a street/place line AND either
 * city + state or a ZIP. A city alone would land on the city's centroid —
 * a fake pin — so it is "incomplete", not sent. */
export function geocodeQueryFor(a: AddressFields): { ok: true; text: string } | { ok: false; reason: string } {
  const address = clean(a.address);
  const city = clean(a.city);
  const state = clean(a.state);
  const zip = clean(a.postal_code).slice(0, 10);
  if (!address) return { ok: false, reason: "No street address" };
  if (!(city && state) && !/^\d{5}/.test(zip)) return { ok: false, reason: "Needs city and state, or a ZIP code" };
  if (/^(tbd|tba|n\/?a|none|online|virtual|various)$/i.test(address)) return { ok: false, reason: "Address isn't a real place" };
  return { ok: true, text: [address, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") };
}

/** One provider answer, normalized. accuracy 0–1; precision says what the
 * point represents. */
export interface GeocodeCandidate {
  lat: number;
  lng: number;
  accuracy: number;
  precision: "rooftop" | "parcel" | "interpolated" | "street" | "intersection" | "place" | "postal" | "region";
  state?: string | null;
  timezone?: string | null;
  label?: string | null;
}

const PRECISE = new Set<GeocodeCandidate["precision"]>(["rooftop", "parcel", "interpolated", "street", "intersection"]);
export const MIN_ACCURACY = 0.8;

const km = (a: GeocodeCandidate, b: GeocodeCandidate) => {
  const R = 6371;
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export type GeocodeDecision =
  | { status: "resolved"; lat: number; lng: number; timezone: string | null }
  | { status: "ambiguous" | "failed"; reason: string };

/** Store only a precise, unambiguous, plausible answer. */
export function decideGeocode(candidates: GeocodeCandidate[], expectedState?: string | null): GeocodeDecision {
  const valid = candidates.filter((c) => isValidCoordinate(c.lat, c.lng));
  if (valid.length === 0) return { status: "failed", reason: "No match found" };
  const good = valid.filter((c) => PRECISE.has(c.precision) && c.accuracy >= MIN_ACCURACY).sort((a, b) => b.accuracy - a.accuracy);
  if (good.length === 0) return { status: "ambiguous", reason: `Only an approximate match (${valid[0].precision})` };
  const top = good[0];
  // Two strong answers far apart = two different places with this address.
  if (good.some((c) => c !== top && c.accuracy >= top.accuracy - 0.05 && km(c, top) > 0.5)) return { status: "ambiguous", reason: "More than one place matches this address" };
  const want = clean(expectedState).toUpperCase();
  const got = clean(top.state).toUpperCase();
  if (want.length === 2 && got.length === 2 && want !== got) return { status: "ambiguous", reason: `Match is in ${got}, not ${want}` };
  return { status: "resolved", lat: Math.round(top.lat * 1e6) / 1e6, lng: Math.round(top.lng * 1e6) / 1e6, timezone: top.timezone ?? null };
}

/** States entirely inside one IANA zone. Split states (e.g. FL, TN, IN,
 * KY, TX) are deliberately absent — their zone comes from the provider or
 * stays unknown (occurrences keep their own stored timezone). */
const SINGLE_ZONE: Record<string, string> = {
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", GA: "America/New_York", ME: "America/New_York", MD: "America/New_York",
  MA: "America/New_York", NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York", NC: "America/New_York", OH: "America/New_York",
  PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", VT: "America/New_York", VA: "America/New_York", WV: "America/New_York",
  AL: "America/Chicago", AR: "America/Chicago", IL: "America/Chicago", IA: "America/Chicago", LA: "America/Chicago", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", OK: "America/Chicago", WI: "America/Chicago",
  CO: "America/Denver", MT: "America/Denver", NM: "America/Denver", UT: "America/Denver", WY: "America/Denver",
  AZ: "America/Phoenix", CA: "America/Los_Angeles", NV: "America/Los_Angeles", WA: "America/Los_Angeles", HI: "Pacific/Honolulu",
};

export function timezoneFor(decided: string | null | undefined, state: string | null | undefined): string | null {
  if (decided && /^[A-Za-z_]+\/[A-Za-z0-9_+/-]+$/.test(decided)) return decided;
  return SINGLE_ZONE[clean(state).toUpperCase()] ?? null;
}
