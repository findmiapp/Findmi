import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import BusinessCard from "@/components/BusinessCard";
import HomeEventCard from "@/components/HomeEventCard";
import ProductCard from "@/components/ProductCard";
import AppearanceDiscoveryCard from "@/components/discover/AppearanceDiscoveryCard";
import Section, { HorizontalScroller, RailItem } from "@/components/Section";
import SearchFilterAnalytics from "@/components/analytics/SearchFilterAnalytics";
import AreaPicker from "@/components/discover/AreaPicker";
import WhenPicker from "@/components/discover/WhenPicker";
import CategoryFilterSheet from "@/components/discover/CategoryFilterSheet";
import {
  attachEventCategories,
  getConsumerVisibleMarketsWithAreas,
  getEventsDiscovery,
  getFeaturedProducts,
  getFindMiHereFeed,
  getHomeCategories,
  getMarketAreaLabel,
  searchBusinesses,
  type FindWindow,
} from "@/lib/data";
import type { DiscoveryWindow } from "@/lib/format";

export const metadata: Metadata = {
  title: "Discover",
  description: "Find what's happening around you on Findmi: by area, by time, by category.",
};
export const revalidate = 60;

/**
 * Discovery V2, Area-First pass — reorganizes /discover around WHERE
 * (Area) -> WHEN (time) -> WHAT (category) -> RESULTS, reusing the exact
 * Market/Area/category architecture already built for /businesses,
 * /events, and the homepage (AreaPicker, getConsumerVisibleMarketsWithAreas,
 * getBusinessIdsInMarket/getBusinessIdsInArea via searchBusinesses/
 * getEventsDiscovery/getFindMiHereFeed). No second location system, no
 * schema change — see this pass's own report for the one additive
 * extension (getFindMiHereFeed gained optional marketSlug/areaSlug).
 */
const WHEN_TABS: { key: DiscoverWhenKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "weekend", label: "This Weekend" },
  { key: "upcoming", label: "Upcoming" },
];
type DiscoverWhenKey = "today" | "weekend" | "upcoming";

// Appearances (FindWindow: live/today/weekend/anytime) and Events
// (DiscoveryWindow: now/next/weekend/month/anytime) already have their
// OWN established vocabularies (see /find and /events) — this page adds
// no new time semantics, just maps its own compact 3-tab control onto
// each one's existing meaning.
function toFindWindow(key: DiscoverWhenKey): FindWindow {
  return key === "upcoming" ? "anytime" : key;
}
function toDiscoveryWindow(key: DiscoverWhenKey): DiscoveryWindow {
  return key === "today" ? "now" : key === "weekend" ? "weekend" : "anytime";
}

interface Params {
  market?: string;
  area?: string;
  when?: string;
  /** Business-kind category only (getHomeCategories/getCategories) — the
   * same taxonomy searchBusinesses/getFindMiHereFeed already use. Events
   * use a SEPARATE taxonomy (event_categories, kind="event" — see
   * /events' own `category` param) — this filter is intentionally never
   * applied to the Events section below; see this pass's own report. */
  category?: string;
}

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  // Discovery V2 — defaults to "upcoming" (the widest window), matching
  // /events' own default ("upNext" = anytime): the safest choice against
  // a sparse-Area/early-stage-catalog page looking empty on first load,
  // rather than defaulting to the narrowest ("today").
  const whenKey: DiscoverWhenKey = WHEN_TABS.some((t) => t.key === params.when) ? (params.when as DiscoverWhenKey) : "upcoming";
  const marketSlug = params.market;
  const areaSlug = marketSlug ? params.area : undefined;
  const categorySlug = params.category;

  const [homeCategories, markets, happeningSoon, eventsSection, featuredBrands, featuredProducts] = await Promise.all([
    getHomeCategories(),
    getConsumerVisibleMarketsWithAreas(),
    getFindMiHereFeed(toFindWindow(whenKey), 8, { marketSlug, areaSlug, categorySlug }),
    getEventsDiscovery({ when: toDiscoveryWindow(whenKey), marketSlug, areaSlug, limit: 8 }),
    // Active Featured Business Promotional Eligibility pass — this rail
    // is a genuine promotional placement (unlike /businesses' own
    // ?featured=1 filter checkbox, which stays plain editorial-only), so
    // it also requires >=1 qualifying upcoming appearance.
    searchBusinesses({
      featuredOnly: true,
      promotionallyEligibleOnly: true,
      marketSlug,
      areaSlug,
      categorySlug,
      sort: "recommended",
      limit: 8,
    }),
    getFeaturedProducts(8),
  ]);

  // Discovery Density System V1 — This Weekend now reuses HomeEventCard's
  // approved immersive grammar (unchanged component), which requires
  // EventWithCategories rather than the plain FindmiEvent getEventsDiscovery
  // already returns. attachEventCategories is the existing, already-
  // established batched extension for exactly this (mirrors attachCategories
  // for businesses) — one extra query for the whole page, never per-card,
  // and only runs over the (small, already-limited) eventsSection result.
  const eventsWithCategories = await attachEventCategories(eventsSection);

  const hasNothingCurated =
    happeningSoon.length === 0 && eventsSection.length === 0 && featuredBrands.length === 0 && featuredProducts.length === 0;

  const selectedMarket = markets.find((m) => m.slug === marketSlug);
  const selectedArea = marketSlug ? selectedMarket?.areas.find((a) => a.slug === areaSlug) : undefined;
  const areaLabel = selectedArea
    ? `${selectedArea.display_name || selectedArea.name}, ${selectedMarket ? getMarketAreaLabel(selectedMarket) : ""}`
    : selectedMarket
      ? getMarketAreaLabel(selectedMarket)
      : undefined;

  // Shared query-string builder — every link on this page (When tabs,
  // category pills, View all) is built from the SAME current params, so
  // changing one dimension never silently drops another (Case C/E).
  // `extra` appends destination-specific params a "View all" target
  // needs (e.g. /businesses' own ?featured=1) alongside the preserved
  // Area/When/category ones.
  function buildHref(
    base: string,
    overrides: Partial<{ market: string | undefined; area: string | undefined; when: DiscoverWhenKey | undefined; category: string | undefined }> = {},
    extra: Record<string, string> = {}
  ) {
    const next = {
      market: "market" in overrides ? overrides.market : marketSlug,
      area: "area" in overrides ? overrides.area : areaSlug,
      when: "when" in overrides ? overrides.when : whenKey,
      category: "category" in overrides ? overrides.category : categorySlug,
    };
    const p = new URLSearchParams();
    if (next.market) p.set("market", next.market);
    if (next.market && next.area) p.set("area", next.area);
    if (next.when && next.when !== "upcoming") p.set("when", next.when);
    if (next.category) p.set("category", next.category);
    for (const [key, value] of Object.entries(extra)) p.set(key, value);
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  }

  const viewAllAreasHref = buildHref("/discover", { market: undefined, area: undefined });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <SearchFilterAnalytics pageType="discover" filterParams={["category", "market", "area", "when"]} />
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Discover</h1>
      <p className="mt-1.5 text-sm text-ink/60 sm:text-base">Find what&rsquo;s happening around you.</p>

      {/* Mobile Discover Composition pass — replaces the old, stacked
          Area block + always-visible When tabs row + full category-pill
          wall (a filter wall that pushed all real content below the
          fold on mobile) with a compact three-control toolbar: Area /
          When / Filters, each a small trigger that opens the SAME
          underlying picker/sheet the old inline controls already used
          (AreaPicker unchanged; WhenPicker/CategoryFilterSheet are new
          presentational wrappers around the exact same ?when=/?category=
          semantics buildHref already establishes below). No filtering
          capability removed — Today/This Weekend/Upcoming and every
          category are still one tap away, they just no longer occupy
          permanent vertical space above Happening Soon. Desktop keeps
          the same compact row (it was never the problem this pass
          fixes), just narrower now that it's 3 controls instead of a
          multi-row stack. */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <AreaPicker
          fullWidth
          options={markets.map((m) => ({
            slug: m.slug,
            label: getMarketAreaLabel(m),
            areasIncluded: m.areas_included,
            areas: m.areas.map((a) => ({ slug: a.slug, label: a.display_name || a.name, aliases: a.aliases })),
          }))}
        />
        <WhenPicker options={WHEN_TABS.map((t) => ({ key: t.key, label: t.label }))} />
        <CategoryFilterSheet
          categories={homeCategories.map((c) => ({ id: c.id, slug: c.slug, name: c.name }))}
          allCategoriesHref={buildHref("/businesses", { category: undefined, when: undefined })}
        />
      </div>

      {/* RESULTS */}
      {hasNothingCurated ? (
        <div className="mt-10 rounded-2xl border border-black/5 bg-black/[0.015] p-6 text-center">
          {areaLabel ? (
            <>
              <p className="text-sm text-ink/60">Nothing to surface in {areaLabel} right now.</p>
              <Link href={viewAllAreasHref} className="mt-2 inline-block text-sm font-semibold text-findmi-700 underline underline-offset-2">
                View All Areas
              </Link>
            </>
          ) : (
            <p className="text-sm text-ink/50">
              Nothing to surface yet. Check back soon, or{" "}
              <Link href="/join" className="font-medium text-ink underline underline-offset-2">
                be the first to join
              </Link>
              .
            </p>
          )}
        </div>
      ) : (
        <>
          {happeningSoon.length > 0 && (
            <div className="-mx-4 mt-6 sm:-mx-6">
              {/* Find V2 — /find now supports the same structured Market/
                  Area as this page (its old free-text city field is
                  gone), so View All can finally carry Area straight
                  through, not just `when`/category. Market/Area inherit
                  from buildHref's own defaults (not overridden here);
                  `when` still needs translating to /find's own FindWindow
                  vocabulary (today/weekend/anytime), which is why it's
                  the one param passed via `extra` instead. */}
              <Section
                title="Happening Soon"
                viewAllHref={buildHref("/find", { when: undefined }, { when: toFindWindow(whenKey) })}
                className="py-4"
              >
                <DiscoveryRow>
                  {happeningSoon.map((item) => (
                    <RailItem key={item.id} density="collectible">
                      <AppearanceDiscoveryCard
                        item={item}
                        analyticsContext={{ pageType: "discover", placement: "happening_soon" }}
                      />
                    </RailItem>
                  ))}
                </DiscoveryRow>
              </Section>
            </div>
          )}

          {eventsSection.length > 0 && (
            <div className="-mx-4 sm:-mx-6">
              <Section
                title={whenKey === "today" ? "Today's Events" : whenKey === "weekend" ? "This Weekend" : "Upcoming Events"}
                viewAllHref={buildHref("/events", { when: undefined, category: undefined }, { when: toFindWindow(whenKey) })}
                className="py-4"
              >
                <DiscoveryRow>
                  {eventsWithCategories.map((e) => (
                    <RailItem key={e.id} density="immersive">
                      <HomeEventCard event={e} analyticsContext={{ pageType: "discover", placement: "events_section" }} />
                    </RailItem>
                  ))}
                </DiscoveryRow>
              </Section>
            </div>
          )}

          {featuredBrands.length > 0 && (
            <div className="-mx-4 sm:-mx-6">
              <Section
                title="Featured Brands"
                viewAllHref={buildHref("/businesses", { when: undefined }, { featured: "1" })}
                className="py-4"
              >
                <DiscoveryRow>
                  {featuredBrands.map((b) => (
                    <RailItem key={b.id} density="discovery">
                      <BusinessCard business={b} analyticsContext={{ pageType: "discover", placement: "featured_brands" }} />
                    </RailItem>
                  ))}
                </DiscoveryRow>
              </Section>
            </div>
          )}

          {featuredProducts.length > 0 && (
            <div className="-mx-4 sm:-mx-6">
              <Section title="Featured Products" viewAllHref="/marketplace" className="py-4">
                <DiscoveryRow>
                  {featuredProducts.map((p) => (
                    <RailItem key={p.id} density="collectible">
                      <ProductCard product={p} analyticsContext={{ pageType: "discover", placement: "featured_products" }} />
                    </RailItem>
                  ))}
                </DiscoveryRow>
              </Section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Discover Rail Behavior Correction pass — the previous threshold here
 * (">3 items -> HorizontalScroller, else a plain flex-wrap row") was
 * wrong: at mobile widths, a RailItem's own density width (discovery/
 * collectible/immersive) never lets 2-3 of them fit on one line, so
 * flex-wrap silently stacked them vertically — exactly the production
 * regression this pass fixes (Happening Soon/Featured Brands reading as
 * a vertical list instead of a horizontal rail). Only a genuinely SINGLE
 * item skips the scroll container now (nothing to scroll to, and a lone
 * card at the left edge would otherwise misleadingly look truncated);
 * 2+ items always get the real, already-proven HorizontalScroller,
 * regardless of count. Page-level wrapper only — Section/
 * HorizontalScroller/the cards themselves are untouched. */
function DiscoveryRow({ children }: { children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  if (items.length > 1) return <HorizontalScroller>{children}</HorizontalScroller>;
  return <div className="flex gap-4 px-4 pb-2 sm:px-6">{children}</div>;
}
