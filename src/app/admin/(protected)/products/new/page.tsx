import { getAllCategories } from "@/lib/admin/queries";
import ProductForm from "../ProductForm";

export const dynamic = "force-dynamic";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const categories = await getAllCategories("product");

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Product</h1>
      <div className="mt-5">
        <ProductForm
          product={null}
          initialBusiness={null}
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
