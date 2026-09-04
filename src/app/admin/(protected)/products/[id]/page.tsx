import { notFound } from "next/navigation";
import {
  getAdminProductById,
  getAllCategories,
  getBusinessOptionById,
  getProductCategoryIds,
  getProductFulfillmentOptions,
  getUpcomingAppearanceOptionsForBusiness,
} from "@/lib/admin/queries";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import ViewPublicPageLink from "@/components/admin/ViewPublicPageLink";
import ProductForm from "../ProductForm";
import ProductModerationPanel from "./ProductModerationPanel";
import MarketplaceReviewPanel from "./MarketplaceReviewPanel";

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
    approved?: string;
    rejected?: string;
    marketplace_approved?: string;
    marketplace_rejected?: string;
    marketplace_paused?: string;
  }>;
}) {
  const { id } = await params;
  const { error, saved, approved, rejected, marketplace_approved, marketplace_rejected, marketplace_paused } =
    await searchParams;
  const product = await getAdminProductById(id);
  if (!product) notFound();
  const [initialBusiness, fulfillmentOptions, appearanceOptions, categories, selectedCategoryIds] = await Promise.all([
    getBusinessOptionById(product.business_id),
    getProductFulfillmentOptions(product.id),
    getUpcomingAppearanceOptionsForBusiness(product.business_id),
    getAllCategories("product"),
    getProductCategoryIds(product.id),
  ]);

  // Product Marketplace Distribution pass — the applicable commission
  // (resolveMarketplaceFeePercent) needs the business's own
  // marketplace_fee_percent, which getBusinessOptionById doesn't select
  // (it's a generic RelationPicker option, used far beyond this one
  // panel) — fetched directly here instead of widening that shared
  // helper for one caller's need.
  const adminSupabase = getAdminSupabase();
  const { data: businessFeeRow } = adminSupabase
    ? await adminSupabase.from("businesses").select("marketplace_fee_percent").eq("id", product.business_id).maybeSingle()
    : { data: null };
  const categoryName = categories.find((c) => c.id === selectedCategoryIds[0])?.name ?? null;
  // Business demo/publication status isn't loaded here (see
  // getBusinessOptionById) — is_active is the product's own, directly
  // controllable gate and the common case; a business that's separately
  // unpublished is a rarer edge left as a future refinement.
  const publicHref = product.is_active ? `/product/${product.slug}` : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Product</h1>
        <ViewPublicPageLink href={publicHref} />
      </div>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      {approved && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Approved.
        </p>
      )}
      {rejected && (
        <p className="mt-3 rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3 text-sm text-ink/70">
          Rejected.
        </p>
      )}
      {marketplace_approved && (
        <p className="mt-3 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          Approved for Marketplace.
        </p>
      )}
      {marketplace_rejected && (
        <p className="mt-3 rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3 text-sm text-ink/70">
          Marketplace submission rejected.
        </p>
      )}
      {marketplace_paused && (
        <p className="mt-3 rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3 text-sm text-ink/70">
          Marketplace visibility paused.
        </p>
      )}

      {/* Product Moderation pass — Current/Proposed review + Approve/
          Reject, only rendered when there's actually something to
          review. Admin's own edits below (ProductForm/saveProduct) are
          completely untouched and always publish immediately — this
          panel is exclusively about OWNER-submitted content. */}
      <div className="mt-5">
        <ProductModerationPanel
          product={product}
          categories={categories}
          currentCategoryId={selectedCategoryIds[0] ?? null}
        />
      </div>

      {/* Product Marketplace Distribution pass — Marketplace Review,
          entirely separate from content moderation above: this decides
          broader Marketplace/discovery placement, never content
          approval. */}
      <div className="mt-5">
        <MarketplaceReviewPanel
          product={product}
          businessName={initialBusiness?.label ?? "—"}
          categoryName={categoryName}
          businessFeePercent={businessFeeRow?.marketplace_fee_percent ?? null}
        />
      </div>

      <div className="mt-5">
        <ProductForm
          product={product}
          initialBusiness={initialBusiness}
          fulfillmentOptions={fulfillmentOptions}
          appearanceOptions={appearanceOptions}
          categories={categories}
          selectedCategoryIds={selectedCategoryIds}
          error={error}
        />
      </div>
    </div>
  );
}
