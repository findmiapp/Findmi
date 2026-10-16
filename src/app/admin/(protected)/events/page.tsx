import Link from "next/link";
import Form from "next/form";
import { getAdminEvents, getAllCategories } from "@/lib/admin/queries";
import { adminSortOptions, EVENT_SORT, NEW_EVENTS_DEFAULT_SORT, parseAdminSort } from "@/lib/admin/list-sort";
import { adminListHref, adminListScopeKey, parseAdminPage } from "@/lib/admin/list-page";
import AdminSortSelect from "@/components/admin/AdminSortSelect";
import AdminPagination from "@/components/admin/AdminPagination";
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

const PATH = "/admin/events";

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
    sort?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const { q, when, vendorApps, pending, needsReview, new: newParam, decided, lifecycle, result } = params;
  const page = parseAdminPage(params.page);
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
  // Shared Admin List Foundation — the existing chronological order stays
  // the default (Event Date: Latest First); New Events keeps its newest-
  // ADDED-first order. "Newest" / "Oldest" always mean created_at.
  const defaultSort = newEventsOnly && pending !== "1" ? NEW_EVENTS_DEFAULT_SORT : EVENT_SORT.defaultKey;
  const sort = parseAdminSort(params.sort, EVENT_SORT, defaultSort);
  // An explicitly chosen sort follows the operator across views.
  const chosenSort = EVENT_SORT.options.find((k) => k === params.sort);

  const [list, categories] = await Promise.all([
    getAdminEvents({
      q,
      when: whenFilter,
      vendorAppsOpen: vendorApps === "1",
      pendingApplications: pending === "1",
      needsReview: needsReviewOnly,
      newEvents: newEventsOnly,
      lifecycle: effectiveLifecycle,
      sort,
      page,
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
          href={adminListHref(PATH, { q, sort: chosenSort }, { new: "1" })}
          className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${
            newEventsOnly ? "bg-findmi text-white" : "border border-findmi/40 text-findmi-700 hover:border-findmi"
          }`}
        >
          New Events
        </Link>
        {LIFECYCLE_TABS.map((tab) => {
          const active = (lifecycleTab ?? "active") === tab.value && !moderationFilterActive;
          const href = adminListHref(PATH, { q, when, sort: chosenSort }, { lifecycle: tab.value !== "active" ? tab.value : null });
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

      {/* Search + filters run in the database before the page range;
          submitting keeps the view and sort and resets to page 1 (no
          `page` field). next/form navigates client-side. */}
      <Form action={PATH} className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {newEventsOnly && <input type="hidden" name="new" value="1" />}
        {needsReviewOnly && <input type="hidden" name="needsReview" value="1" />}
        {lifecycleTab && lifecycleTab !== "active" && <input type="hidden" name="lifecycle" value={lifecycleTab} />}
        {chosenSort && <input type="hidden" name="sort" value={chosenSort} />}
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
      </Form>

      <div className="mt-3">
        <AdminSortSelect pathname={PATH} params={params} value={sort} defaultValue={defaultSort} options={adminSortOptions(EVENT_SORT)} />
      </div>

      <div className="mt-4">
        <EventBulkListClient
          events={list.rows}
          view={barView}
          categories={categories}
          scopeKey={adminListScopeKey(params)}
          emptyMessage={
            list.failed
              ? "Couldn't load Events — try again."
              : q || whenFilter || vendorApps === "1" || pending === "1"
              ? "No Events match these filters."
              : undefined
          }
        />
        <AdminPagination pathname={PATH} params={params} result={list} noun="Events" />
      </div>
    </div>
  );
}
