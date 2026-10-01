import Link from "next/link";
import { getAdminBusinesses, getAllCategories } from "@/lib/admin/queries";
import BusinessesFilterBar from "./BusinessesFilterBar";
import BusinessBulkListClient from "./BusinessBulkListClient";

export const dynamic = "force-dynamic";

const LIFECYCLE_TABS = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
  { value: "trashed", label: "Trash" },
] as const;

// Admin Integrity Repair pass — URL-backed sort, same "plain, visible
// pill links" convention as LIFECYCLE_TABS above rather than a hidden
// default a visitor has to discover. "newest" is the default (see
// SORT_OPTIONS' own usage below) — admin operationally needs to see
// newly-created businesses first, which plain A–Z sorting never
// surfaced reliably.
const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "updated", label: "Recently Updated" },
  { value: "az", label: "A–Z" },
  { value: "oldest", label: "Oldest" },
] as const;

export default async function AdminBusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; published?: string; decided?: string; lifecycle?: string; result?: string; sort?: string }>;
}) {
  const { q, category, published, decided, lifecycle, result, sort } = await searchParams;
  const publishedFilter =
    published === "public" || published === "demo" || published === "pending_review" ? published : undefined;
  const lifecycleTab = LIFECYCLE_TABS.find((t) => t.value === lifecycle)?.value;
  const sortFilter = SORT_OPTIONS.find((s) => s.value === sort)?.value ?? "newest";
  // Admin Content Lifecycle V2 — the lifecycle tabs are ignored while a
  // `published` moderation filter is active (same "two independent
  // dimensions, moderation queue wins the query branch" rule Products
  // V1 established), otherwise default to "active".
  const effectiveLifecycle = publishedFilter ? undefined : (lifecycleTab ?? "active");

  const [businesses, categories] = await Promise.all([
    getAdminBusinesses({ q, categoryId: category, published: publishedFilter, lifecycle: effectiveLifecycle, sort: sortFilter }),
    getAllCategories("business"),
  ]);

  const barView: "active" | "paused" | "archived" | "trashed" | "other" = publishedFilter
    ? "other"
    : (effectiveLifecycle ?? "active");

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Businesses</h1>
        <Link
          href="/admin/businesses/new"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
        >
          Add Business
        </Link>
      </div>

      {/* Admin Pending Review Decision UX pass — the "return naturally to
          the review queue" success state after Approve/Reject on the edit
          page. The decided business itself is already gone from this list
          by the time this renders (published=pending_review filter, same
          authoritative query the decision panel wrote to). */}
      {(decided === "approved" || decided === "rejected") && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          {decided === "approved" ? "Business approved and now live." : "Business rejected."}
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
          const params = new URLSearchParams();
          if (tab.value !== "active") params.set("lifecycle", tab.value);
          if (q) params.set("q", q);
          if (category) params.set("category", category);
          if (sortFilter !== "newest") params.set("sort", sortFilter);
          const href = `/admin/businesses${params.toString() ? `?${params.toString()}` : ""}`;
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
      >
        <BusinessBulkListClient businesses={businesses} view={barView} categories={categories} />
      </BusinessesFilterBar>
    </div>
  );
}
