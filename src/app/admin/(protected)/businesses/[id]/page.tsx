import { notFound } from "next/navigation";
import { getAdminBusinessById, getAllCategories } from "@/lib/admin/queries";
import BusinessForm from "../BusinessForm";

export const dynamic = "force-dynamic";

export default async function EditBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const [result, categories] = await Promise.all([getAdminBusinessById(id), getAllCategories()]);
  if (!result) notFound();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
        Edit Business
      </h1>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      <div className="mt-5">
        <BusinessForm
          business={result.business}
          categories={categories}
          selectedCategoryIds={result.categoryIds}
          error={error}
        />
      </div>
    </div>
  );
}
