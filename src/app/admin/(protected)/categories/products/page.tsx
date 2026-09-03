import Link from "next/link";
import NameSlugFields from "@/components/admin/NameSlugFields";
import CategoryList from "@/components/admin/CategoryList";
import { getAllCategories, getCategoryUsageCounts } from "@/lib/admin/queries";
import { createCategory, deleteProductCategory, saveProductCategories } from "./actions";

export const dynamic = "force-dynamic";

// Product Categories — first-class product taxonomy (taxonomy foundation
// pass). Separate from a product's selling business's category: a product
// with its own product-category assignment shows that instead of the
// seller's business category on cards/detail pages (see lib/data.ts's
// getPrimaryCategoryByProduct).
export default async function ProductCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const [categories, usage] = await Promise.all([getAllCategories("product"), getCategoryUsageCounts()]);
  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/categories" className="hover:underline">
          Categories
        </Link>
        <span>/</span>
        <span>Product Categories</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">Product Categories</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/50">
        Create categories here, then assign them to a specific product from that product&rsquo;s own
        edit page. A product can have more than one. Separate from Business Categories and Event
        Categories — its own taxonomy.
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-dashed border-black/15 bg-black/[0.015] p-4">
        <p className="text-sm font-semibold text-ink">Add Category</p>
        <form action={createCategory} className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <NameSlugFields isNew slugLabel="Slug" slugHint="Auto-generated from the name." />
          </div>
          <button
            type="submit"
            className="shrink-0 rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
          >
            + Add Category
          </button>
        </form>
      </div>

      <CategoryList
        kind="product"
        categories={sorted}
        usage={usage}
        saveAction={saveProductCategories}
        deleteAction={deleteProductCategory}
        cancelHref="/admin/categories"
      />
    </div>
  );
}
