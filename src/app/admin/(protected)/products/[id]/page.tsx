import { notFound } from "next/navigation";
import { getAdminProductById, getBusinessSelectOptions } from "@/lib/admin/queries";
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
  const [product, businessOptions] = await Promise.all([
    getAdminProductById(id),
    getBusinessSelectOptions(),
  ]);
  if (!product) notFound();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Product</h1>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      <div className="mt-5">
        <ProductForm product={product} businessOptions={businessOptions} error={error} />
      </div>
    </div>
  );
}
