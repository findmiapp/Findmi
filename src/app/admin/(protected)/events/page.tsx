import Link from "next/link";
import { getAdminEvents, getEventIdsWithOwnersSet } from "@/lib/admin/queries";
import { formatDateRange } from "@/lib/format";

export const dynamic = "force-dynamic";

const selectClass =
  "rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none";

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; when?: string; vendorApps?: string; pending?: string; needsReview?: string }>;
}) {
  const { q, when, vendorApps, pending, needsReview } = await searchParams;
  const whenFilter = when === "upcoming" || when === "past" ? when : undefined;
  const needsReviewOnly = needsReview === "1";

  // Admin Needs Review pass — ownedEventIds badges every row "In Review"
  // (is_demo=true + has a real event_members owner) vs "Demo" (is_demo=
  // true, no owner — permanent seed/admin-draft content), matching the
  // exact same needsReview filter's own definition (getAdminEvents),
  // so the badge and the filter can never disagree about what counts.
  const [events, ownedEventIds] = await Promise.all([
    getAdminEvents({
      q,
      when: whenFilter,
      vendorAppsOpen: vendorApps === "1",
      pendingApplications: pending === "1",
      needsReview: needsReviewOnly,
    }),
    getEventIdsWithOwnersSet(),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Events</h1>
        <Link
          href="/admin/events/new"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
        >
          Add Event
        </Link>
      </div>

      <form method="get" className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by name, slug, or venue…"
          className="w-full min-w-0 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none sm:max-w-xs sm:flex-1"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select name="when" defaultValue={when ?? ""} className={selectClass}>
            <option value="">All Dates</option>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink/70">
            <input type="checkbox" name="vendorApps" value="1" defaultChecked={vendorApps === "1"} className="h-4 w-4 accent-findmi" />
            Vendor apps open
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink/70">
            <input type="checkbox" name="pending" value="1" defaultChecked={pending === "1"} className="h-4 w-4 accent-findmi" />
            Pending applications
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink/70">
            <input
              type="checkbox"
              name="needsReview"
              value="1"
              defaultChecked={needsReviewOnly}
              className="h-4 w-4 accent-findmi"
            />
            Needs review
          </label>
          <button
            type="submit"
            className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-black/[0.03]"
          >
            Filter
          </button>
        </div>
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {events.length === 0 ? (
          <p className="text-sm text-ink/50">No events found.</p>
        ) : (
          events.map((e) => {
            // Admin Needs Review pass — events has no publication_status
            // column, so "In Review" (a real organizer's submission, still
            // awaiting founder publish) is distinguished from plain "Demo"
            // (permanent seed/admin-draft content) by whether the event
            // has a real event_members owner — same definition the
            // needsReview filter/count above use.
            const status = !e.is_demo ? "Live" : ownedEventIds.has(e.id) ? "In Review" : "Demo";
            const statusClass =
              status === "Live"
                ? "bg-findmi-50 text-findmi-700"
                : status === "In Review"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-black/[0.06] text-ink/50";
            return (
              <Link
                key={e.id}
                href={`/admin/events/${e.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{e.name}</p>
                  <p className="truncate text-xs text-ink/45">
                    {formatDateRange(e.start_at, e.end_at)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${statusClass}`}>
                  {status}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
