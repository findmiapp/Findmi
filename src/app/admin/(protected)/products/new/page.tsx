import { getAllCategories, getBusinessOptionById } from "@/lib/admin/queries";
import ProductForm from "../ProductForm";

export const dynamic = "force-dynamic";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; business?: string }>;
}) {
  const { error, business } = await searchParams;
  // Product Management Completion pass — supports the admin Business
  // detail page's "Add Product" link (?business=<id>), reusing the same
  // RelationField `initial` pre-fill already used by the admin products
  // list filter. Still just a starting point — RelationField lets the
  // admin change it before saving, same as any other product.
  const [categories, initialBusiness] = await Promise.all([
    getAllCategories("product"),
    getBusinessOptionById(business ?? null),
  ]);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Product</h1>
      <div className="mt-5">
        <ProductForm
          product={null}
          initialBusiness={initialBusiness}
          fulfillmentOptions={[]}
          appearanceOptions={[]}
          categories={categories}
          selectedCategoryIds={[]}
          error={error}
        />
      </div>
    </div>
  );
}
