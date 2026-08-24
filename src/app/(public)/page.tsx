import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import CompactCard from "@/components/CompactCard";
import Section, { HorizontalScroller } from "@/components/Section";
import HomeHero from "@/components/HomeHero";
import SearchBar from "@/components/SearchBar";
import HomeEventDiscovery from "@/components/HomeEventDiscovery";
import AppearanceFeedCard from "@/components/AppearanceFeedCard";
import {
  attachEventCategories,
  getFeaturedBusinesses,
  getFeaturedEvents,
  getFeaturedProducts,
  getFindMiHereFeed,
  getHomeCategories,
  getUpcomingEvents,
} from "@/lib/data";
import { getSiteSections, resolveSection, HOMEPAGE_SECTIONS } from "@/lib/site-sections";
import { cityState } from "@/lib/format";
import type { BusinessWithCategories } from "@/lib/types";

export const revalidate = 60;

export default async function HomePage() {
  const [
    categories,
    todayEventsRaw,
    weekendEventsRaw,
    anytimeEventsRaw,
    popularEventsRaw,
    aroundYouNow,
    featuredProducts,
    featuredBrands,
    siteSections,
  ] = await Promise.all([
    getHomeCategories(),
    getUpcomingEvents(10, "now"),
    getUpcomingEvents(10, "weekend"),
    getUpcomingEvents(10, "anytime"),
    getFeaturedEvents(10),
    getFindMiHereFeed("anytime", 12),
    getFeaturedProducts(10),
    getFeaturedBusinesses(10),
    getSiteSections("homepage"), // one query for every section override — see lib/site-sections.ts
  ]);

  // Category attachment is a small, cheap batched follow-up query per list
  // (attachEventCategories), same pattern used everywhere else events get
  // a category badge — not a new query architecture.
  const [todayEvents, weekendEvents, anytimeEvents, popularEvents] = await Promise.all([
    attachEventCategories(todayEventsRaw),
    attachEventCategories(weekendEventsRaw),
    attachEventCategories(anytimeEventsRaw),
    attachEventCategories(popularEventsRaw),
  ]);

  // Founder Site Editor overrides — every field falls back to the current
  // hardcoded default (HOMEPAGE_SECTIONS) when no row/field exists, so the
  // homepage never depends on this table being populated.
  const resolve = (key: string) => resolveSection(siteSections, key, HOMEPAGE_SECTIONS[key]);
  const joinBanner = resolve("business_doorway");
  const upcomingSec = resolve("featured_events"); // repurposed: "Upcoming Near You"
  const aroundYouSec = resolve("findmi_here"); // repurposed: "Around You Right Now"
  const shopSec = resolve("shop_findmi");
  const brandsSec = resolve("featured_brands");
  const exploreSec = resolve("explore_by_category");
  const closingSec = resolve("closing_cta");

  // Hero collage — real cover photos already fetched for other sections
  // (never stock/decorative imagery, never fabricated). Picks up to 3
  // distinct images from the highest-signal real content available;
  // renders fewer, or none, if that's genuinely all there is.
  const heroImages = Array.from(
    new Set(
      [
        featuredBrands[0]?.cover_image_url,
        aroundYouNow[0]?.business.cover_image_url,
        anytimeEvents[0]?.cover_image_url ?? popularEvents[0]?.cover_image_url,
        featuredBrands[1]?.cover_image_url,
        aroundYouNow[1]?.business.cover_image_url,
      ].filter((src): src is string => Boolean(src))
    )
  ).slice(0, 3);

  return (
    <div>
      <HomeHero images={heroImages} />

      {/* Search — immediately after the hero, full width. */}
      <section className="border-b border-black/5 bg-white px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto max-w-6xl">
          <SearchBar />
        </div>
      </section>

      {/* Category pills — compact, horizontally scrollable, one row. */}
      {categories.length > 0 && (
        <section className="border-b border-black/5 bg-white px-4 py-3 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {categories.map((c) => (
                <Link
                  key={c.id}
                  href={`/businesses?category=${c.slug}`}
                  className="shrink-0 whitespace-nowrap rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-ink/75 transition hover:border-findmi/50 hover:text-findmi-700"
                >
                  {c.name}
                </Link>
              ))}
              <Link
                href="/businesses"
                className="shrink-0 whitespace-nowrap rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-ink/75 transition hover:border-findmi/50 hover:text-findmi-700"
              >
                More →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Discovery filters (Today/This Weekend/All Events/Popular/Near Me)
          + first live feed — wired together since the filters exist to
          control this feed. Mobile carousel targets ~2.2-2.5 visible
          cards (see HomeEventDiscovery/CompactEventCard). */}
      <section className="py-5">
        <div className="mx-auto max-w-6xl">
          <div className="mb-3 px-4 sm:px-6">
            <h2 className="text-lg font-semibold tracking-tight text-ink">{upcomingSec.heading}</h2>
          </div>
          <HomeEventDiscovery today={todayEvents} weekend={weekendEvents} anytime={anytimeEvents} popular={popularEvents} />
        </div>
      </section>

      {/* Second live feed — Around You Right Now (real upcoming appearances
          across businesses — vendors, pop-ups, markets). */}
      {aroundYouNow.length > 0 && (
        <Section title={aroundYouSec.heading!} subtitle={aroundYouSec.body ?? undefined} viewAllHref={aroundYouSec.ctaUrl ?? undefined}>
          <HorizontalScroller>
            {aroundYouNow.map((item) => (
              <div key={item.id} className="w-[70%] min-w-[240px] max-w-[280px] shrink-0 sm:w-72">
                <AppearanceFeedCard item={item} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {/* Primary join banner — compact, native-feeling, not a giant ad. */}
      {joinBanner.visible && (
        <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="rounded-3xl border border-black/10 bg-white p-5 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
              <div className="min-w-0">
                <h2 className="font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
                  {joinBanner.heading}
                </h2>
                <p className="mt-1 text-sm text-ink/60">{joinBanner.body}</p>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-medium text-ink/55">
                  <li className="flex items-center gap-1.5"><CheckGlyph /> Beautiful profile</li>
                  <li className="flex items-center gap-1.5"><CheckGlyph /> List events &amp; products</li>
                  <li className="flex items-center gap-1.5"><CheckGlyph /> Reach local customers</li>
                  <li className="flex items-center gap-1.5"><CheckGlyph /> Grow your community</li>
                </ul>
              </div>
              <Link
                href={joinBanner.ctaUrl ?? "/join"}
                className="inline-flex shrink-0 items-center justify-center rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              >
                {joinBanner.ctaLabel}
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Shop Local — real product architecture, carousel-forward. */}
      {featuredProducts.length > 0 && (
        <Section title={shopSec.heading!} subtitle={shopSec.body ?? undefined} viewAllHref={shopSec.ctaUrl ?? undefined}>
          <HorizontalScroller>
            {featuredProducts.map((p) => (
              <div key={p.id} className="w-[42%] min-w-[150px] max-w-[176px] shrink-0 sm:w-44">
                <ProductCard product={p} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {/* Featured Brands — real founder-curated businesses. */}
      {featuredBrands.length > 0 && (
        <Section title={brandsSec.heading!} subtitle={brandsSec.body ?? undefined} viewAllHref={brandsSec.ctaUrl ?? undefined}>
          <HorizontalScroller>
            {featuredBrands.map((b) => (
              <div key={b.id} className="w-[38%] min-w-[136px] max-w-[168px] shrink-0 sm:w-44">
                <CompactBusinessCard business={b} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {/* Explore By Category — compact navigation, not a tall grid. */}
      {categories.length > 0 && (
        <section className="py-6">
          <div className="mx-auto max-w-6xl">
            <div className="mb-3 px-4 sm:px-6">
              <h2 className="text-lg font-semibold tracking-tight text-ink">{exploreSec.heading}</h2>
            </div>
            <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {categories.map((c) => (
                <Link
                  key={c.id}
                  href={`/businesses?category=${c.slug}`}
                  className="flex shrink-0 items-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:border-findmi/50 hover:bg-findmi-50"
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Final business CTA — stronger conversion moment near the bottom. */}
      {closingSec.visible && (
        <section className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex flex-col items-start gap-4 rounded-3xl bg-ink px-6 py-8 text-white sm:px-10 sm:py-9">
            <p className="text-xs font-bold uppercase tracking-wide text-findmi">{closingSec.eyebrow}</p>
            <h2 className="font-display max-w-lg whitespace-pre-line text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {closingSec.heading}
            </h2>
            <p className="max-w-md text-sm text-white/70">{closingSec.body}</p>
            <Link
              href={closingSec.ctaUrl ?? "/join"}
              className="rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
            >
              {closingSec.ctaLabel}
            </Link>
          </div>
        </section>
      )}
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

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0 text-findmi-600">
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
