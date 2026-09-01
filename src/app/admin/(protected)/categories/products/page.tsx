import Link from "next/link";
import NameSlugFields from "@/components/admin/NameSlugFields";
import SubmitBar from "@/components/admin/SubmitBar";
import { getAllCategories, getCategoryUsageCounts } from "@/lib/admin/queries";
import { createCategory, saveProductCategories } from "./actions";

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

      <form action={saveProductCategories} className="mt-6 flex flex-col gap-5">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/40">All Categories</p>
        {sorted.length === 0 ? (
          <p className="text-sm text-ink/45">No categories yet — add one above.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((c) => {
              const count = usage.get(c.id) ?? { events: 0, businesses: 0, products: 0 };
              return (
                <div key={c.id} className="flex flex-col gap-2 rounded-xl border border-black/5 bg-white px-4 py-3">
                  <input type="hidden" name="all_category_ids" value={c.id} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      name={`name_${c.id}`}
                      defaultValue={c.name}
                      aria-label={`Name for ${c.name}`}
                      className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm text-ink focus:border-ink/30 focus:outline-none"
                    />
                    <input
                      type="text"
                      name={`slug_${c.id}`}
                      defaultValue={c.slug}
                      aria-label={`Slug for ${c.name}`}
                      className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm text-ink/70 focus:border-ink/30 focus:outline-none"
                    />
                  </div>
                  <span className="text-xs text-ink/45">
                    {count.products} product{count.products === 1 ? "" : "s"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <SubmitBar cancelHref="/admin/categories" />
      </form>
    </div>
  );
}
