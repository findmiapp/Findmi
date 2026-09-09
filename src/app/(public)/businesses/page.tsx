import type { Metadata } from "next";
import Link from "next/link";
import BusinessLogoCard from "@/components/BusinessLogoCard";
import ActiveFilterChips, { type ActiveFilterChip } from "@/components/discover/ActiveFilterChips";
import AreaPicker from "@/components/discover/AreaPicker";
import ArchiveSearchField from "@/components/discover/ArchiveSearchField";
import BusinessFilters from "@/components/discover/BusinessFilters";
import FilterSheet from "@/components/discover/FilterSheet";
import SortSelect from "@/components/discover/SortSelect";
import Section, { HorizontalScroller } from "@/components/Section";
import {
  getCategories,
  getCategoriesForDynamicBusinessRow,
  getConsumerVisibleMarketsWithAreas,
  getHomeCategories,
  getMarketAreaLabel,
  getNextAppearanceHints,
  searchBusinesses,
  type BusinessSort,
  type NextAppearanceHint,
} from "@/lib/data";
import type { BusinessWithCategories, Category } from "@/lib/types";

export const metadata: Metadata = {
  title: "Businesses",
  description: "Search and browse businesses and vendors on Findmi.",
};
export const revalidate = 60;

const PAGE_SIZE = 24;
const SORT_OPTIONS: { value: BusinessSort; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "newest", label: "Newest" },
  { value: "az", label: "A–Z" },
];
// Browse Mode rail sizes — bounded per-rail query counts (Section 11 of
// the Browse Mode pass): a rail is a discovery preview, not the full
// filtered grid, so it never needs Results Mode's PAGE_SIZE/Load More.
const FEATURED_RAIL_LIMIT = 12;
const CATEGORY_RAIL_LIMIT = 10;

interface Params {
  q?: string;
  category?: string;
  location?: string;
  /** Business Directory Market Filtering V1 — a FindMi Market slug
   * (never "Region"), completely independent of `location` (Based In
   * free-text) above. Absent = "All Areas" = current unfiltered
   * behavior, unchanged. Shown to consumers as "Area" (Market Management
   * + Plan Market Allowances V1) — the `market` param name is unchanged. */
  market?: string;
  /** Market -> Area/Submarket Hierarchy V2 — a structured Area slug
   * scoped WITHIN `market` (never meaningful alone). Absent = the whole
   * Market (unchanged V1 behavior). */
  area?: string;
  featured?: string;
  founding?: string;
  sort?: string;
  limit?: string;
}

/** Business Directory Browse Mode + Area-Aware Discovery Composition —
 * /businesses now has two intentional modes. BROWSE MODE (this
 * function's other branch below) is the default landing experience when
 * the consumer hasn't actually narrowed the directory down yet: curated
 * discovery rails (Featured on Findmi + category rails), Market/Area
 * scoped. RESULTS MODE is the pre-existing filtered grid, triggered by
 * any real filter (search, category, Based In, Featured, Founding
 * Member, a non-default sort) — completely unchanged below, including
 * its controls → chips → count → grid → Load More order.
 *
 * Market/Area are deliberately EXCLUDED from "is filtering" — a
 * consumer must be able to browse within their selected Area without
 * being dropped into the flat grid; see isBrowseMode below. */
export default async function BusinessesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const sort: BusinessSort = SORT_OPTIONS.some((o) => o.value === params.sort) ? (params.sort as BusinessSort) : "recommended";
  const limit = Math.min(Math.max(Number(params.limit) || PAGE_SIZE, PAGE_SIZE), 240);
  const featured = params.featured === "1";
  const founding = params.founding === "1";
  const marketSlug = params.market;
  const areaSlug = params.market ? params.area : undefined;

  const isBrowseMode = !params.q && !params.category && !params.location && !featured && !founding && sort === "recommended";

  const [categories, markets] = await Promise.all([getCategories(), getConsumerVisibleMarketsWithAreas()]);

  // Results Mode data — only fetched when actually needed, so a Browse
  // Mode visit never pays for the flat-grid query it won't render.
  let fetched: BusinessWithCategories[] = [];
  let hasMore = false;
  let businesses: BusinessWithCategories[] = [];
  let appearanceHints = new Map<string, NextAppearanceHint>();
  if (!isBrowseMode) {
    fetched = await searchBusinesses({
      q: params.q,
      categorySlug: params.category,
      location: params.location,
      marketSlug,
      areaSlug,
      featuredOnly: featured,
      foundingMemberOnly: founding,
      sort,
      limit: limit + 1, // one extra row to detect "more available" without a separate count query
    });
    hasMore = fetched.length > limit;
    businesses = fetched.slice(0, limit);
    appearanceHints = await getNextAppearanceHints(businesses.map((b) => b.id));
  }

  // Browse Mode data — Featured on Findmi (reusing the exact Active
  // Featured Business Promotional Eligibility rule, never a plain
  // featuredOnly filter) + category rails (publicly-eligible-only,
  // Market+Area aware, bounded to categories the founder already curates
  // for home visibility AND that actually have an eligible business in
  // the selected geography — never a giant taxonomy wall).
  let featuredBusinesses: BusinessWithCategories[] = [];
  let categoryRails: { category: Category; businesses: BusinessWithCategories[] }[] = [];
  let browseAppearanceHints = new Map<string, NextAppearanceHint>();
  if (isBrowseMode) {
    const [featuredResult, eligibleCategories, homeCategories] = await Promise.all([
      searchBusinesses({
        featuredOnly: true,
        promotionallyEligibleOnly: true,
        marketSlug,
        areaSlug,
        sort: "recommended",
        limit: FEATURED_RAIL_LIMIT,
      }),
      getCategoriesForDynamicBusinessRow(false, marketSlug, areaSlug),
      getHomeCategories(),
    ]);
    featuredBusinesses = featuredResult;
    const eligibleSlugs = new Set(eligibleCategories.map((c) => c.slug));
    const railCategories = homeCategories.filter((c) => eligibleSlugs.has(c.slug));
    const rails = await Promise.all(
      railCategories.map(async (category) => ({
        category,
        businesses: await searchBusinesses({
          categorySlug: category.slug,
          marketSlug,
          areaSlug,
          sort: "recommended",
          limit: CATEGORY_RAIL_LIMIT,
        }),
      }))
    );
    categoryRails = rails.filter((r) => r.businesses.length > 0);
    const browseIds = [...featuredBusinesses, ...categoryRails.flatMap((r) => r.businesses)].map((b) => b.id);
    browseAppearanceHints = await getNextAppearanceHints(browseIds);
  }

  // Every filter round-trips through real URL search params (Discovery/
  // Archive V2 Part 4) — nothing here is client-only state that vanishes
  // on refresh. Building chip/clear/load-more URLs from the same params
  // object keeps them all consistent with what was actually submitted.
  const baseParams = new URLSearchParams();
  if (params.q) baseParams.set("q", params.q);
  if (params.category) baseParams.set("category", params.category);
  if (params.location) baseParams.set("location", params.location);
  if (params.market) baseParams.set("market", params.market);
  if (params.market && params.area) baseParams.set("area", params.area);
  if (featured) baseParams.set("featured", "1");
  if (founding) baseParams.set("founding", "1");
  if (sort !== "recommended") baseParams.set("sort", sort);

  const categoryName = categories.find((c) => c.slug === params.category)?.name;
  const selectedMarket = markets.find((m) => m.slug === params.market);
  const selectedArea = params.market ? selectedMarket?.areas.find((a) => a.slug === params.area) : undefined;
  const marketAreaLabel = selectedArea
    ? `${selectedArea.display_name || selectedArea.name} — ${selectedMarket ? getMarketAreaLabel(selectedMarket) : ""}`
    : selectedMarket
      ? getMarketAreaLabel(selectedMarket)
      : undefined;
  const chips: ActiveFilterChip[] = [];
  const withoutParam = (key: string) => {
    const p = new URLSearchParams(baseParams);
    p.delete(key);
    if (key === "market") p.delete("area");
    return `/businesses${p.toString() ? `?${p.toString()}` : ""}`;
  };
  if (params.q) chips.push({ label: `"${params.q}"`, href: withoutParam("q") });
  if (params.market) chips.push({ label: marketAreaLabel ?? params.market, href: withoutParam("market") });
  if (params.category) chips.push({ label: categoryName ?? params.category, href: withoutParam("category") });
  if (params.location) chips.push({ label: params.location, href: withoutParam("location") });
  if (featured) chips.push({ label: "Featured", href: withoutParam("featured") });
  if (founding) chips.push({ label: "Founding Member", href: withoutParam("founding") });

  // Only the fields that actually live inside the Filters sheet count
  // toward its own badge — search has its own always-visible field.
  const sheetFilterCount = [params.category, params.location, featured, founding].filter(Boolean).length;

  const loadMoreHref = (() => {
    const p = new URLSearchParams(baseParams);
    p.set("limit", String(limit + PAGE_SIZE));
    return `/businesses?${p.toString()}`;
  })();

  const activeCount = chips.length;
  const filtering = activeCount > 0;

  return (
    <div className="py-8 sm:py-10">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Businesses</h1>
        <p className="mt-1.5 text-sm text-ink/60 sm:text-base">
          Search Findmi&rsquo;s directory of local vendors and brands.
        </p>

        <form method="get" className="mt-5 flex flex-col gap-3">
          <ArchiveSearchField defaultValue={params.q} placeholder="Search by name or description" />
          <div className="flex flex-wrap items-center gap-2.5">
            <AreaPicker
              options={markets.map((m) => ({
                slug: m.slug,
                label: getMarketAreaLabel(m),
                areasIncluded: m.areas_included,
                areas: m.areas.map((a) => ({ slug: a.slug, label: a.display_name || a.name, aliases: a.aliases })),
              }))}
            />
            <FilterSheet activeCount={sheetFilterCount}>
              <BusinessFilters
                categories={categories}
                defaultCategory={params.category}
                defaultLocation={params.location}
                defaultFeatured={featured}
                defaultFounding={founding}
              />
            </FilterSheet>
            <SortSelect options={SORT_OPTIONS} />
          </div>
          {chips.length > 0 && <ActiveFilterChips chips={chips} clearHref="/businesses" />}
        </form>
      </div>

      {isBrowseMode ? (
        <div className="mx-auto mt-3 max-w-6xl">
          {featuredBusinesses.length === 0 && categoryRails.length === 0 ? (
            <div className="mx-4 mt-6 rounded-2xl border border-black/5 bg-black/[0.015] p-6 text-center sm:mx-6">
              <p className="text-sm text-ink/60">
                No businesses yet{marketAreaLabel ? ` in ${marketAreaLabel}` : ""} — check back soon.
              </p>
            </div>
          ) : (
            <>
              {/* Business Directory Visual Rhythm pass — compact category
                  chip strip, same bounded category set the rails below
                  already resolved (never the full taxonomy, never a
                  second query). Preserves market/area via the same
                  buildBusinessesHref helper the rail View All links use;
                  picking one always lands in the existing Results Mode —
                  no new filtering logic. "All" just re-lands on this same
                  Browse Mode view (market/area only, no category). */}
              {categoryRails.length > 0 && (
                <div className="flex gap-2 overflow-x-auto px-4 pb-1 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <Link
                    href={buildBusinessesHref({ market: marketSlug, area: areaSlug })}
                    className="shrink-0 whitespace-nowrap rounded-full border border-findmi/30 bg-findmi-50 px-3.5 py-1.5 text-xs font-semibold text-findmi-700"
                  >
                    All
                  </Link>
                  {categoryRails.map(({ category }) => (
                    <Link
                      key={category.id}
                      href={buildBusinessesHref({ category: category.slug, market: marketSlug, area: areaSlug })}
                      className="shrink-0 whitespace-nowrap rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-semibold text-ink transition hover:border-findmi/40 hover:bg-findmi-50 hover:text-findmi-700"
                    >
                      {category.name}
                    </Link>
                  ))}
                </div>
              )}

              {featuredBusinesses.length > 0 && (
                // Featured on Findmi — the active promotional subset (see
                // FEATURED_RAIL_LIMIT's own note above), not the plain
                // editorial is_featured flag /businesses?featured=1 shows.
                // No View All: that destination is editorial-only (every
                // is_featured business regardless of schedule), a
                // different set than this rail — see Section 4 of this
                // pass's own spec. Rather than imply they're the same
                // list, or change /businesses?featured=1's own meaning,
                // this rail simply has no View All link.
                <Section title="Featured on Findmi" subtitle="Businesses Findmi is spotlighting right now" className="py-4">
                  <HorizontalScroller>
                    {featuredBusinesses.map((b) => (
                      <div key={b.id} className="w-[80vw] max-w-sm shrink-0 sm:w-96">
                        <BusinessLogoCard business={b} nextAppearance={browseAppearanceHints.get(b.id)} />
                      </div>
                    ))}
                  </HorizontalScroller>
                </Section>
              )}

              {categoryRails.map(({ category, businesses: categoryBusinesses }) => (
                <Section
                  key={category.id}
                  title={category.name}
                  viewAllHref={buildBusinessesHref({ category: category.slug, market: marketSlug, area: areaSlug })}
                  className="py-4"
                >
                  <HorizontalScroller>
                    {categoryBusinesses.map((b) => (
                      <div key={b.id} className="w-[80vw] max-w-sm shrink-0 sm:w-96">
                        <BusinessLogoCard business={b} nextAppearance={browseAppearanceHints.get(b.id)} />
                      </div>
                    ))}
                  </HorizontalScroller>
                </Section>
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="mt-5 text-sm text-ink/50">
            {businesses.length === 0 && !hasMore ? 0 : `${businesses.length}${hasMore ? "+" : ""}`} business
            {businesses.length === 1 && !hasMore ? "" : "es"}
          </p>

          {businesses.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-black/5 bg-black/[0.015] p-6 text-center">
              <p className="text-sm text-ink/60">
                {filtering
                  ? `No businesses matched${categoryName ? ` ${categoryName}` : ""}${marketAreaLabel ? ` in ${marketAreaLabel}` : params.market ? ` in that area` : ""}${params.location ? ` in ${params.location}` : ""}.`
                  : "No businesses yet — check back soon."}
              </p>
              {filtering && (
                <Link href="/businesses" className="mt-2 inline-block text-sm font-semibold text-findmi-700 underline underline-offset-2">
                  Clear filters
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {businesses.map((b) => (
                  <BusinessLogoCard key={b.id} business={b} nextAppearance={appearanceHints.get(b.id)} />
                ))}
              </div>
              {hasMore && (
                <div className="mt-6 flex justify-center">
                  <Link
                    href={loadMoreHref}
                    className="flex h-11 items-center justify-center rounded-full border border-black/10 px-6 text-sm font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
                  >
                    Load More
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Category rail View All destination — preserves Market+Area+category
 * via the exact same /businesses?market=...&area=...&category=...
 * convention Results Mode's own chips/filters already use, landing the
 * consumer in Results Mode for that scope. */
function buildBusinessesHref(params: { category?: string; market?: string; area?: string }): string {
  const p = new URLSearchParams();
  if (params.category) p.set("category", params.category);
  if (params.market) p.set("market", params.market);
  if (params.market && params.area) p.set("area", params.area);
  return `/businesses${p.toString() ? `?${p.toString()}` : ""}`;
}
