import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import BusinessCard from "@/components/BusinessCard";
import EventCard from "@/components/EventCard";
import ProductCard from "@/components/ProductCard";
import AppearanceFeedCard from "@/components/AppearanceFeedCard";
import Section, { HorizontalScroller } from "@/components/Section";
import {
  getFeaturedProducts,
  getMobileBusinesses,
  getUpcomingAppearancesFeed,
  getUpcomingEvents,
  searchBusinesses,
} from "@/lib/data";

export const revalidate = 60;

export default async function HomePage() {
  const [
    nearYou,
    happeningSoon,
    findThemNext,
    foodAndDrink,
    marketsAndPopUps,
    brandsOnTheMove,
    popularProducts,
  ] = await Promise.all([
    searchBusinesses({}),
    getUpcomingEvents(6),
    getUpcomingAppearancesFeed(8),
    searchBusinesses({ categorySlug: "food-drink" }),
    searchBusinesses({ categorySlug: "markets-pop-ups" }),
    getMobileBusinesses(8),
    getFeaturedProducts(8),
  ]);

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-16 sm:py-24">
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl md:text-6xl">
            Find what you&rsquo;re looking for.
            <br />
            And where it&rsquo;ll be next.
          </h1>
          <p className="max-w-lg text-base text-ink/60 sm:text-lg">
            Discover brands, vendors, food trucks, markets, and pop-ups — and always know
            where to find them next.
          </p>
          <SearchBar />
        </div>
      </section>

      {nearYou.length > 0 && (
        <Section title="Near You" subtitle="Businesses on Findmi right now" viewAllHref="/businesses">
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
        <Section title="Find Them Next" subtitle="Where Findmi businesses are showing up">
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

      {popularProducts.length > 0 && (
        <Section title="Popular Products">
          <HorizontalScroller>
            {popularProducts.map((p) => (
              <div key={p.id} className="w-44 shrink-0">
                <ProductCard product={p} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {/* Business CTA */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col items-start gap-5 rounded-3xl bg-ink px-8 py-12 text-white sm:px-12">
          <h2 className="max-w-lg text-2xl font-semibold tracking-tight sm:text-3xl">
            Have something people should Find?
          </h2>
          <p className="max-w-md text-white/70">
            Give your business one home for what you sell, where you&rsquo;ll be next, and
            how customers can reach you.
          </p>
          <Link
            href="/join"
            className="rounded-full bg-findmi-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-findmi-400"
          >
            Join Findmi
          </Link>
        </div>
      </section>
    </div>
  );
}
