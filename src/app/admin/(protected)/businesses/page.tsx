import Link from "next/link";
import { getAdminBusinesses, getAllCategories } from "@/lib/admin/queries";
import { adminSortOptions, BUSINESS_SORT, parseAdminSort } from "@/lib/admin/list-sort";
import { adminListScopeKey, parseAdminPage } from "@/lib/admin/list-page";
import AdminPagination from "@/components/admin/AdminPagination";
import BusinessesFilterBar from "./BusinessesFilterBar";
import BusinessBulkListClient from "./BusinessBulkListClient";

export const dynamic = "force-dynamic";

const LIFECYCLE_TABS = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
  { value: "trashed", label: "Trash" },
] as const;

// Admin Integrity Repair pass — URL-backed sort; "newest" stays the
// default (admin operationally needs to see newly-created businesses
// first). Shared Admin List Foundation — the options now come from the
// shared BUSINESS_SORT (Newest / Recently Updated / Oldest / A–Z / Z–A).
const SORT_OPTIONS = adminSortOptions(BUSINESS_SORT);
const PATH = "/admin/businesses";

export default async function AdminBusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; published?: string; decided?: string; lifecycle?: string; result?: string; sort?: string; page?: string }>;
}) {
  const params = await searchParams;
  const { q, category, published, decided, lifecycle, result, sort } = params;
  const page = parseAdminPage(params.page);
  const publishedFilter =
    published === "public" || published === "demo" || published === "pending_review" ? published : undefined;
  const lifecycleTab = LIFECYCLE_TABS.find((t) => t.value === lifecycle)?.value;
  const sortFilter = parseAdminSort(sort, BUSINESS_SORT);
  // Admin Content Lifecycle V2 — the lifecycle tabs are ignored while a
  // `published` moderation filter is active (same "two independent
  // dimensions, moderation queue wins the query branch" rule Products
  // V1 established), otherwise default to "active".
  const effectiveLifecycle = publishedFilter ? undefined : (lifecycleTab ?? "active");

  const [list, categories] = await Promise.all([
    getAdminBusinesses({ q, categoryId: category, published: publishedFilter, lifecycle: effectiveLifecycle, sort: sortFilter, page }),
    getAllCategories("business"),
  ]);

  const barView: "active" | "paused" | "archived" | "trashed" | "other" = publishedFilter
    ? "other"
    : (effectiveLifecycle ?? "active");

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Businesses</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link
            href="/admin/businesses/import"
            className="rounded-full border border-black/15 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:border-black/30"
          >
            Import Brands
          </Link>
          <Link
            href="/admin/businesses/new"
            className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
          >
            Add Business
          </Link>
        </div>
      </div>

      {/* Admin Pending Review Decision UX pass — the "return naturally to
          the review queue" success state after Approve/Reject on the edit
          page. The decided business itself is already gone from this list
          by the time this renders (published=pending_review filter, same
          authoritative query the decision panel wrote to). */}
      {(decided === "approved" || decided === "rejected") && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          {decided === "approved" ? "Business approved and now Published." : "Business rejected."}
        </p>
      )}

      {result && (
        <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-2.5 text-sm text-ink/80">{result}</p>
      )}

      {/* Admin Content Lifecycle V2 — the four lifecycle views, reachable
          as plain, visible pill links (never an obscure query param a
          visitor has to guess) — same pattern as Products. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {LIFECYCLE_TABS.map((tab) => {
          const active = (lifecycleTab ?? "active") === tab.value && !publishedFilter;
          const tabParams = new URLSearchParams();
          if (tab.value !== "active") tabParams.set("lifecycle", tab.value);
          if (q) tabParams.set("q", q);
          if (category) tabParams.set("category", category);
          if (sortFilter !== BUSINESS_SORT.defaultKey) tabParams.set("sort", sortFilter);
          const href = `/admin/businesses${tabParams.toString() ? `?${tabParams.toString()}` : ""}`;
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

      <BusinessesFilterBar
        categories={categories}
        initialQ={q ?? ""}
        initialCategory={category ?? ""}
        initialPublished={published ?? ""}
        initialLifecycle={lifecycleTab && lifecycleTab !== "active" ? lifecycleTab : undefined}
        initialSort={sortFilter}
        sortOptions={SORT_OPTIONS}
        defaultSort={BUSINESS_SORT.defaultKey}
      >
        <BusinessBulkListClient
          businesses={list.rows}
          view={barView}
          categories={categories}
          scopeKey={adminListScopeKey(params)}
          emptyMessage={
            list.failed
              ? "Couldn't load Businesses — try again."
              : q || category || publishedFilter
              ? "No Businesses match these filters."
              : "No Businesses in this view."
          }
        />
        <AdminPagination pathname={PATH} params={params} result={list} noun="Businesses" />
      </BusinessesFilterBar>
    </div>
  );
}
