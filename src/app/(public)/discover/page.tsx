import type { Metadata } from "next";
import Link from "next/link";
import BusinessCard from "@/components/BusinessCard";
import EventCard from "@/components/EventCard";
import ProductCard from "@/components/ProductCard";
import AppearanceFeedCard from "@/components/AppearanceFeedCard";
import Section, { HorizontalScroller } from "@/components/Section";
import {
  getCategories,
  getEventsDiscovery,
  getFeaturedBusinesses,
  getFeaturedEvents,
  getFeaturedProducts,
  getFindMiHereFeed,
  getLocations,
} from "@/lib/data";

export const metadata: Metadata = {
  title: "Discover",
  description: "Inspire me — mixed discovery across FindMi businesses, events, and products.",
};
export const revalidate = 60;

export default async function DiscoverPage() {
  const [categories, locations, nextUp, thisWeekend, featuredEvents, featuredBrands, featuredProducts] =
    await Promise.all([
      getCategories(),
      getLocations(8),
      getFindMiHereFeed("today", 8),
      getEventsDiscovery({ when: "weekend", limit: 8 }),
      getFeaturedEvents(8),
      getFeaturedBusinesses(8),
      getFeaturedProducts(8),
    ]);

  // Discover must never read as broken/blank just because nothing is
  // happening RIGHT this moment — "Next Up" falls back to the nearest real
  // upcoming appearances (anytime) rather than showing nothing. Every
  // temporal label on the resulting cards is still resolved truthfully by
  // getTemporalLabel — never forced to say "Here Now"/"Live".
  const nextUpItems = nextUp;

  const hasNothingCurated =
    nextUpItems.length === 0 &&
    thisWeekend.length === 0 &&
    featuredEvents.length === 0 &&
    featuredBrands.length === 0 &&
    featuredProducts.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Discover</h1>
      <p className="mt-2 text-ink/60">
        Inspire me — a mix of what&rsquo;s happening, what&rsquo;s new, and who to know on FindMi. Looking
        for something specific? Try{" "}
        <Link href="/find" className="font-medium text-ink underline underline-offset-2">
          Find
        </Link>
        .
      </p>

      {categories.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/businesses?category=${c.slug}`}
              className="rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-ink/70 transition hover:border-ink/30 hover:text-ink"
            >
              {c.name}
            </Link>
          ))}
          {locations.length > 0 && (
            <Link
              href="/locations"
              className="rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-ink/70 transition hover:border-ink/30 hover:text-ink"
            >
              Browse Locations
            </Link>
          )}
        </div>
      )}

      {hasNothingCurated ? (
        <p className="mt-10 text-sm text-ink/50">
          Nothing to surface yet — check back soon, or{" "}
          <Link href="/join" className="font-medium text-ink underline underline-offset-2">
            be the first to join
          </Link>
          .
        </p>
      ) : (
        <>
          {nextUpItems.length > 0 && (
            <div className="-mx-6 mt-4">
              <Section title="Next Up" subtitle="Real appearances, soonest first" viewAllHref="/find">
                <HorizontalScroller>
                  {nextUpItems.map((item) => (
                    <div key={item.id} className="w-72 shrink-0">
                      <AppearanceFeedCard item={item} />
                    </div>
                  ))}
                </HorizontalScroller>
              </Section>
            </div>
          )}

          {thisWeekend.length > 0 && (
            <div className="-mx-6">
              <Section title="This Weekend" viewAllHref="/events?when=weekend">
                <HorizontalScroller>
                  {thisWeekend.map((e) => (
                    <div key={e.id} className="w-64 shrink-0">
                      <EventCard event={e} />
                    </div>
                  ))}
                </HorizontalScroller>
              </Section>
            </div>
          )}

          {featuredEvents.length > 0 && (
            <div className="-mx-6">
              <Section title="Featured Events" viewAllHref="/events">
                <HorizontalScroller>
                  {featuredEvents.map((e) => (
                    <div key={e.id} className="w-64 shrink-0">
                      <EventCard event={e} />
                    </div>
                  ))}
                </HorizontalScroller>
              </Section>
            </div>
          )}

          {featuredBrands.length > 0 && (
            <div className="-mx-6">
              <Section title="Featured Brands" viewAllHref="/businesses">
                <HorizontalScroller>
                  {featuredBrands.map((b) => (
                    <div key={b.id} className="w-44 shrink-0">
                      <BusinessCard business={b} />
                    </div>
                  ))}
                </HorizontalScroller>
              </Section>
            </div>
          )}

          {featuredProducts.length > 0 && (
            <div className="-mx-6">
              <Section title="Featured Products" viewAllHref="/marketplace">
                <HorizontalScroller>
                  {featuredProducts.map((p) => (
                    <div key={p.id} className="w-44 shrink-0">
                      <ProductCard product={p} />
                    </div>
                  ))}
                </HorizontalScroller>
              </Section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
