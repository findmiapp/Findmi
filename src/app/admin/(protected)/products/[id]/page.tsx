import { notFound } from "next/navigation";
import {
  getAdminProductById,
  getAllCategories,
  getBusinessOptionById,
  getProductCategoryIds,
  getProductFulfillmentOptions,
  getUpcomingAppearanceOptionsForBusiness,
} from "@/lib/admin/queries";
import ViewPublicPageLink from "@/components/admin/ViewPublicPageLink";
import ProductForm from "../ProductForm";

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const product = await getAdminProductById(id);
  if (!product) notFound();
  const [initialBusiness, fulfillmentOptions, appearanceOptions, categories, selectedCategoryIds] = await Promise.all([
    getBusinessOptionById(product.business_id),
    getProductFulfillmentOptions(product.id),
    getUpcomingAppearanceOptionsForBusiness(product.business_id),
    getAllCategories("product"),
    getProductCategoryIds(product.id),
  ]);
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
