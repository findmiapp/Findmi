import Link from "next/link";
import NameSlugFields from "@/components/admin/NameSlugFields";
import { getAllCategories, getCategoryUsageCounts } from "@/lib/admin/queries";
import SubmitBar from "@/components/admin/SubmitBar";
import { createBusinessCategory, saveHomeCategories } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const [categories, usage] = await Promise.all([getAllCategories("business"), getCategoryUsageCounts()]);
  const sorted = [...categories].sort(
    (a, b) => (a.home_sort_order ?? 999) - (b.home_sort_order ?? 999) || a.name.localeCompare(b.name)
  );

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

      <form action={saveHomeCategories} className="mt-5 flex flex-col gap-5">
        {categories.length === 0 ? (
          <p className="text-sm text-ink/50">No categories yet — add one above.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((c) => {
              const count = usage.get(c.id) ?? { events: 0, businesses: 0, products: 0 };
              return (
                <div
                  key={c.id}
                  className="flex flex-col gap-2 rounded-xl border border-black/5 bg-white px-4 py-3"
                >
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
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name={`show_${c.id}`}
                        defaultChecked={c.show_on_home}
                        className="h-5 w-5 shrink-0 accent-findmi"
                      />
                      <span className="text-xs text-ink/60">Show on homepage</span>
                    </label>
                    <span className="text-xs text-ink/40">
                      {count.businesses} business{count.businesses === 1 ? "" : "es"}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-xs text-ink/45">Order</span>
                      <input
                        type="number"
                        name={`order_${c.id}`}
                        defaultValue={c.home_sort_order ?? ""}
                        className="w-16 rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm text-ink focus:border-ink/30 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <SubmitBar cancelHref="/admin" />
      </form>
    </div>
  );
}
