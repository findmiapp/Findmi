import Link from "next/link";
import NameSlugFields from "@/components/admin/NameSlugFields";
import CategoryList from "@/components/admin/CategoryList";
import { getAllCategories, getCategoryUsageCounts } from "@/lib/admin/queries";
import { createLocationCategory, deleteLocationCategory, saveLocationCategories } from "./actions";

export const dynamic = "force-dynamic";

// Location Categories — location-kind rows in the shared `categories`
// table (Location V2 pass — the same reusable Category -> Subcategory
// taxonomy Business/Event/Product already use, distinguished by kind).
// This screen only ever shows/creates/edits kind='location' rows.
export default async function LocationCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const [categories, usage] = await Promise.all([getAllCategories("location"), getCategoryUsageCounts()]);
  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/categories" className="hover:underline">
          Categories
        </Link>
        <span>/</span>
        <span>Location Categories</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">Location Categories</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/50">
        Create categories here, then assign one as a Location&rsquo;s primary category/subcategory from
        that Location&rsquo;s own admin edit page. Location categories are their own taxonomy — separate
        from Business, Event, and Product Categories.
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
        <form action={createLocationCategory} className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <NameSlugFields isNew slugLabel="Slug" slugHint="Used in filter URLs — auto-generated from the name." />
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
        kind="location"
        categories={sorted}
        usage={usage}
        saveAction={saveLocationCategories}
        deleteAction={deleteLocationCategory}
        cancelHref="/admin/categories"
      />
    </div>
  );
}
