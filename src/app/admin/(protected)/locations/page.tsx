import Link from "next/link";
import { getAdminLocations } from "@/lib/admin/queries";
import { cityState } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminLocationsPage() {
  const locations = await getAdminLocations();

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Locations</h1>
        <Link
          href="/admin/locations/new"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
        >
          Add Location
        </Link>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {locations.length === 0 ? (
          <p className="text-sm text-ink/50">No locations yet.</p>
        ) : (
          locations.map((l) => (
            <Link
              key={l.id}
              href={`/admin/locations/${l.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{l.name}</p>
                <p className="truncate text-xs text-ink/45">
                  {[l.address, cityState(l.city, l.state)].filter(Boolean).join(" · ") || l.slug}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                  l.is_demo ? "bg-black/[0.06] text-ink/50" : "bg-findmi-50 text-findmi-700"
                }`}
              >
                {l.is_demo ? "Demo" : "Public"}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
