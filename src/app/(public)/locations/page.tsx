import type { Metadata } from "next";
import Link from "next/link";
import ActiveFilterChips, { type ActiveFilterChip } from "@/components/discover/ActiveFilterChips";
import AreaPicker from "@/components/discover/AreaPicker";
import ArchiveSearchField from "@/components/discover/ArchiveSearchField";
import RefineSheet, { RefineSection } from "@/components/discover/RefineSheet";
import LocationDiscoveryCard from "@/components/discover/LocationDiscoveryCard";
import { getConsumerVisibleMarketsWithAreas, getLocationCategories, getLocations, getMarketAreaLabel } from "@/lib/data";
import ArchiveGeoShell from "@/components/map/ArchiveGeoShell";
import { archiveView, archiveViewParam, placeArchive } from "@/lib/archive-params";
import { bboxParam } from "@/lib/geo-results";

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
  /** Canonical Entity Geography completion pass — see /events' own Params
   * field for the full rule. */
  geo?: string;
  /** Map Everywhere — Search This Area bounds and the presentation. */
  bbox?: string;
  view?: string;
}

export default async function LocationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  // One reading of the URL for the List and its Map (lib/archive-params).
  const options = await placeArchive(params as Record<string, string>);
  const view = archiveView(params as Record<string, string>);
  const viewParam = archiveViewParam(params as Record<string, string>);

  const [categories, markets, locations] = await Promise.all([getLocationCategories(), getConsumerVisibleMarketsWithAreas(), getLocations({ ...options, limit: RESULT_LIMIT })]);

  const categoryName = categories.find((c) => c.slug === params.category)?.name;
  const selectedMarket = markets.find((m) => m.slug === params.market);
  const selectedArea = params.market ? selectedMarket?.areas.find((a) => a.slug === params.area) : undefined;
  const marketAreaLabel = selectedArea
    ? `${selectedArea.display_name || selectedArea.name}, ${selectedMarket ? getMarketAreaLabel(selectedMarket) : ""}`
    : selectedMarket
      ? getMarketAreaLabel(selectedMarket)
      : undefined;

  const baseParams = new URLSearchParams();
  if (params.q) baseParams.set("q", params.q);
  if (params.category) baseParams.set("category", params.category);
  if (params.market) baseParams.set("market", params.market);
  if (params.market && params.area) baseParams.set("area", params.area);
  if (options.bbox) baseParams.set("bbox", bboxParam(options.bbox));
  if (viewParam) baseParams.set("view", viewParam);

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
  // Refine's Reset: Where / Category removed — search, map area, view kept.
  const resetHref = (() => {
    const p = new URLSearchParams();
    if (params.q) p.set("q", params.q);
    if (options.bbox) p.set("bbox", bboxParam(options.bbox));
    if (viewParam) p.set("view", viewParam);
    return `/locations${p.toString() ? `?${p.toString()}` : ""}`;
  })();

  const emptyLabel =
    params.q || params.category || params.market
      ? `No locations matched${marketAreaLabel ? ` in ${marketAreaLabel}` : params.market ? ` in that area` : ""}${categoryName ? ` ${categoryName}` : ""}${params.q ? ` for "${params.q}"` : ""}.`
      : "No locations yet. Check back soon.";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-8 pt-3 sm:px-6 sm:py-10">
      {/* Archive Discovery UX pass — heading + view action, search +
          Refine (Where, Category) on one row, compact chips; no permanent
          lens row (Locations doesn't need one). Same URL fields as before. */}
      <ArchiveGeoShell
        surface="locations"
        initialView={view}
        bbox={options.bbox ?? null}
        noun={["Place", "Places"]}
        title="Locations"
        count={`${locations.length} location${locations.length === 1 ? "" : "s"}`}
        subtitle="Discover places and see what’s happening there."
        controls={
          <form method="get" className="flex items-center gap-2">
            {options.bbox && <input type="hidden" name="bbox" value={bboxParam(options.bbox)} />}
            {viewParam && <input type="hidden" name="view" value={viewParam} />}
            {params.market && <input type="hidden" name="market" value={params.market} />}
            {params.market && params.area && <input type="hidden" name="area" value={params.area} />}
            <ArchiveSearchField defaultValue={params.q} placeholder="Search Places" />
            <RefineSheet noun="Places" activeCount={(params.market ? 1 : 0) + (params.category ? 1 : 0)} resetHref={resetHref}>
              <RefineSection title="Where">
                <AreaPicker
                  fullWidth
                  options={markets.map((m) => ({
                    slug: m.slug,
                    label: getMarketAreaLabel(m),
                    areasIncluded: m.areas_included,
                    areas: m.areas.map((a) => ({ slug: a.slug, label: a.display_name || a.name, aliases: a.aliases })),
                  }))}
                />
              </RefineSection>
              {categories.length > 0 && (
                <RefineSection title="Category">
                  <select name="category" defaultValue={params.category ?? ""} aria-label="Category" className="h-11 w-full rounded-xl border border-black/10 bg-white px-3.5 text-sm text-ink focus:border-ink/30 focus:outline-none">
                    <option value="">All Categories</option>
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </RefineSection>
              )}
            </RefineSheet>
          </form>
        }
        chips={chips.length > 0 ? <ActiveFilterChips chips={chips} clearHref="/locations" /> : null}
      >

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
        <div data-geo-grid className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((l, i) => (
            <div key={l.id} data-geo-key={`loc:${l.id}`} className="min-w-0">
              <LocationDiscoveryCard location={l} analyticsContext={{ pageType: "locations", placement: "results_grid", position: i + 1 }} />
            </div>
          ))}
        </div>
      )}
      </ArchiveGeoShell>
    </div>
  );
}
