import { getAllCategories } from "@/lib/admin/queries";
import BusinessForm from "../BusinessForm";

export const dynamic = "force-dynamic";

export default async function NewBusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const categories = await getAllCategories();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Business</h1>
      <div className="mt-5">
        <BusinessForm
          business={null}
          categories={categories}
          selectedCategoryIds={[]}
          galleryImages={[]}
          error={error}
        />
      </div>
    </div>
  );
}
