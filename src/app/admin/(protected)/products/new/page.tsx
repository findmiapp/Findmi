import { getBusinessSelectOptions } from "@/lib/admin/queries";
import ProductForm from "../ProductForm";

export const dynamic = "force-dynamic";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const businessOptions = await getBusinessSelectOptions();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Product</h1>
      <div className="mt-5">
        <ProductForm product={null} businessOptions={businessOptions} error={error} />
      </div>
    </div>
  );
}
