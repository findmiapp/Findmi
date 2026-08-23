import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import BusinessCard from "@/components/BusinessCard";
import EventCard from "@/components/EventCard";
import LocationCard from "@/components/LocationCard";
import ProductCard from "@/components/ProductCard";
import AppearanceFeedCard from "@/components/AppearanceFeedCard";
import PostCard from "@/components/PostCard";
import Section, { HorizontalScroller } from "@/components/Section";
import {
  getCategories,
  getFeaturedProducts,
  getFindMiHereFeed,
  getLocations,
  getMobileBusinesses,
  getUpcomingAppearancesFeed,
  getUpcomingEvents,
  searchBusinesses,
} from "@/lib/data";
import { cityState, getTemporalLabel } from "@/lib/format";

export const revalidate = 60;

export default async function HomePage() {
  const [
    categories,
    happeningNow,
    nearYou,
    happeningSoon,
    findThemNext,
    foodAndDrink,
    marketsAndPopUps,
    brandsOnTheMove,
    popularProducts,
    locations,
  ] = await Promise.all([
    getCategories(),
    getFindMiHereFeed("today", 3),
    searchBusinesses({}),
    getUpcomingEvents(6),
    getUpcomingAppearancesFeed(8),
    searchBusinesses({ categorySlug: "food-drink" }),
    searchBusinesses({ categorySlug: "markets-pop-ups" }),
    getMobileBusinesses(8),
    getFeaturedProducts(8),
    getLocations(8),
  ]);

  const heroAppearance = happeningNow[0];
  const heroLabel = heroAppearance
    ? getTemporalLabel(heroAppearance.start_at, heroAppearance.end_at)
    : null;

  return (
    <div>
      {/* Compact opening — the product demonstrates itself, not a marketing
          hero. */}
      <section className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
          <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
            What&rsquo;s happening right now?
          </h1>
          <SearchBar />
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {categories.slice(0, 5).map((c) => (
                <Link
                  key={c.id}
                  href={`/businesses?category=${c.slug}`}
                  className="rounded-full border border-black/10 px-4 py-1.5 text-sm font-medium text-ink/70 transition hover:border-ink/30"
                >
                  {c.name}
                </Link>
              ))}
              <Link
                href="/businesses"
                className="rounded-full border border-black/10 px-4 py-1.5 text-sm font-medium text-ink/70 transition hover:border-ink/30"
              >
                More
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Signature top experience — real temporal discovery, never faked */}
      {heroAppearance && heroLabel && (
        <section className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">
            {heroLabel.live ? "Happening Now" : "FindMi Here"}
          </p>
          <div className="mt-3 max-w-sm">
            <PostCard
              href={`/business/${heroAppearance.business.slug}`}
              image={heroAppearance.business.cover_image_url ?? null}
              kind="event"
              badgeLabel={heroLabel.label}
              badgeVariant={heroLabel.live ? "live" : "default"}
              title={heroAppearance.business.name}
              metaLines={[
                { icon: "tag", text: heroAppearance.title },
                ...(heroAppearance.city
                  ? [
                      {
                        icon: "pin" as const,
                        text: cityState(heroAppearance.city, heroAppearance.state),
                      },
                    ]
                  : []),
              ]}
              cta="Find Them"
            />
          </div>
        </section>
      )}

      {nearYou.length > 0 && (
        <Section
          title="Featured Near NYC"
          subtitle="Discover businesses on FindMi"
          viewAllHref="/businesses"
        >
          <HorizontalScroller>
            {nearYou.slice(0, 10).map((b) => (
              <div key={b.id} className="w-64 shrink-0">
                <BusinessCard business={b} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {happeningSoon.length > 0 && (
        <Section title="Happening Soon" subtitle="Markets, pop-ups, and events coming up" viewAllHref="/events">
          <HorizontalScroller>
            {happeningSoon.map((e) => (
              <div key={e.id} className="w-64 shrink-0">
                <EventCard event={e} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {findThemNext.length > 0 && (
        <Section title="FindMi Here" subtitle="Where FindMi businesses are showing up" viewAllHref="/find">
          <HorizontalScroller>
            {findThemNext.map((item) => (
              <div key={item.id} className="w-72 shrink-0">
                <AppearanceFeedCard item={item} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {foodAndDrink.length > 0 && (
        <Section title="Food & Drink" viewAllHref="/businesses?category=food-drink">
          <HorizontalScroller>
            {foodAndDrink.map((b) => (
              <div key={b.id} className="w-64 shrink-0">
                <BusinessCard business={b} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {marketsAndPopUps.length > 0 && (
        <Section title="Markets & Pop-Ups" viewAllHref="/businesses?category=markets-pop-ups">
          <HorizontalScroller>
            {marketsAndPopUps.map((b) => (
              <div key={b.id} className="w-64 shrink-0">
                <BusinessCard business={b} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {brandsOnTheMove.length > 0 && (
        <Section title="Brands On The Move" subtitle="Mobile businesses that come to you">
          <HorizontalScroller>
            {brandsOnTheMove.map((b) => (
              <div key={b.id} className="w-64 shrink-0">
                <BusinessCard business={b} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {locations.length > 0 && (
        <Section
          title="Popular Locations"
          subtitle="See who's showing up next at each spot"
          viewAllHref="/locations"
        >
          <HorizontalScroller>
            {locations.map((l) => (
              <div key={l.id} className="w-64 shrink-0">
                <LocationCard location={l} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {popularProducts.length > 0 && (
        <Section title="Popular Products">
          <HorizontalScroller>
            {popularProducts.map((p) => (
              <div key={p.id} className="w-44 shrink-0">
                <ProductCard product={p} businessSlug={p.business?.slug} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {/* Business CTA */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col items-start gap-5 rounded-3xl bg-ink px-8 py-12 text-white sm:px-12">
          <h2 className="font-display max-w-lg text-2xl font-bold tracking-tight sm:text-3xl">
            Have something people should find?
          </h2>
          <p className="max-w-md text-white/70">
            Give your business one home for what you sell, where you&rsquo;ll be next, and
            how customers can reach you.
          </p>
          <Link
            href="/join"
            className="rounded-full bg-findmi px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600"
          >
            Join FindMi
          </Link>
        </div>
      </section>
    </div>
  );
}
