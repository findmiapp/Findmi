import Link from "next/link";
import { getAdminAppearances, getBusinessOptionById } from "@/lib/admin/queries";
import { RelationField } from "@/components/admin/RelationPicker";
import { formatAppearanceDateRange } from "@/lib/format";

export const dynamic = "force-dynamic";

const selectClass =
  "rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none";

export default async function AdminAppearancesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; when?: string; business?: string; linkage?: string; imported?: string }>;
}) {
  const { q, when, business, linkage, imported } = await searchParams;
  const whenFilter = when === "upcoming" || when === "past" ? when : undefined;
  const linkageFilter = linkage === "event" || linkage === "standalone" ? linkage : undefined;

  const [appearances, initialBusiness] = await Promise.all([
    getAdminAppearances({ q, when: whenFilter, businessId: business, linkage: linkageFilter }),
    getBusinessOptionById(business ?? null),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Appearances
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
            Add Appearance
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
          <select name="when" defaultValue={when ?? ""} className={selectClass}>
            <option value="">All Dates</option>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
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

      <div className="mt-4 flex flex-col gap-2">
        {appearances.length === 0 ? (
          <p className="text-sm text-ink/50">No appearances yet.</p>
        ) : (
          appearances.map((a) => (
            <Link
              key={a.id}
              href={`/admin/appearances/${a.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {a.business?.name ?? "—"} → {a.title}
                </p>
                <p className="truncate text-xs text-ink/45">
                  {formatAppearanceDateRange(a.start_at, a.end_at, a.description)}
                  {a.event ? ` · Event: ${a.event.name}` : " · No event (Maps fallback)"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                  a.status === "canceled"
                    ? "bg-black/[0.06] text-ink/50"
                    : a.status === "tentative"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-findmi-50 text-findmi-700"
                }`}
              >
                {a.status}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
