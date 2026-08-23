import type { Metadata } from "next";
import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import Section, { HorizontalScroller } from "@/components/Section";
import { getFeaturedProducts, getHomeCategories, getMarketplaceProducts, searchBusinesses } from "@/lib/data";
import { groupByBusinessCategory } from "@/lib/curation";

export const metadata: Metadata = {
  title: "Marketplace",
  description: "Shop real products from FindMi businesses — coffee, flowers, goods, and more.",
};
export const revalidate = 60;

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { q, category } = await searchParams;
  const filtering = Boolean(q || category);

  const [categories, featured, results, businesses] = await Promise.all([
    getHomeCategories(),
    filtering ? Promise.resolve([]) : getFeaturedProducts(10),
    filtering ? getMarketplaceProducts({ q, categorySlug: category, limit: 40 }) : getMarketplaceProducts({ limit: 60 }),
    filtering ? Promise.resolve([]) : searchBusinesses({}),
  ]);

  const businessCategoryIds = new Map<string, Set<string>>();
  for (const b of businesses) businessCategoryIds.set(b.id, new Set(b.categories.map((c) => c.id)));
  const categoryRows = filtering
    ? []
    : groupByBusinessCategory(results, businessCategoryIds, categories, { minPerRow: 2, limitPerRow: 10 });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Shop FindMi</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Marketplace</h1>
      <p className="mt-2 text-ink/60">Real products from real FindMi businesses.</p>

      <form method="get" className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search products"
          className="flex-1 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none"
        />
        <select
          name="category"
          defaultValue={category ?? ""}
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-ink focus:border-ink/30 focus:outline-none sm:w-48"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-findmi px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Search
        </button>
      </form>

      {filtering ? (
        <>
          <p className="mt-4 text-sm text-ink/50">
            {results.length} result{results.length === 1 ? "" : "s"}
          </p>
          {results.length === 0 ? (
            <p className="mt-10 text-sm text-ink/50">
              Nothing matched.{" "}
              <Link href="/marketplace" className="font-medium text-ink underline underline-offset-2">
                Clear filters
              </Link>
            </p>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {results.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {featured.length > 0 && (
            <div className="-mx-6 mt-6">
              <Section title="Featured Products">
                <HorizontalScroller>
                  {featured.map((p) => (
                    <div key={p.id} className="w-44 shrink-0">
                      <ProductCard product={p} />
                    </div>
                  ))}
                </HorizontalScroller>
              </Section>
            </div>
          )}

          {categoryRows.map(({ category: cat, items }) => (
            <div key={cat.id} className="-mx-6">
              <Section title={cat.name} viewAllHref={`/marketplace?category=${cat.slug}`}>
                <HorizontalScroller>
                  {items.map((p) => (
                    <div key={p.id} className="w-44 shrink-0">
                      <ProductCard product={p} />
                    </div>
                  ))}
                </HorizontalScroller>
              </Section>
            </div>
          ))}

          <div className="mt-8">
            <h2 className="font-display text-xl font-bold tracking-tight text-ink">All Products</h2>
            {results.length === 0 ? (
              <p className="mt-6 text-sm text-ink/50">No products yet — check back soon.</p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {results.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
