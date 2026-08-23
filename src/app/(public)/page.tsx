import Link from "next/link";
import CompactCard from "@/components/CompactCard";
import LocationCard from "@/components/LocationCard";
import ProductCard from "@/components/ProductCard";
import AppearanceFeedCard from "@/components/AppearanceFeedCard";
import HomeDiscoveryTabs from "@/components/HomeDiscoveryTabs";
import PostCard from "@/components/PostCard";
import Section, { HorizontalScroller } from "@/components/Section";
import {
  getFeaturedProducts,
  getHomeCategories,
  getFindMiHereFeed,
  getLocations,
  getMobileBusinesses,
  getUpcomingAppearancesFeed,
  getUpcomingEvents,
  searchBusinesses,
} from "@/lib/data";
import { cityState, formatDateRange, getTemporalLabel } from "@/lib/format";
import type { BusinessWithCategories, FindmiEvent } from "@/lib/types";

export const revalidate = 60;

export default async function HomePage() {
  const [
    categories,
    todayFeed,
    weekendFeed,
    anytimeFeed,
    nearYou,
    happeningSoon,
    findThemNext,
    foodAndDrink,
    marketsAndPopUps,
    brandsOnTheMove,
    popularProducts,
    locations,
  ] = await Promise.all([
    getHomeCategories(),
    getFindMiHereFeed("today", 9),
    getFindMiHereFeed("weekend", 8),
    getFindMiHereFeed("anytime", 8),
    searchBusinesses({}),
    getUpcomingEvents(6),
    getUpcomingAppearancesFeed(8),
    searchBusinesses({ categorySlug: "food-drink" }),
    searchBusinesses({ categorySlug: "markets-pop-ups" }),
    getMobileBusinesses(8),
    getFeaturedProducts(8),
    getLocations(8),
  ]);

  // Signature card: today's first qualifying appearance, or the nearest
  // real upcoming one if nothing is happening today — never fabricated,
  // and getTemporalLabel tells the truth either way (it doesn't know or
  // care which window the item came from).
  const heroAppearance = todayFeed[0] ?? weekendFeed[0] ?? anytimeFeed[0];
  const heroLabel = heroAppearance
    ? getTemporalLabel(heroAppearance.start_at, heroAppearance.end_at)
    : null;
  const todayRest = todayFeed.filter((i) => i.id !== heroAppearance?.id);

  return (
    <div>
      {/* Compact opening — headline + category chips only. Search is one
          tap away via the header search icon (mobile) / nav search link
          (desktop), not a giant form competing with discovery content. */}
      <section className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:px-6 sm:py-5">
          <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl">
            What&rsquo;s around you right now?
          </h1>
          {categories.length > 0 && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:-mx-6 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {categories.map((c) => (
                <Link
                  key={c.id}
                  href={`/businesses?category=${c.slug}`}
                  className="shrink-0 whitespace-nowrap rounded-full border border-black/10 px-3.5 py-1.5 text-xs font-medium text-ink/70 transition hover:border-ink/30"
                >
                  {c.name}
                </Link>
              ))}
              <Link
                href="/businesses"
                className="shrink-0 whitespace-nowrap rounded-full border border-black/10 px-3.5 py-1.5 text-xs font-medium text-ink/70 transition hover:border-ink/30"
              >
                More →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Signature discovery — real temporal data only, never faked. A
          landscape aspect (not the tall 3/4 story-card ratio) keeps this
          from eating the whole first viewport. */}
      {heroAppearance && heroLabel && (
        <section className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">
            {heroLabel.live ? "Happening Now" : "FindMi Here"}
          </p>
          <div className="mt-2 max-w-sm">
            <PostCard
              href={`/business/${heroAppearance.business.slug}`}
              image={heroAppearance.business.cover_image_url ?? null}
              kind="event"
              aspect="aspect-[4/3]"
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

          {/* Immediately beneath the signature card — more than one
              discovery visible without scrolling past a full screen. */}
          <HomeDiscoveryTabs today={todayRest} weekend={weekendFeed} anytime={anytimeFeed} />
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
              <div key={b.id} className="w-40 shrink-0">
                <CompactBusinessCard business={b} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {happeningSoon.length > 0 && (
        <Section title="Happening Soon" subtitle="Markets, pop-ups, and events coming up" viewAllHref="/events">
          <HorizontalScroller>
            {happeningSoon.map((e) => (
              <div key={e.id} className="w-40 shrink-0">
                <CompactEventCard event={e} />
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
              <div key={b.id} className="w-40 shrink-0">
                <CompactBusinessCard business={b} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {marketsAndPopUps.length > 0 && (
        <Section title="Markets & Pop-Ups" viewAllHref="/businesses?category=markets-pop-ups">
          <HorizontalScroller>
            {marketsAndPopUps.map((b) => (
              <div key={b.id} className="w-40 shrink-0">
                <CompactBusinessCard business={b} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {brandsOnTheMove.length > 0 && (
        <Section title="Brands On The Move" subtitle="Mobile businesses that come to you">
          <HorizontalScroller>
            {brandsOnTheMove.map((b) => (
              <div key={b.id} className="w-40 shrink-0">
                <CompactBusinessCard business={b} />
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
      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col items-start gap-4 rounded-3xl bg-ink px-6 py-8 text-white sm:px-10 sm:py-9">
          <h2 className="font-display max-w-lg text-xl font-semibold tracking-tight sm:text-2xl">
            Have something people should find?
          </h2>
          <p className="max-w-md text-sm text-white/70">
            Give your business one home for what you sell, where you&rsquo;ll be next, and
            how customers can reach you.
          </p>
          <Link
            href="/join"
            className="rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Join FindMi
          </Link>
        </div>
      </section>
    </div>
  );
}

// Homepage-only compact presentation — the shared PostCard/BusinessCard/
// EventCard combo is a tall photo-overlay "story" card (by design, for the
// signature moment and for /businesses, /discover, /events grids). Reusing
// it for these dense secondary rows was what made ordinary cards consume
// nearly a full viewport, so this is a smaller, normal-flow variant local
// to the homepage rather than a change to those shared components.
function CompactBusinessCard({ business }: { business: BusinessWithCategories }) {
  const meta = [business.categories[0]?.name, cityState(business.city, business.state)]
    .filter(Boolean)
    .join(" · ");
  return <CompactCard href={`/business/${business.slug}`} image={business.cover_image_url} title={business.name} meta={meta} />;
}

function CompactEventCard({ event }: { event: FindmiEvent }) {
  const meta = [formatDateRange(event.start_at, event.end_at), cityState(event.city, event.state)]
    .filter(Boolean)
    .join(" · ");
  return <CompactCard href={`/event/${event.slug}`} image={event.cover_image_url} title={event.name} meta={meta} />;
}
