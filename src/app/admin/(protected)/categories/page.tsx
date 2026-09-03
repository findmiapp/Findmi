import Link from "next/link";
import NameSlugFields from "@/components/admin/NameSlugFields";
import CategoryList from "@/components/admin/CategoryList";
import { getAllCategories, getCategoryUsageCounts } from "@/lib/admin/queries";
import { createBusinessCategory, deleteBusinessCategory, moveBusinessCategory, saveHomeCategories } from "./actions";

export const dynamic = "force-dynamic";

// Same legacy-onboarding-filter set BusinessForm.tsx and
// account/business/[id]/page.tsx already each keep their own copy of —
// still checked/hidden from NEW selection there, unchanged by this pass.
// This is only a third, admin-list-only read of the same two slugs, to
// label their existing state here rather than reactivating/changing it.
const LEGACY_BUSINESS_CATEGORY_SLUGS = new Set(["markets-pop-ups", "packaged-goods"]);

export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const [categories, usage] = await Promise.all([getAllCategories("business"), getCategoryUsageCounts()]);

  // "Other" always sorts last, full stop — regardless of home_sort_order
  // (previously, the home_sort_order sort below ran over the WHOLE list,
  // which could pull "Other" out of last place if it ever had an
  // explicit order number lower than 999). getAllCategories() already
  // applies this same rule when no home_sort_order is in play; this only
  // makes it hold up once ordering enters the picture too.
  const other = categories.filter((c) => c.name === "Other");
  const rest = [...categories.filter((c) => c.name !== "Other")].sort(
    (a, b) => (a.home_sort_order ?? 999) - (b.home_sort_order ?? 999) || a.name.localeCompare(b.name)
  );
  const sorted = [...rest, ...other];

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
        Business Categories
      </h1>
      <p className="mt-1 text-sm text-ink/60">
        Tagged onto business profiles and used to filter Discover/Businesses. Choose which ones
        appear in the homepage&rsquo;s scrollable filter row, and in what order.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Link
          href="/admin/categories/events"
          className="flex flex-1 items-center justify-between rounded-2xl border border-findmi/30 bg-findmi-50 px-4 py-3.5 transition hover:border-findmi/50"
        >
          <span>
            <span className="block text-sm font-semibold text-findmi-700">Event Categories</span>
            <span className="block text-xs text-ink/50">Tagged onto events.</span>
          </span>
          <span className="shrink-0 text-findmi-700">→</span>
        </Link>
        <Link
          href="/admin/categories/products"
          className="flex flex-1 items-center justify-between rounded-2xl border border-findmi/30 bg-findmi-50 px-4 py-3.5 transition hover:border-findmi/50"
        >
          <span>
            <span className="block text-sm font-semibold text-findmi-700">Product Categories</span>
            <span className="block text-xs text-ink/50">Tagged onto products.</span>
          </span>
          <span className="shrink-0 text-findmi-700">→</span>
        </Link>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-dashed border-black/15 bg-black/[0.015] p-4">
        <p className="text-sm font-semibold text-ink">Add Category</p>
        <form action={createBusinessCategory} className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <NameSlugFields isNew slugHint="Used in filter URLs — auto-generated from the name." />
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
        kind="business"
        categories={sorted}
        usage={usage}
        saveAction={saveHomeCategories}
        deleteAction={deleteBusinessCategory}
        moveAction={moveBusinessCategory}
        legacySlugs={LEGACY_BUSINESS_CATEGORY_SLUGS}
        cancelHref="/admin"
      />
    </div>
  );
}
