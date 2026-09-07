import Link from "next/link";
import { getAdminAppearances, getBusinessOptionById } from "@/lib/admin/queries";
import { RelationField } from "@/components/admin/RelationPicker";
import { formatAppearanceDateRange, cityState } from "@/lib/format";

export const dynamic = "force-dynamic";

const selectClass =
  "rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none";

export default async function AdminAppearancesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; when?: string; business?: string; linkage?: string; imported?: string }>;
}) {
  const { q, when, business, linkage, imported } = await searchParams;
  // Admin Where You'll Be Organization pass — the raw 80+-row, no-default-
  // filter view was unusable. "Upcoming" (nearest-first) is now the real
  // default on first load; "all" is an explicit choice, not the absence
  // of one. Any unrecognized/missing value still falls back to upcoming.
  const whenFilter = when === "past" || when === "all" ? when : "upcoming";
  const linkageFilter = linkage === "event" || linkage === "standalone" ? linkage : undefined;

  const [appearances, initialBusiness] = await Promise.all([
    getAdminAppearances({ q, when: whenFilter, businessId: business, linkage: linkageFilter }),
    getBusinessOptionById(business ?? null),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Where You&rsquo;ll Be
        </h1>
        <div className="flex shrink-0 gap-2">
          <Link
            href="/admin/appearances/import"
            className="rounded-full border border-black/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:border-black/20"
          >
            Import Appearances
          </Link>
          <Link
            href="/admin/appearances/new"
            className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
          >
            Add Where You&rsquo;ll Be
          </Link>
        </div>
      </div>

      {imported && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Imported {imported} appearance{imported === "1" ? "" : "s"}.
        </p>
      )}

      <form method="get" className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by title, venue, or city…"
          className="w-full min-w-0 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none sm:max-w-xs sm:flex-1"
        />
        <div className="w-full sm:w-56">
          <RelationField
            label="Business"
            name="business"
            entity="businesses"
            initial={initialBusiness}
            clearLabel="All businesses"
            placeholder="Filter by business…"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select name="when" defaultValue={whenFilter} className={selectClass}>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="all">All</option>
          </select>
          <select name="linkage" defaultValue={linkage ?? ""} className={selectClass}>
            <option value="">Event-linked & Standalone</option>
            <option value="event">Event-linked only</option>
            <option value="standalone">Standalone only</option>
          </select>
          <button
            type="submit"
            className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-black/[0.03]"
          >
            Filter
          </button>
        </div>
      </form>

      <p className="mt-4 text-xs text-ink/40">
        {appearances.length >= 500
          ? "Showing the first 500 matching results — narrow with search or filters to see more."
          : `${appearances.length} result${appearances.length === 1 ? "" : "s"}.`}
      </p>

      {/* Admin Where You'll Be Organization pass — row hierarchy is Title
          (the schedule entry itself) → Business → Date/time, Venue,
          City/State, so a founder can understand a record without
          opening it. The Linked Event/Standalone badge reads event_id
          directly (never inferred from title/name matching — see
          getAdminAppearances's own linkage filter, same source of
          truth), stacked above the existing status badge so both stay
          visible without widening the row. */}
      <div className="mt-2 flex flex-col gap-2">
        {appearances.length === 0 ? (
          <p className="text-sm text-ink/50">No results for this view.</p>
        ) : (
          appearances.map((a) => {
            const location = [a.venue_name, cityState(a.city, a.state)].filter(Boolean).join(" · ");
            return (
              <Link
                key={a.id}
                href={`/admin/appearances/${a.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{a.title}</p>
                  <p className="truncate text-xs text-ink/60">{a.business?.name ?? "—"}</p>
                  <p className="truncate text-xs text-ink/45">
                    {formatAppearanceDateRange(a.start_at, a.end_at, a.description)}
                    {location ? ` · ${location}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                      a.event_id ? "bg-findmi-50 text-findmi-700" : "bg-black/[0.06] text-ink/60"
                    }`}
                  >
                    {a.event_id ? "Linked Event" : "Standalone"}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                      a.status === "canceled"
                        ? "bg-black/[0.06] text-ink/50"
                        : a.status === "tentative"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-findmi-50 text-findmi-700"
                    }`}
                  >
                    {a.status}
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
