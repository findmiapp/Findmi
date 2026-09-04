import Link from "next/link";
import { getAdminProducts, getBusinessOptionById } from "@/lib/admin/queries";
import { RelationField } from "@/components/admin/RelationPicker";
import { formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; business?: string; status?: string }>;
}) {
  const { q, business, status } = await searchParams;
  const needsReview = status === "needs_review";
  // Product Marketplace Distribution pass — a SEPARATE filter/queue from
  // Needs Review above: content approval and Marketplace approval stay
  // two independent decisions, never combined into one filter.
  const marketplaceReview = status === "marketplace_review";
  const [products, initialBusiness] = await Promise.all([
    getAdminProducts({
      q,
      businessId: business,
      status: needsReview ? "needs_review" : marketplaceReview ? "marketplace_review" : undefined,
    }),
    getBusinessOptionById(business ?? null),
  ]);

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

      {/* Product Moderation pass — Product Reviews entry point, same
          querystring-filter-on-the-existing-list shape as admin/businesses'
          own Pending Review filter. */}
      <div className="mt-3 flex items-center gap-2">
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
        {(needsReview || marketplaceReview) && (
          <Link href="/admin/products" className="text-xs font-semibold text-ink/50 hover:text-ink">
            Clear filter
          </Link>
        )}
      </div>

      <form method="get" className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        {needsReview && <input type="hidden" name="status" value="needs_review" />}
        {marketplaceReview && <input type="hidden" name="status" value="marketplace_review" />}
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

      <div className="mt-4 flex flex-col gap-2">
        {products.length === 0 ? (
          <p className="text-sm text-ink/50">No products yet.</p>
        ) : (
          products.map((p) => {
            // Product Moderation pass — same priority order as the owner
            // manager's own badge (account/business/[id]/page.tsx):
            // never-approved/rejected content outranks the plain
            // Active/Inactive distinction, since it's the thing that
            // needs a founder decision.
            const moderationStatus = p.moderation_status ?? "live";
            const badgeLabel =
              moderationStatus === "pending_review"
                ? "Pending Review"
                : moderationStatus === "rejected"
                  ? "Rejected"
                  : p.pending_changes
                    ? "Changes Pending"
                    : p.is_active
                      ? "Active"
                      : "Inactive";
            const badgeClass =
              moderationStatus === "pending_review" || p.pending_changes
                ? "bg-amber-100 text-amber-800"
                : moderationStatus === "rejected"
                  ? "bg-red-50 text-red-700"
                  : p.is_active
                    ? "bg-findmi-50 text-findmi-700"
                    : "bg-black/[0.06] text-ink/50";

            // Product Marketplace Distribution pass — a SEPARATE badge,
            // only shown once the owner has actually requested/received a
            // Marketplace decision (catalog_only is the common case and
            // stays unbadged here, same as content moderation's own
            // "nothing to flag" rows). Never merged with badgeLabel/
            // badgeClass above.
            const marketplaceStatus = p.marketplace_status ?? "catalog_only";
            const marketplaceBadge =
              marketplaceStatus === "submitted"
                ? { label: "Marketplace Pending", className: "bg-sky-100 text-sky-800" }
                : marketplaceStatus === "approved"
                  ? { label: "Marketplace Approved", className: "bg-sky-50 text-sky-700" }
                  : marketplaceStatus === "paused"
                    ? { label: "Marketplace Paused", className: "bg-black/[0.06] text-ink/50" }
                    : marketplaceStatus === "rejected"
                      ? { label: "Marketplace Rejected", className: "bg-red-50 text-red-700" }
                      : null;

            return (
              <Link
                key={p.id}
                href={`/admin/products/${p.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                  <p className="truncate text-xs text-ink/45">
                    {p.business?.name ?? "—"}
                    {formatPrice(p.price, p.price_label) ? ` · ${formatPrice(p.price, p.price_label)}` : ""}
                  </p>
                </div>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${badgeClass}`}>
                    {badgeLabel}
                  </span>
                  {marketplaceBadge && (
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${marketplaceBadge.className}`}>
                      {marketplaceBadge.label}
                    </span>
                  )}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
