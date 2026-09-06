import type { Metadata } from "next";
import Link from "next/link";
import BusinessLogoCard from "@/components/BusinessLogoCard";
import ActiveFilterChips, { type ActiveFilterChip } from "@/components/discover/ActiveFilterChips";
import AreaPicker from "@/components/discover/AreaPicker";
import ArchiveSearchField from "@/components/discover/ArchiveSearchField";
import BusinessFilters from "@/components/discover/BusinessFilters";
import FilterSheet from "@/components/discover/FilterSheet";
import SortSelect from "@/components/discover/SortSelect";
import {
  getCategories,
  getConsumerVisibleMarketsWithAreas,
  getMarketAreaLabel,
  getNextAppearanceHints,
  searchBusinesses,
  type BusinessSort,
} from "@/lib/data";

export const metadata: Metadata = {
  title: "Businesses",
  description: "Search and browse businesses and vendors on FindMi.",
};
export const revalidate = 60;

const PAGE_SIZE = 24;
const SORT_OPTIONS: { value: BusinessSort; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "newest", label: "Newest" },
  { value: "az", label: "A–Z" },
];

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

export default async function BusinessesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const sort: BusinessSort = SORT_OPTIONS.some((o) => o.value === params.sort) ? (params.sort as BusinessSort) : "recommended";
  const limit = Math.min(Math.max(Number(params.limit) || PAGE_SIZE, PAGE_SIZE), 240);
  const featured = params.featured === "1";
  const founding = params.founding === "1";

  const [categories, markets, fetched] = await Promise.all([
    getCategories(),
    getConsumerVisibleMarketsWithAreas(),
    searchBusinesses({
      q: params.q,
      categorySlug: params.category,
      location: params.location,
      marketSlug: params.market,
      areaSlug: params.market ? params.area : undefined,
      featuredOnly: featured,
      foundingMemberOnly: founding,
      sort,
      limit: limit + 1, // one extra row to detect "more available" without a separate count query
    }),
  ]);
  const hasMore = fetched.length > limit;
  const businesses = fetched.slice(0, limit);
  const appearanceHints = await getNextAppearanceHints(businesses.map((b) => b.id));

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
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Businesses</h1>
      <p className="mt-1.5 text-sm text-ink/60 sm:text-base">
        Search FindMi&rsquo;s directory of local vendors and brands.
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
  );
}
