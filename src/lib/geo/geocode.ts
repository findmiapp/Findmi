import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decideGeocode,
  geocodeQueryFor,
  MAX_GEOCODE_ATTEMPTS,
  MAX_GEOCODE_BATCH,
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
// The runner is the ONLY writer of geocoded coordinates: bounded batches
// (≤ 25), sequential with a pause between requests, never at request time
// and never from a migration.

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
  skipped: number;
  remaining: number;
}

type LocRow = { id: string; name: string; address: string | null; city: string | null; state: string | null; postal_code: string | null; geocode_status: GeocodeStatus; geocode_attempts: number; timezone: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Geocode one bounded batch of queued Locations (pending first, then
 * failed ones under the attempt cap) — or exactly `ids` when given (Admin
 * "Retry"). Each write is conditional on the address being unchanged
 * since it was read, so an edit made mid-batch never gets a stale pin. */
export async function runGeocodeBatch(admin: SupabaseClient, opts: { limit?: number; ids?: string[]; provider?: Provider; pauseMs?: number } = {}): Promise<BatchSummary> {
  const provider = opts.provider ?? geocodeProvider();
  const limit = Math.max(1, Math.min(opts.limit ?? 10, MAX_GEOCODE_BATCH));
  const cols = "id, name, address, city, state, postal_code, geocode_status, geocode_attempts, timezone";
  let q = admin.from("locations").select(cols).is("archived_at", null).is("trashed_at", null);
  q = opts.ids?.length
    ? q.in("id", opts.ids.slice(0, MAX_GEOCODE_BATCH))
    : q.in("geocode_status", ["pending", "failed"]).lt("geocode_attempts", MAX_GEOCODE_ATTEMPTS).order("geocode_status", { ascending: false }).order("geocode_attempts", { ascending: true });
  const { data, error } = await q.limit(limit);
  if (error) throw new Error(`Couldn't read the geocoding queue: ${error.message}`);
  const rows = (data ?? []) as LocRow[];
  const summary: BatchSummary = { provider: provider.source, processed: 0, resolved: 0, ambiguous: 0, failed: 0, incomplete: 0, skipped: 0, remaining: 0 };

  for (const [i, r] of rows.entries()) {
    if (i > 0) await sleep(opts.pauseMs ?? 250);
    summary.processed++;
    const write = async (patch: Record<string, unknown>) => {
      let u = admin.from("locations").update({ ...patch, geocode_attempts: r.geocode_attempts + 1 }).eq("id", r.id);
      for (const k of ["address", "city", "state", "postal_code"] as const) u = r[k] === null ? u.is(k, null) : u.eq(k, r[k] as string);
      const { data: done } = await u.select("id");
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
      if (await write({ geocode_status: "failed", geocode_error: (e instanceof Error ? e.message : "Provider error").slice(0, 300) })) summary.failed++;
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
    } else if (await write({ geocode_status: decision.status, geocode_error: decision.reason })) {
      if (decision.status === "ambiguous") summary.ambiguous++;
      else summary.failed++;
    }
  }
  const { count } = await admin.from("locations").select("id", { count: "exact", head: true }).is("archived_at", null).is("trashed_at", null).in("geocode_status", ["pending", "failed"]).lt("geocode_attempts", MAX_GEOCODE_ATTEMPTS);
  summary.remaining = count ?? 0;
  return summary;
}

/** Admin pin correction: writes the coordinate; the database trigger
 * records it as a 'manual' placement. */
export async function setManualCoordinate(admin: SupabaseClient, id: string, lat: number, lng: number): Promise<boolean> {
  const { data } = await admin.from("locations").update({ latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lng * 1e6) / 1e6 }).eq("id", id).select("id");
  return Boolean(data?.length);
}

/** Admin "Retry": back into the queue with a fresh attempt budget. */
export async function requeueLocation(admin: SupabaseClient, id: string): Promise<void> {
  await admin.from("locations").update({ geocode_status: "pending", geocode_attempts: 0, geocode_error: null }).eq("id", id).in("geocode_status", ["failed", "ambiguous", "incomplete", "pending"]);
}
