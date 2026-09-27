import Link from "next/link";
import { getAdminProducts, getAllCategories, getBusinessOptionById } from "@/lib/admin/queries";
import { RelationField } from "@/components/admin/RelationPicker";
import ProductBulkListClient from "./ProductBulkListClient";

export const dynamic = "force-dynamic";

const LIFECYCLE_TABS = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
  { value: "trashed", label: "Trash" },
] as const;

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; business?: string; status?: string; result?: string }>;
}) {
  const { q, business, status, result } = await searchParams;
  const needsReview = status === "needs_review";
  // Product Marketplace Distribution pass — a SEPARATE filter/queue from
  // Needs Review above: content approval and Marketplace approval stay
  // two independent decisions, never combined into one filter.
  const marketplaceReview = status === "marketplace_review";
  // Admin Content Lifecycle V1 — the four lifecycle tabs are a THIRD,
  // independent dimension from the two moderation queues above. "active"
  // is both the explicit tab value and the default (no status param) —
  // see getAdminProducts' own note on why bare /admin/products no longer
  // means "show literally everything."
  const lifecycleStatus = LIFECYCLE_TABS.find((t) => t.value === status)?.value;
  const effectiveStatus = needsReview
    ? "needs_review"
    : marketplaceReview
      ? "marketplace_review"
      : (lifecycleStatus ?? "active");

  const [products, initialBusiness, categories] = await Promise.all([
    getAdminProducts({ q, businessId: business, status: effectiveStatus }),
    getBusinessOptionById(business ?? null),
    getAllCategories("product"),
  ]);

  const barView: "active" | "paused" | "archived" | "trashed" | "other" =
    effectiveStatus === "active" || effectiveStatus === "paused" || effectiveStatus === "archived" || effectiveStatus === "trashed"
      ? effectiveStatus
      : "other";

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Products</h1>
        <Link
          href="/admin/products/new"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
        >
          Add Product
        </Link>
      </div>

      {result && (
        <p className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-2.5 text-sm text-ink/80">{result}</p>
      )}

      {/* Admin Content Lifecycle V1 — the four lifecycle views. Reset to
          "active" (no status param) via the plain /admin/products link;
          each tab preserves the current search/business filters. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {LIFECYCLE_TABS.map((tab) => {
          const active = (lifecycleStatus ?? "active") === tab.value && !needsReview && !marketplaceReview;
          const params = new URLSearchParams();
          if (tab.value !== "active") params.set("status", tab.value);
          if (q) params.set("q", q);
          if (business) params.set("business", business);
          const href = `/admin/products${params.toString() ? `?${params.toString()}` : ""}`;
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
        <span className="mx-1 text-black/15">|</span>
        {/* Product Moderation pass — Product Reviews entry point, same
            querystring-filter-on-the-existing-list shape as admin/businesses'
            own Pending Review filter. */}
        <Link
          href="/admin/products?status=needs_review"
          className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${
            needsReview ? "bg-amber-400 text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
          }`}
        >
          Needs Review
        </Link>
        {/* Product Marketplace Distribution pass — Marketplace Review is a
            separate queue (marketplace_status='submitted'), never merged
            with Needs Review's content-moderation queue above. */}
        <Link
          href="/admin/products?status=marketplace_review"
          className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${
            marketplaceReview ? "bg-sky-500 text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
          }`}
        >
          Marketplace Review
        </Link>
      </div>

      <form method="get" className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        {needsReview && <input type="hidden" name="status" value="needs_review" />}
        {marketplaceReview && <input type="hidden" name="status" value="marketplace_review" />}
        {!needsReview && !marketplaceReview && lifecycleStatus && lifecycleStatus !== "active" && (
          <input type="hidden" name="status" value={lifecycleStatus} />
        )}
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by product name or slug…"
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
        <button
          type="submit"
          className="w-full rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-black/[0.03] sm:w-auto"
        >
          Filter
        </button>
      </form>

      <div className="mt-4">
        <ProductBulkListClient products={products} view={barView} categories={categories} />
      </div>
    </div>
  );
}
