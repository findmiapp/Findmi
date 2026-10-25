import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decideGeocode,
  geocodeQueryFor,
  MAX_GEOCODE_ATTEMPTS,
  MAX_GEOCODE_BATCH,
  isDue,
  normalizedAddressKey,
  timezoneFor,
  type GeocodeCandidate,
  type GeocodeSource,
  type GeocodeStatus,
} from "./geocode-core";

// Canonical Location geography — providers + the controlled batch runner.
//
// Provider abstraction (server-only; keys never reach a browser):
//   • geocodio — GEOCODIO_API_KEY. US/Canada, rooftop accuracy, returns the
//     IANA timezone, and its terms allow storing results permanently.
//   • census   — the U.S. Census Bureau geocoder: keyless, public-domain
//     results (storable), US street addresses only, no timezone.
// GEOCODER=geocodio|census picks explicitly; otherwise geocodio when its
// key is set, else census. Only the Location's own public address is sent
// — never anything about a person.
//
// The drain (drainGeocodeQueue) is the ONLY writer of geocoded coordinates:
// bounded batches (≤ 25), sequential with a pause between requests, run
// after a Location write (lib/geo/geocode-auto.ts) or by the cron safety net
// (/api/cron/geocode) — never during a public page request, never from a
// migration.

export interface Provider {
  source: Exclude<GeocodeSource, "manual" | "import">;
  geocode(text: string): Promise<GeocodeCandidate[]>;
}

const TIMEOUT_MS = 8000;

class ProviderError extends Error {}

const geocodio = (key: string): Provider => ({
  source: "geocodio",
  async geocode(text) {
    const url = `https://api.geocod.io/v1.7/geocode?q=${encodeURIComponent(text)}&fields=timezone&limit=3&country=US&api_key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (res.status === 422) return [];
    if (!res.ok) throw new ProviderError(`Geocodio ${res.status}`);
    const body = (await res.json()) as { results?: { location: { lat: number; lng: number }; accuracy: number; accuracy_type: string; address_components?: { state?: string }; formatted_address?: string; fields?: { timezone?: { name?: string } } }[] };
    const precision = (t: string): GeocodeCandidate["precision"] =>
      t === "rooftop" || t === "point" ? "rooftop" : t === "nearest_rooftop_match" ? "parcel" : t === "range_interpolation" ? "interpolated" : t === "intersection" ? "intersection" : t === "street_center" ? "street" : t === "place" ? "place" : t === "county" || t === "state" ? "region" : "postal";
    return (body.results ?? []).map((r) => ({
      lat: r.location.lat,
      lng: r.location.lng,
      accuracy: r.accuracy,
      precision: precision(r.accuracy_type),
      state: r.address_components?.state ?? null,
      timezone: r.fields?.timezone?.name ?? null,
      label: r.formatted_address ?? null,
    }));
  },
});

const census: Provider = {
  source: "census",
  async geocode(text) {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(text)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new ProviderError(`Census geocoder ${res.status}`);
    const body = (await res.json()) as { result?: { addressMatches?: { coordinates: { x: number; y: number }; matchedAddress?: string; addressComponents?: { state?: string } }[] } };
    // Census returns only street-level (interpolated) matches; it has no
    // score, so each match counts as a precise interpolation and more than
    // one distinct match is treated as ambiguous by decideGeocode.
    return (body.result?.addressMatches ?? []).map((m) => ({ lat: m.coordinates.y, lng: m.coordinates.x, accuracy: 0.9, precision: "interpolated" as const, state: m.addressComponents?.state ?? null, label: m.matchedAddress ?? null }));
  },
};

export function geocodeProvider(): Provider {
  const key = process.env.GEOCODIO_API_KEY?.trim();
  const choice = process.env.GEOCODER?.trim().toLowerCase();
  if (choice === "census") return census;
  if (key) return geocodio(key);
  return census;
}

export interface BatchSummary {
  provider: string;
  processed: number;
  resolved: number;
  ambiguous: number;
  failed: number;
  incomplete: number;
  /** Claimed by another worker first, or the address changed mid-request. */
  skipped: number;
  remaining: number;
}

type LocRow = { id: string; name: string; address: string | null; city: string | null; state: string | null; postal_code: string | null; geocode_status: GeocodeStatus; geocode_attempts: number; geocode_attempted_at: string | null; timezone: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Provider error text as stored / shown in Admin — never a credential
 * (a request URL inside an error message would carry the key). */
export function safeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Provider error";
  return msg.replace(/(api_key|key|token)=[^&\s"']+/gi, "$1=[redacted]").slice(0, 300) || "Provider error";
}
const COLS = "id, name, address, city, state, postal_code, geocode_status, geocode_attempts, geocode_attempted_at, timezone";

export interface DrainOptions {
  /** At most this many Locations are attempted (≤ MAX_GEOCODE_BATCH). */
  limit?: number;
  /** Only these Locations (still only if they're queued). */
  ids?: string[];
  provider?: Provider;
  pauseMs?: number;
  now?: Date;
  /** Admin recovery: retry failed ones now instead of waiting out backoff. */
  ignoreBackoff?: boolean;
}

/** THE geocoding worker — every trigger (the write-path kick, the cron
 * safety net, Admin recovery) runs this same function.
 *
 * The queue is the Location row itself: `pending` (new, or re-queued by the
 * database trigger after an address change) and `failed` (transient
 * provider trouble, retried with backoff). Ambiguous / incomplete /
 * permanently-unmatched Locations are never retried automatically.
 *
 * Deduplication: before calling the provider a worker CLAIMS the row with
 * one conditional update (attempts n → n+1 only if still n and still
 * queued); a concurrent worker's claim matches nothing, so each attempt
 * makes exactly one provider call. The result write is conditional on the
 * claim and on the address being unchanged, so an address edited while the
 * request was running never receives the old pin (the trigger has already
 * re-queued it). */
export async function drainGeocodeQueue(admin: SupabaseClient, opts: DrainOptions = {}): Promise<BatchSummary> {
  const provider = opts.provider ?? geocodeProvider();
  const now = opts.now ?? new Date();
  const limit = Math.max(1, Math.min(opts.limit ?? 10, MAX_GEOCODE_BATCH));
  let q = admin.from("locations").select(COLS).is("archived_at", null).is("trashed_at", null).in("geocode_status", ["pending", "failed"]).lt("geocode_attempts", MAX_GEOCODE_ATTEMPTS);
  q = opts.ids?.length ? q.in("id", opts.ids.slice(0, MAX_GEOCODE_BATCH)) : q.order("geocode_attempted_at", { ascending: true, nullsFirst: true });
  const { data, error } = await q.limit(opts.ids?.length ? MAX_GEOCODE_BATCH : limit * 4);
  if (error) throw new Error(`Couldn't read the geocoding queue: ${error.message}`);
  const rows = ((data ?? []) as LocRow[]).filter((r) => isDue(r, now, opts.ignoreBackoff === true)).slice(0, limit);
  const summary: BatchSummary = { provider: provider.source, processed: 0, resolved: 0, ambiguous: 0, failed: 0, incomplete: 0, skipped: 0, remaining: 0 };

  for (const [i, r] of rows.entries()) {
    if (i > 0) await sleep(opts.pauseMs ?? 250);
    const claimed = r.geocode_attempts + 1;
    const sameAddress = <T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(u: T): T => {
      for (const k of ["address", "city", "state", "postal_code"] as const) u = r[k] === null ? u.is(k, null) : u.eq(k, r[k] as string);
      return u;
    };
    // 1. Claim (one worker per attempt).
    const { data: claim } = await sameAddress(
      admin.from("locations").update({ geocode_attempts: claimed, geocode_attempted_at: now.toISOString() }).eq("id", r.id).eq("geocode_status", r.geocode_status).eq("geocode_attempts", r.geocode_attempts)
    ).select("id");
    if (!claim?.length) {
      summary.skipped++;
      continue;
    }
    summary.processed++;
    // 2. Result — only if our claim still stands and the address is unchanged.
    const write = async (patch: Record<string, unknown>) => {
      const { data: done } = await sameAddress(admin.from("locations").update(patch).eq("id", r.id).eq("geocode_attempts", claimed)).select("id");
      if (!done?.length) summary.skipped++;
      return Boolean(done?.length);
    };
    const query = geocodeQueryFor(r);
    if (!query.ok) {
      if (await write({ geocode_status: "incomplete", geocode_error: query.reason, latitude: null, longitude: null })) summary.incomplete++;
      continue;
    }
    let candidates: GeocodeCandidate[];
    try {
      candidates = await provider.geocode(query.text);
    } catch (e) {
      // Transient (network, timeout, 429, 5xx, key/config): retried with backoff.
      if (await write({ geocode_status: "failed", geocode_error: safeError(e) })) summary.failed++;
      continue;
    }
    const decision = decideGeocode(candidates, r.state);
    if (decision.status === "resolved") {
      const ok = await write({
        latitude: decision.lat,
        longitude: decision.lng,
        geocode_status: "resolved",
        geocode_source: provider.source,
        geocoded_at: new Date().toISOString(),
        geocode_error: null,
        geocode_address: normalizedAddressKey(r),
        ...(r.timezone ? {} : { timezone: timezoneFor(decision.timezone, r.state) }),
      });
      if (ok) summary.resolved++;
    } else if (decision.status === "ambiguous") {
      if (await write({ geocode_status: "ambiguous", geocode_error: decision.reason })) summary.ambiguous++;
    } else if (await write({ geocode_status: "failed", geocode_error: `${decision.reason} — not retried automatically`, geocode_attempts: MAX_GEOCODE_ATTEMPTS })) {
      // The provider answered and found nothing: retrying the same input
      // won't help, so it waits for Admin (or an address change).
      summary.failed++;
    }
  }
  const { count } = await admin.from("locations").select("id", { count: "exact", head: true }).is("archived_at", null).is("trashed_at", null).in("geocode_status", ["pending", "failed"]).lt("geocode_attempts", MAX_GEOCODE_ATTEMPTS);
  summary.remaining = count ?? 0;
  return summary;
}

/** Admin recovery / backfill: one bounded batch, retrying failed ones now. */
export function runGeocodeBatch(admin: SupabaseClient, opts: Omit<DrainOptions, "ignoreBackoff"> = {}): Promise<BatchSummary> {
  return drainGeocodeQueue(admin, { ...opts, ignoreBackoff: true });
}

/** Admin pin correction: writes the coordinate; the database trigger
 * records it as a 'manual' placement. */
export async function setManualCoordinate(admin: SupabaseClient, id: string, lat: number, lng: number): Promise<boolean> {
  const { data } = await admin.from("locations").update({ latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lng * 1e6) / 1e6 }).eq("id", id).select("id");
  return Boolean(data?.length);
}

/** Admin "Retry": back into the queue with a fresh attempt budget. */
export async function requeueLocation(admin: SupabaseClient, id: string): Promise<void> {
  await admin.from("locations").update({ geocode_status: "pending", geocode_attempts: 0, geocode_error: null, geocode_attempted_at: null }).eq("id", id).in("geocode_status", ["failed", "ambiguous", "incomplete", "pending"]);
}
