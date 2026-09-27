import Link from "next/link";
import { getAdminLocations, getAllCategories } from "@/lib/admin/queries";
import LocationBulkListClient from "./LocationBulkListClient";

export const dynamic = "force-dynamic";

// No "Paused" tab — Locations have no Pause concept at all (V1's audit
// finding, reconfirmed in V2 — no column exists to pause one).
const LIFECYCLE_TABS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "trashed", label: "Trash" },
] as const;

export default async function AdminLocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lifecycle?: string; result?: string }>;
}) {
  const { q, lifecycle, result } = await searchParams;
  const lifecycleTab = LIFECYCLE_TABS.find((t) => t.value === lifecycle)?.value ?? "active";

  const [locations, categories] = await Promise.all([
    getAdminLocations(q, lifecycleTab),
    getAllCategories("location"),
  ]);

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

      {result && (
        <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-2.5 text-sm text-ink/80">{result}</p>
      )}

      {/* Admin Content Lifecycle V2 — the three lifecycle views, reachable
          as plain, visible pill links (never an obscure query param a
          visitor has to guess) — same pattern as Products/Businesses/
          Events, minus the Paused tab which doesn't apply here. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {LIFECYCLE_TABS.map((tab) => {
          const active = lifecycleTab === tab.value;
          const params = new URLSearchParams();
          if (tab.value !== "active") params.set("lifecycle", tab.value);
          if (q) params.set("q", q);
          const href = `/admin/locations${params.toString() ? `?${params.toString()}` : ""}`;
          return (
            <Link
              key={tab.value}
              href={href}
              className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${
                active ? "bg-ink text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <form method="get" className="mt-4">
        {lifecycleTab !== "active" && <input type="hidden" name="lifecycle" value={lifecycleTab} />}
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by name, city, or address…"
          className="w-full max-w-sm rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
        />
      </form>

      <div className="mt-4">
        <LocationBulkListClient locations={locations} view={lifecycleTab} categories={categories} />
      </div>
    </div>
  );
}
