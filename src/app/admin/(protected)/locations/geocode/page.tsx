import Link from "next/link";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { GEOCODE_STATUSES, MAX_GEOCODE_ATTEMPTS, MAX_GEOCODE_BATCH, type GeocodeStatus } from "@/lib/geo/geocode-core";
import { placeNextBatch, retryLocation, setPin } from "./actions";

export const dynamic = "force-dynamic";

const LABEL: Record<GeocodeStatus, string> = {
  pending: "Queued",
  resolved: "Placed",
  manual: "Placed By Hand",
  incomplete: "Incomplete Address",
  ambiguous: "Needs A Choice",
  failed: "Failed",
};

type Row = { id: string; name: string; slug: string; address: string | null; city: string | null; state: string | null; postal_code: string | null; geocode_status: GeocodeStatus; geocode_error: string | null; geocode_attempts: number };

/**
 * Locations → Map Placement. Canonical coordinates are durable Location
 * data, placed by a controlled batch (never on page load, never by a
 * migration). Coordinates never make a Location publicly discoverable —
 * the existing listing/imagery rule still decides that.
 */
export default async function GeocodePage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const { result } = await searchParams;
  const admin = await requireAdminSupabase();
  const counts = await Promise.all(
    GEOCODE_STATUSES.map(async (s) => {
      const { count, error } = await admin.from("locations").select("id", { count: "exact", head: true }).is("archived_at", null).is("trashed_at", null).eq("geocode_status", s);
      return { s, count: count ?? 0, error };
    })
  );
  const missing = counts.some((c) => c.error);
  const { data } = missing
    ? { data: [] }
    : await admin.from("locations").select("id, name, slug, address, city, state, postal_code, geocode_status, geocode_error, geocode_attempts").is("archived_at", null).is("trashed_at", null).in("geocode_status", ["ambiguous", "failed", "incomplete"]).order("name").limit(60);
  const attention = (data ?? []) as Row[];
  const provider = process.env.GEOCODER === "census" || !process.env.GEOCODIO_API_KEY ? "U.S. Census geocoder (keyless)" : "Geocodio";

  return (
    <div className="max-w-3xl">
      <Link href="/admin/locations" className="text-xs font-bold uppercase tracking-wide text-ink/50 hover:text-ink">
        ← Locations
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">Map Placement</h1>
      <p className="mt-1 text-sm text-ink/60">
        Places each Location on the Findmi Map from its own address. Runs in small batches, only when you ask. A changed address clears its pin and
        re-queues it automatically. Being on the map never makes a Location publicly listed.
      </p>

      {result && <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-2.5 text-sm text-ink/80">{result}</p>}

      {missing ? (
        <p className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
          The Discovery Engine migration (20261114000000_discovery_engine_map_v1.sql) hasn&rsquo;t been applied yet, so there&rsquo;s nothing to place.
        </p>
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {counts.map((c) => (
              <div key={c.s} className="rounded-xl border border-black/5 bg-white px-3 py-2.5">
                <dt className="text-[11px] font-bold uppercase tracking-wide text-ink/45">{LABEL[c.s]}</dt>
                <dd className="font-display text-xl font-bold text-ink">{c.count}</dd>
              </div>
            ))}
          </dl>

          <form action={placeNextBatch} className="mt-5 flex flex-wrap items-center gap-2">
            <select name="limit" defaultValue="10" className="min-h-11 rounded-full border border-black/10 bg-white px-3 text-sm">
              {[5, 10, MAX_GEOCODE_BATCH].map((n) => (
                <option key={n} value={n}>
                  Next {n}
                </option>
              ))}
            </select>
            <button type="submit" className="min-h-11 rounded-full bg-findmi px-5 text-sm font-bold text-white hover:bg-findmi-600">
              Place On Map
            </button>
            <span className="text-xs text-ink/50">
              Using {provider}. Failed ones retry up to {MAX_GEOCODE_ATTEMPTS} times.
            </span>
          </form>

          <h2 className="mt-8 font-display text-lg font-semibold text-ink">Needs Attention</h2>
          {attention.length === 0 ? (
            <p className="mt-2 text-sm text-ink/60">Nothing needs attention.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {attention.map((r) => (
                <li key={r.id} className="rounded-2xl border border-black/5 bg-white p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/admin/locations/${r.id}`} className="font-semibold text-ink hover:underline">
                        {r.name}
                      </Link>
                      <p className="text-xs text-ink/55">{[r.address, r.city, r.state, r.postal_code].filter(Boolean).join(", ") || "No address"}</p>
                      <p className="mt-1 text-xs font-semibold text-amber-800">
                        {LABEL[r.geocode_status]}
                        {r.geocode_error ? ` — ${r.geocode_error}` : ""}
                      </p>
                    </div>
                    <form action={retryLocation}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="min-h-9 rounded-full border border-black/10 px-3 text-xs font-bold text-ink/70 hover:border-black/25">
                        Retry
                      </button>
                    </form>
                  </div>
                  <form action={setPin} className="mt-3 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <label className="flex flex-col text-[11px] font-semibold text-ink/50">
                      Latitude
                      <input autoCapitalize="none" name="latitude" inputMode="decimal" required className="min-h-9 w-32 rounded-lg border border-black/10 px-2 text-sm text-ink" />
                    </label>
                    <label className="flex flex-col text-[11px] font-semibold text-ink/50">
                      Longitude
                      <input autoCapitalize="none" name="longitude" inputMode="decimal" required className="min-h-9 w-32 rounded-lg border border-black/10 px-2 text-sm text-ink" />
                    </label>
                    <button type="submit" className="min-h-9 rounded-full bg-ink px-3 text-xs font-bold text-white">
                      Set Pin
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
