import Link from "next/link";
import { getAdminEvents, getAllCategories } from "@/lib/admin/queries";
import EventBulkListClient from "./EventBulkListClient";
import { NEW_EVENT_WINDOW_DAYS } from "@/lib/event-publication";

export const dynamic = "force-dynamic";

const selectClass =
  "rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none";

// No "Paused" tab — events have no Pause concept (DB CHECK constraint on
// publication_status; see events/lifecycle-actions.ts's note).
const LIFECYCLE_TABS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "trashed", label: "Trash" },
] as const;

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    when?: string;
    vendorApps?: string;
    pending?: string;
    needsReview?: string;
    new?: string;
    decided?: string;
    lifecycle?: string;
    result?: string;
  }>;
}) {
  const { q, when, vendorApps, pending, needsReview, new: newParam, decided, lifecycle, result } = await searchParams;
  // Event Publication — Events go live when created; "New Events" is
  // Admin's oversight of what was just added (not an approval queue).
  const newEventsOnly = newParam === "1";
  const whenFilter = when === "upcoming" || when === "past" ? when : undefined;
  const needsReviewOnly = needsReview === "1";
  const lifecycleTab = LIFECYCLE_TABS.find((t) => t.value === lifecycle)?.value;
  // Admin Content Lifecycle V2 — same "moderation queue filter wins the
  // query branch" rule as Businesses: the lifecycle tabs are ignored
  // while vendorApps/pending/needsReview drive a dedicated query branch,
  // otherwise default to "active".
  const moderationFilterActive = vendorApps === "1" || pending === "1" || needsReviewOnly || newEventsOnly;
  const effectiveLifecycle = moderationFilterActive ? undefined : (lifecycleTab ?? "active");

  const [events, categories] = await Promise.all([
    getAdminEvents({
      q,
      when: whenFilter,
      vendorAppsOpen: vendorApps === "1",
      pendingApplications: pending === "1",
      needsReview: needsReviewOnly,
      newEvents: newEventsOnly,
      lifecycle: effectiveLifecycle,
    }),
    getAllCategories("event"),
  ]);

  const barView: "active" | "archived" | "trashed" | "other" | "new" = newEventsOnly
    ? "new"
    : moderationFilterActive
    ? "other"
    : (effectiveLifecycle ?? "active");

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Events</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/events/import"
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:border-findmi/40"
          >
            Import Events
          </Link>
          <Link
            href="/admin/events/new"
            className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
          >
            Add Event
          </Link>
        </div>
      </div>

      {/* Admin Pending Review Decision UX pass, extended by Event Rejection
          State — the "return naturally to the review queue" success state
          after Approve/Reject on the edit page. The decided event itself
          is already gone from this list by the time this renders
          (needsReview=1 filter, same authoritative publication_status the
          decision panel wrote to). */}
      {decided === "approved" && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Event approved and now live.
        </p>
      )}
      {decided === "rejected" && (
        <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3 text-sm text-ink/70">
          Event rejected.
        </p>
      )}

      {result && (
        <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-2.5 text-sm text-ink/80">{result}</p>
      )}

      {/* Admin Content Lifecycle V2 — the four lifecycle views, reachable
          as plain, visible pill links (never an obscure query param a
          visitor has to guess) — same pattern as Products/Businesses. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/admin/events?new=1${q ? `&q=${encodeURIComponent(q)}` : ""}`}
          className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${
            newEventsOnly ? "bg-findmi text-white" : "border border-findmi/40 text-findmi-700 hover:border-findmi"
          }`}
        >
          New Events
        </Link>
        {LIFECYCLE_TABS.map((tab) => {
          const active = (lifecycleTab ?? "active") === tab.value && !moderationFilterActive;
          const params = new URLSearchParams();
          if (tab.value !== "active") params.set("lifecycle", tab.value);
          if (q) params.set("q", q);
          if (when) params.set("when", when);
          const href = `/admin/events${params.toString() ? `?${params.toString()}` : ""}`;
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

      {newEventsOnly && (
        <p className="mt-3 text-xs text-ink/55">
          Every Event created in the last {NEW_EVENT_WINDOW_DAYS} days, newest first. They&rsquo;re published when created — Unpublish or
          Archive any of them here.
        </p>
      )}

      <form method="get" className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {newEventsOnly && <input type="hidden" name="new" value="1" />}
        {lifecycleTab && lifecycleTab !== "active" && <input type="hidden" name="lifecycle" value={lifecycleTab} />}
        <input autoCapitalize="none"
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
          <button
            type="submit"
            className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-black/[0.03]"
          >
            Filter
          </button>
        </div>
      </form>

      <div className="mt-4">
        <EventBulkListClient events={events} view={barView} categories={categories} />
      </div>
    </div>
  );
}
