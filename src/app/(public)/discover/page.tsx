import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import BusinessCard from "@/components/BusinessCard";
import EventCard from "@/components/EventCard";
import ProductCard from "@/components/ProductCard";
import AppearanceFeedCard from "@/components/AppearanceFeedCard";
import Section, { HorizontalScroller } from "@/components/Section";
import AreaPicker from "@/components/discover/AreaPicker";
import {
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
  description: "Find what's happening around you on Findmi — by area, by time, by category.",
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
    searchBusinesses({ featuredOnly: true, marketSlug, areaSlug, categorySlug, sort: "recommended", limit: 8 }),
    getFeaturedProducts(8),
  ]);

  const hasNothingCurated =
    happeningSoon.length === 0 && eventsSection.length === 0 && featuredBrands.length === 0 && featuredProducts.length === 0;

  const selectedMarket = markets.find((m) => m.slug === marketSlug);
  const selectedArea = marketSlug ? selectedMarket?.areas.find((a) => a.slug === areaSlug) : undefined;
  const areaLabel = selectedArea
    ? `${selectedArea.display_name || selectedArea.name} — ${selectedMarket ? getMarketAreaLabel(selectedMarket) : ""}`
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
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Discover</h1>
      <p className="mt-1.5 text-sm text-ink/60 sm:text-base">Find what&rsquo;s happening around you.</p>

      {/* WHERE — Area selector, same URL convention (?market=/?area=) and
          "Don't see your area?" request flow /businesses and /events
          already use. Reused verbatim, not rebuilt. */}
      <div className="mt-4">
        <AreaPicker
          options={markets.map((m) => ({
            slug: m.slug,
            label: getMarketAreaLabel(m),
            areasIncluded: m.areas_included,
            areas: m.areas.map((a) => ({ slug: a.slug, label: a.display_name || a.name, aliases: a.aliases })),
          }))}
        />
      </div>

      {/* WHEN — compact temporal tabs, driving BOTH Happening Soon
          (appearances) and the Events section below via each function's
          own already-established time vocabulary. Featured Brands is
          intentionally NOT time-scoped — a business listing has no
          "happens at a time" concept the way an appearance/event does
          (see this pass's own report). */}
      <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {WHEN_TABS.map((t) => (
          <Link
            key={t.key}
            href={buildHref("/discover", { when: t.key })}
            className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
              whenKey === t.key ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* WHAT — compact, founder-curated category subset (getHomeCategories,
          the same show_on_home/home_sort_order mechanism the homepage
          strip already uses) instead of the full alphabetical taxonomy
          wall. A selected pill is a real filter here (Happening Soon +
          Featured Brands both use business-kind categories, same as this
          list) — clicking it again clears it. Events use a SEPARATE
          taxonomy and are intentionally unaffected (see Params' own
          comment); "All Categories" hands off to /businesses' full sheet
          (location/featured/founding filters this page doesn't need to
          duplicate), carrying the current Area along. */}
      {homeCategories.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {homeCategories.map((c) => {
            const active = categorySlug === c.slug;
            return (
              <Link
                key={c.id}
                href={buildHref("/discover", { category: active ? undefined : c.slug })}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  active ? "bg-findmi text-white" : "border border-black/10 text-ink/70 hover:border-black/30 hover:text-ink"
                }`}
              >
                {c.name}
              </Link>
            );
          })}
          <Link
            href={buildHref("/businesses", { category: undefined, when: undefined })}
            className="rounded-full border border-dashed border-black/15 px-3.5 py-1.5 text-xs font-semibold text-ink/50 transition hover:border-black/30 hover:text-ink/70"
          >
            All Categories →
          </Link>
        </div>
      )}

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
              Nothing to surface yet — check back soon, or{" "}
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
              >
                <DiscoveryRow>
                  {happeningSoon.map((item) => (
                    <div key={item.id} className="w-72 shrink-0">
                      <AppearanceFeedCard item={item} />
                    </div>
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
              >
                <DiscoveryRow>
                  {eventsSection.map((e) => (
                    <div key={e.id} className="w-64 shrink-0">
                      <EventCard event={e} />
                    </div>
                  ))}
                </DiscoveryRow>
              </Section>
            </div>
          )}

          {featuredBrands.length > 0 && (
            <div className="-mx-4 sm:-mx-6">
              <Section title="Featured Brands" viewAllHref={buildHref("/businesses", { when: undefined }, { featured: "1" })}>
                <DiscoveryRow>
                  {featuredBrands.map((b) => (
                    <div key={b.id} className="w-44 shrink-0">
                      <BusinessCard business={b} />
                    </div>
                  ))}
                </DiscoveryRow>
              </Section>
            </div>
          )}

          {featuredProducts.length > 0 && (
            <div className="-mx-4 sm:-mx-6">
              <Section title="Featured Products" viewAllHref="/marketplace">
                <DiscoveryRow>
                  {featuredProducts.map((p) => (
                    <div key={p.id} className="w-44 shrink-0">
                      <ProductCard product={p} />
                    </div>
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
 * Discovery V2 — sparse-result fix (Section 9/12 of this pass's own
 * spec): HorizontalScroller's cards already keep their own intrinsic
 * width (shrink-0, never stretched by flex), but a lone card at the left
 * edge of a page this wide still reads as an accidentally-truncated row.
 * A short, non-scrolling row (<=3 items — never needs a scrollbar
 * anyway) renders as a plain flex-wrap row instead of the scroll
 * container, so it never implies "there's more to swipe to" when there
 * isn't; 4+ items keep the existing, already-proven HorizontalScroller
 * exactly as before. Page-level wrapper only — Section/HorizontalScroller/
 * the cards themselves are untouched.
 */
function DiscoveryRow({ children }: { children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  if (items.length > 3) return <HorizontalScroller>{children}</HorizontalScroller>;
  return <div className="flex flex-wrap gap-4 px-4 pb-2 sm:px-6">{children}</div>;
}
