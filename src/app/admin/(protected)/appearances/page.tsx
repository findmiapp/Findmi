import Link from "next/link";
import { getAdminAppearances, getBusinessOptionById } from "@/lib/admin/queries";
import { RelationField } from "@/components/admin/RelationPicker";
import AppearanceReviewList from "./AppearanceReviewList";

export const dynamic = "force-dynamic";

const selectClass =
  "rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none";

const REVIEWED_VIEWS: { value: "unreviewed" | "reviewed" | "all"; label: string }[] = [
  { value: "unreviewed", label: "Unreviewed" },
  { value: "reviewed", label: "Reviewed" },
  { value: "all", label: "All" },
];

export default async function AdminAppearancesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; when?: string; business?: string; linkage?: string; reviewed?: string; imported?: string }>;
}) {
  const { q, when, business, linkage, reviewed, imported } = await searchParams;
  // Admin Where I'll Be Review Inbox pass — Unreviewed is now the real
  // default (was "Upcoming" reads only). Reviewed/All keep the existing
  // "Upcoming" default from the prior Organization pass unchanged; the
  // Unreviewed inbox itself defaults to "all" timing (not just upcoming)
  // when `when` isn't explicitly set, since this is an inbox of recently
  // ADDED records — a business could add a standalone entry for a date
  // that's already passed, and it still deserves acknowledgement. An
  // explicit ?when= always wins regardless of view.
  const reviewedFilter = reviewed === "reviewed" || reviewed === "all" ? reviewed : "unreviewed";
  const whenFilter =
    when === "past" || when === "all" || when === "upcoming"
      ? when
      : reviewedFilter === "unreviewed"
        ? "all"
        : "upcoming";
  const linkageFilter = linkage === "event" || linkage === "standalone" ? linkage : undefined;

  const [appearances, initialBusiness] = await Promise.all([
    getAdminAppearances({ q, when: whenFilter, businessId: business, linkage: linkageFilter, reviewed: reviewedFilter }),
    getBusinessOptionById(business ?? null),
  ]);

  return (
    <div>
      {/* Appearance Mobile Cleanup pass — this row's action-button group
          (unlike its single-button siblings on /admin/businesses,
          /admin/events, etc.) holds two full-label pill buttons that
          don't fit beside the heading at ~390px. `shrink-0` on the group
          previously forced it to keep its full content width with
          nowhere to go, pushing the whole page wider than the viewport.
          `flex-wrap` here lets the group drop to its own row under the
          heading when it doesn't fit; `flex-wrap` on the group itself is
          a second line of defense so the two buttons stack instead of
          overflowing even on that row. Desktop (`sm:`) keeps the
          original single-row, auto-width layout unchanged. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Where You&rsquo;ll Be
        </h1>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
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

      {/* Admin Where I'll Be Review Inbox pass — Unreviewed/Reviewed/All,
          the primary view switcher (defaults to Unreviewed), separate
          from the existing search/business/when/linkage filters below.
          Reviewing is Admin acknowledgement only — see
          admin_reviewed_at's own doc comment — never moderation, so this
          is deliberately NOT phrased as an approval queue. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {REVIEWED_VIEWS.map((v) => {
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          if (business) params.set("business", business);
          if (when) params.set("when", when);
          if (linkage) params.set("linkage", linkage);
          if (v.value !== "unreviewed") params.set("reviewed", v.value);
          const qs = params.toString();
          return (
            <Link
              key={v.value}
              href={qs ? `/admin/appearances?${qs}` : "/admin/appearances"}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                reviewedFilter === v.value ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
              }`}
            >
              {v.label}
            </Link>
          );
        })}
      </div>

      <form method="get" className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        {reviewed && <input type="hidden" name="reviewed" value={reviewedFilter} />}
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

      {/* Admin Where I'll Be Review Inbox pass — AppearanceReviewList is
          keyed off the actual id set so its internal selection state
          resets cleanly both when filters change AND after a successful
          bulk review (the revalidated appearance list no longer contains
          the reviewed ids). Bulk controls only render on the Unreviewed
          view (showBulk), per this pass's own "selection controls on the
          Unreviewed view" requirement. */}
      <div className="mt-2">
        <AppearanceReviewList
          key={appearances.map((a) => a.id).join(",")}
          appearances={appearances}
          showBulk={reviewedFilter === "unreviewed"}
        />
      </div>
    </div>
  );
}
