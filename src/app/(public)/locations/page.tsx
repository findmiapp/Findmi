import type { Metadata } from "next";
import Link from "next/link";
import ActiveFilterChips, { type ActiveFilterChip } from "@/components/discover/ActiveFilterChips";
import AreaPicker from "@/components/discover/AreaPicker";
import ArchiveSearchField from "@/components/discover/ArchiveSearchField";
import CategorySelect from "@/components/discover/CategorySelect";
import LocationDiscoveryCard from "@/components/discover/LocationDiscoveryCard";
import { getConsumerVisibleMarketsWithAreas, getLocationCategories, getLocations, getMarketAreaLabel } from "@/lib/data";

export const metadata: Metadata = {
  title: "Locations",
  description: "Discover places on Findmi and see what's happening there.",
};
export const revalidate = 60;

// Same fixed result count the page always fetched (no load-more control
// existed before this pass and none is added now).
const RESULT_LIMIT = 50;

interface Params {
  q?: string;
  category?: string;
  market?: string;
  area?: string;
}

export default async function LocationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;

  const [categories, markets, locations] = await Promise.all([
    getLocationCategories(),
    getConsumerVisibleMarketsWithAreas(),
    getLocations({
      q: params.q,
      categorySlug: params.category,
      marketSlug: params.market,
      areaSlug: params.market ? params.area : undefined,
      limit: RESULT_LIMIT,
    }),
  ]);

  const categoryName = categories.find((c) => c.slug === params.category)?.name;
  const selectedMarket = markets.find((m) => m.slug === params.market);
  const selectedArea = params.market ? selectedMarket?.areas.find((a) => a.slug === params.area) : undefined;
  const marketAreaLabel = selectedArea
    ? `${selectedArea.display_name || selectedArea.name} — ${selectedMarket ? getMarketAreaLabel(selectedMarket) : ""}`
    : selectedMarket
      ? getMarketAreaLabel(selectedMarket)
      : undefined;

  const baseParams = new URLSearchParams();
  if (params.q) baseParams.set("q", params.q);
  if (params.category) baseParams.set("category", params.category);
  if (params.market) baseParams.set("market", params.market);
  if (params.market && params.area) baseParams.set("area", params.area);

  const withoutParam = (key: string) => {
    const p = new URLSearchParams(baseParams);
    p.delete(key);
    if (key === "market") p.delete("area");
    return `/locations${p.toString() ? `?${p.toString()}` : ""}`;
  };

  // Locations Discovery V4 — no chip for `q`: the term is already visible
  // in the search field itself, same fix already applied to /businesses
  // and /events.
  const chips: ActiveFilterChip[] = [];
  if (params.market) chips.push({ label: marketAreaLabel ?? params.market, href: withoutParam("market") });
  if (params.category) chips.push({ label: categoryName ?? params.category, href: withoutParam("category") });

  const filtering = chips.length > 0 || Boolean(params.q);

  const emptyLabel =
    params.q || params.category || params.market
      ? `No locations matched${marketAreaLabel ? ` in ${marketAreaLabel}` : params.market ? ` in that area` : ""}${categoryName ? ` ${categoryName}` : ""}${params.q ? ` for "${params.q}"` : ""}.`
      : "No locations yet — check back soon.";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Locations</h1>
      {/* Locations Discovery V4, item 1 — the old subtitle ("Recurring
          markets and venues — see who's showing up next.") described an
          earlier, narrower version of the Location model (Locations now
          include cafés, restaurants, shops, and other everyday places,
          not just recurring markets/venues). Same mobile compression as
          Businesses/Events V4: hidden on mobile, kept on desktop. */}
      <p className="mt-1.5 hidden text-sm text-ink/60 sm:block sm:text-base">
        Discover places and see what&rsquo;s happening there.
      </p>

      <form method="get" className="mt-4 flex flex-col gap-3">
        <ArchiveSearchField defaultValue={params.q} placeholder="Search locations" />

        <div className="flex flex-wrap items-center gap-2.5">
          <AreaPicker
            options={markets.map((m) => ({
              slug: m.slug,
              label: getMarketAreaLabel(m),
              areasIncluded: m.areas_included,
              areas: m.areas.map((a) => ({ slug: a.slug, label: a.display_name || a.name, aliases: a.aliases })),
            }))}
          />
          {categories.length > 0 && (
            <CategorySelect options={categories.map((c) => ({ value: c.slug, label: c.name }))} allLabel="All Categories" />
          )}
        </div>
        {chips.length > 0 && <ActiveFilterChips chips={chips} clearHref="/locations" />}
      </form>

      <p className="mt-3 text-xs font-medium text-ink/45">
        {locations.length} location{locations.length === 1 ? "" : "s"}
      </p>

      {locations.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-black/5 bg-black/[0.015] p-6 text-center">
          <p className="text-sm text-ink/60">{emptyLabel}</p>
          {filtering && (
            <Link href="/locations" className="mt-2 inline-block text-sm font-semibold text-findmi-700 underline underline-offset-2">
              Clear filters
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((l, i) => (
            <LocationDiscoveryCard
              key={l.id}
              location={l}
              analyticsContext={{ pageType: "locations", placement: "results_grid", position: i + 1 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
