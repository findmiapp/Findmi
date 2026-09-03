import type { Metadata } from "next";
import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import Section, { HorizontalScroller } from "@/components/Section";
import { getFeaturedProducts, getHomeCategories, getMarketplaceProducts, getProductCategoryTree, searchBusinesses } from "@/lib/data";
import { groupByBusinessCategory } from "@/lib/curation";

export const metadata: Metadata = {
  title: "Marketplace",
  description: "Shop real products from FindMi businesses — coffee, flowers, goods, and more.",
};
export const revalidate = 60;

// Shared pill styling for the primary/secondary category browse rows —
// same active/inactive convention as EventBusinessRoster.tsx's category
// filter pills, reused here rather than inventing new UI language.
const PILL_BASE = "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition";
const PILL_ACTIVE = "bg-findmi text-white";
const PILL_INACTIVE = "border border-black/10 text-ink/60 hover:border-black/20";
const PILL_ROW = "flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { q, category } = await searchParams;
  const filtering = Boolean(q || category);

  const [bizCategories, tree, featured, results, businesses] = await Promise.all([
    getHomeCategories(),
    getProductCategoryTree(),
    filtering ? Promise.resolve([]) : getFeaturedProducts(10),
    filtering ? getMarketplaceProducts({ q, categorySlug: category, limit: 40 }) : getMarketplaceProducts({ limit: 60 }),
    filtering ? Promise.resolve([]) : searchBusinesses({}),
  ]);

  const businessCategoryIds = new Map<string, Set<string>>();
  for (const b of businesses) businessCategoryIds.set(b.id, new Set(b.categories.map((c) => c.id)));
  const categoryRows = filtering
    ? []
    : groupByBusinessCategory(results, businessCategoryIds, bizCategories, { minPerRow: 2, limitPerRow: 10 });

  // Marketplace Archive category browsing (Product Taxonomy V1 pass):
  // primary row is "All" + the 14 top-level product categories; when the
  // selected slug is a parent OR one of its children, a secondary row
  // shows "All {Parent}" + that parent's own children. Selecting a
  // parent's products includes every child (see getMarketplaceProducts);
  // selecting a child scopes to just that subcategory.
  const activeParent = tree.find((p) => p.slug === category || p.children.some((c) => c.slug === category));
  const qs = (slug?: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (slug) params.set("category", slug);
    const query = params.toString();
    return query ? `/marketplace?${query}` : "/marketplace";
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Shop FindMi</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Marketplace</h1>
      <p className="mt-2 text-ink/60">Real products from real FindMi businesses.</p>

      <form method="get" className="mt-6 flex flex-col gap-3 sm:flex-row">
        {category && <input type="hidden" name="category" value={category} />}
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search products"
          className="flex-1 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-findmi px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Search
        </button>
      </form>

      {tree.length > 0 && (
        <div className="mt-4">
          <div className={PILL_ROW}>
            <Link href={qs()} className={`${PILL_BASE} ${!category ? PILL_ACTIVE : PILL_INACTIVE}`}>
              All
            </Link>
            {tree.map((parent) => (
              <Link
                key={parent.id}
                href={qs(parent.slug)}
                className={`${PILL_BASE} ${activeParent?.id === parent.id ? PILL_ACTIVE : PILL_INACTIVE}`}
              >
                {parent.name}
              </Link>
            ))}
          </div>

          {activeParent && activeParent.children.length > 0 && (
            <div className={`mt-2 ${PILL_ROW}`}>
              <Link
                href={qs(activeParent.slug)}
                className={`${PILL_BASE} ${category === activeParent.slug ? PILL_ACTIVE : PILL_INACTIVE}`}
              >
                All {activeParent.name}
              </Link>
              {activeParent.children.map((child) => (
                <Link
                  key={child.id}
                  href={qs(child.slug)}
                  className={`${PILL_BASE} ${category === child.slug ? PILL_ACTIVE : PILL_INACTIVE}`}
                >
                  {child.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

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
              {/* No viewAllHref here — cat.slug is a business-category
                  slug (groupByBusinessCategory), a different namespace
                  from the product-category slugs the ?category= param
                  now resolves against (Product Taxonomy V1 pass) above.
                  Linking it through would silently 0-result. This curated
                  row's own product cards are unaffected. */}
              <Section title={cat.name}>
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
