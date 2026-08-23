import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import CompactCard from "@/components/CompactCard";
import LocationCard from "@/components/LocationCard";
import ProductCard from "@/components/ProductCard";
import EventCard from "@/components/EventCard";
import PostCard from "@/components/PostCard";
import Section, { HorizontalScroller } from "@/components/Section";
import {
  getFeaturedBusinesses,
  getFeaturedEvents,
  getFeaturedProducts,
  getFindMiHereFeed,
  getHomeAppearanceBulletins,
  getHomeCategories,
  getLocations,
  getMobileBusinesses,
  searchBusinesses,
} from "@/lib/data";
import { groupByCategory } from "@/lib/curation";
import { getSiteSections, resolveSection, HOMEPAGE_SECTIONS } from "@/lib/site-sections";
import { cityState, formatDateShort, getTemporalLabel } from "@/lib/format";
import type { BusinessWithCategories } from "@/lib/types";

export const revalidate = 60;

export default async function HomePage() {
  const [
    categories,
    todayFeed,
    weekendFeed,
    anytimeFeed,
    featuredEvents,
    featuredProducts,
    bulletins,
    featuredBrands,
    allBusinesses,
    brandsOnTheMove,
    locations,
    siteSections,
  ] = await Promise.all([
    getHomeCategories(),
    getFindMiHereFeed("today", 3),
    getFindMiHereFeed("weekend", 3),
    getFindMiHereFeed("anytime", 3),
    getFeaturedEvents(8),
    getFeaturedProducts(8),
    getHomeAppearanceBulletins(6),
    getFeaturedBusinesses(10),
    searchBusinesses({}),
    getMobileBusinesses(8),
    getLocations(8),
    getSiteSections("homepage"), // one query for every section override — see lib/site-sections.ts
  ]);

  // Founder Site Editor overrides — every field falls back to the current
  // hardcoded default (HOMEPAGE_SECTIONS) when no row/field exists, so the
  // homepage never depends on this table being populated.
  const resolve = (key: string) => resolveSection(siteSections, key, HOMEPAGE_SECTIONS[key]);
  const hero = resolve("hero");
  const doorway = resolve("business_doorway");
  const spotlight = resolve("brand_spotlight");
  const eventsSec = resolve("featured_events");
  const shopSec = resolve("shop_findmi");
  const hereSec = resolve("findmi_here");
  const brandsSec = resolve("featured_brands");
  const categoryFeedsSec = resolve("category_feeds");
  const moveSec = resolve("brands_on_the_move");
  const forBusinessSec = resolve("findmi_for_business");
  const oneProfileSec = resolve("one_profile");
  const locationsSec = resolve("popular_locations");
  const closingSec = resolve("closing_cta");

  // Signature Brand Spotlight card: today's first qualifying appearance, or
  // the nearest real upcoming one if nothing is happening today — never
  // fabricated, and getTemporalLabel tells the truth either way.
  const heroAppearance = todayFeed[0] ?? weekendFeed[0] ?? anytimeFeed[0];
  const heroLabel = heroAppearance
    ? getTemporalLabel(heroAppearance.start_at, heroAppearance.end_at)
    : null;

  const categoryRows = groupByCategory(allBusinesses, categories, { minPerRow: 2, limitPerRow: 10 });

  // The 11 reorderable sections below the masthead — sorted by the
  // founder's Site Editor order (Move Up/Down in /admin/site/homepage),
  // each a no-op null when its own visibility/data condition isn't met.
  const orderedSections: { key: string; order: number; node: React.ReactNode }[] = [
    {
      key: "brand_spotlight",
      order: spotlight.order,
      node: spotlight.visible && heroAppearance && heroLabel && (
        <section className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">
            {heroLabel.live ? "Happening Now" : spotlight.eyebrow}
          </p>
          <div className="mt-2 max-w-sm">
            <PostCard
              href={`/business/${heroAppearance.business.slug}`}
              image={heroAppearance.business.cover_image_url ?? null}
              logoUrl={heroAppearance.business.logo_url}
              kind="event"
              aspect="aspect-[4/3]"
              badgeLabel={heroLabel.label}
              badgeVariant={heroLabel.live ? "live" : "default"}
              title={heroAppearance.business.name}
              metaLines={[
                { icon: "tag", text: heroAppearance.title },
                ...(heroAppearance.city
                  ? [{ icon: "pin" as const, text: cityState(heroAppearance.city, heroAppearance.state) }]
                  : []),
              ]}
              cta="Find Them"
            />
          </div>
        </section>
      ),
    },
    {
      key: "featured_events",
      order: eventsSec.order,
      node: eventsSec.visible && featuredEvents.length > 0 && (
        <Section title={eventsSec.heading!} subtitle={eventsSec.body ?? undefined} viewAllHref={eventsSec.ctaUrl ?? undefined}>
          <HorizontalScroller>
            {featuredEvents.map((e) => (
              <div key={e.id} className="w-64 shrink-0">
                <EventCard event={e} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      ),
    },
    {
      key: "shop_findmi",
      order: shopSec.order,
      node: shopSec.visible && featuredProducts.length > 0 && (
        <Section title={shopSec.heading!} subtitle={shopSec.body ?? undefined} viewAllHref={shopSec.ctaUrl ?? undefined}>
          <HorizontalScroller>
            {featuredProducts.map((p) => (
              <div key={p.id} className="w-44 shrink-0">
                <ProductCard product={p} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      ),
    },
    {
      key: "findmi_here",
      order: hereSec.order,
      node: hereSec.visible && bulletins.length > 0 && (
        <Section title={hereSec.heading!} subtitle={hereSec.body ?? undefined} viewAllHref={hereSec.ctaUrl ?? undefined}>
          <HorizontalScroller>
            {bulletins.map((b) => (
              <Link
                key={b.id}
                href={b.href}
                className="flex w-72 shrink-0 flex-col gap-2 rounded-2xl border border-black/5 bg-white p-3.5 transition hover:shadow-md hover:shadow-black/5"
              >
                <div className="flex items-center gap-2.5">
                  <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-black/5">
                    {b.business.logo_url && (
                      <Image src={b.business.logo_url} alt={b.business.name} fill sizes="36px" className="object-cover" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{b.business.name}</p>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-ink/40">
                      {formatDateShort(b.startAt)}
                    </p>
                  </div>
                </div>
                <p className="line-clamp-2 text-sm text-ink/70">{b.bulletinText}</p>
              </Link>
            ))}
          </HorizontalScroller>
        </Section>
      ),
    },
    {
      key: "featured_brands",
      order: brandsSec.order,
      node: brandsSec.visible && featuredBrands.length > 0 && (
        <Section title={brandsSec.heading!} subtitle={brandsSec.body ?? undefined} viewAllHref={brandsSec.ctaUrl ?? undefined}>
          <HorizontalScroller>
            {featuredBrands.map((b) => (
              <div key={b.id} className="w-44 shrink-0">
                <CompactBusinessCard business={b} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      ),
    },
    {
      key: "category_feeds",
      order: categoryFeedsSec.order,
      node: categoryFeedsSec.visible && categoryRows.length > 0 && (
        <>
          {categoryRows.map(({ category, items }) => (
            <Section key={category.id} title={category.name} viewAllHref={`/businesses?category=${category.slug}`}>
              <HorizontalScroller>
                {items.map((b) => (
                  <div key={b.id} className="w-40 shrink-0">
                    <CompactBusinessCard business={b} />
                  </div>
                ))}
              </HorizontalScroller>
            </Section>
          ))}
        </>
      ),
    },
    {
      key: "brands_on_the_move",
      order: moveSec.order,
      node: moveSec.visible && brandsOnTheMove.length > 0 && (
        <Section title={moveSec.heading!} subtitle={moveSec.body ?? undefined}>
          <HorizontalScroller>
            {brandsOnTheMove.map((b) => (
              <div key={b.id} className="w-40 shrink-0">
                <CompactBusinessCard business={b} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      ),
    },
    {
      key: "findmi_for_business",
      order: forBusinessSec.order,
      node: forBusinessSec.visible && (
        <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="rounded-3xl border border-black/10 bg-white p-6 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">{forBusinessSec.eyebrow}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {forBusinessSec.heading}
            </h2>
            <p className="mt-3 max-w-lg text-sm text-ink/65">{forBusinessSec.body}</p>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Link
                href={forBusinessSec.ctaUrl ?? "/join"}
                className="rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              >
                {forBusinessSec.ctaLabel}
              </Link>
              <p className="text-xs text-ink/50">Founding 500 starts at $99/year.</p>
            </div>
          </div>
        </section>
      ),
    },
    {
      key: "one_profile",
      order: oneProfileSec.order,
      node: oneProfileSec.visible && (
        <section id="for-business" className="mx-auto max-w-6xl scroll-mt-16 px-4 pb-8 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">{oneProfileSec.eyebrow}</p>
          <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            {oneProfileSec.heading}
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {heroAppearance && (
              <PreviewFragment label="Profile">
                <CompactCard
                  href={`/business/${heroAppearance.business.slug}`}
                  image={heroAppearance.business.cover_image_url ?? null}
                  title={heroAppearance.business.name}
                  meta="Business profile"
                />
              </PreviewFragment>
            )}
            {featuredEvents[0] && (
              <PreviewFragment label="Appearances & Events">
                <CompactCard
                  href={`/event/${featuredEvents[0].slug}`}
                  image={featuredEvents[0].cover_image_url}
                  title={featuredEvents[0].name}
                  meta={cityState(featuredEvents[0].city, featuredEvents[0].state) || "Event"}
                />
              </PreviewFragment>
            )}
            {featuredProducts[0] && (
              <PreviewFragment label="Products">
                <CompactCard
                  href={`/product/${featuredProducts[0].slug}`}
                  image={featuredProducts[0].image_url}
                  title={featuredProducts[0].name}
                  meta={featuredProducts[0].business.name}
                />
              </PreviewFragment>
            )}
          </div>
        </section>
      ),
    },
    {
      key: "popular_locations",
      order: locationsSec.order,
      node: locationsSec.visible && locations.length > 0 && (
        <Section title={locationsSec.heading!} subtitle={locationsSec.body ?? undefined} viewAllHref={locationsSec.ctaUrl ?? undefined}>
          <HorizontalScroller>
            {locations.map((l) => (
              <div key={l.id} className="w-64 shrink-0">
                <LocationCard location={l} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      ),
    },
    {
      key: "closing_cta",
      order: closingSec.order,
      node: closingSec.visible && (
        <section className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex flex-col items-start gap-4 rounded-3xl bg-ink px-6 py-8 text-white sm:px-10 sm:py-9">
            <p className="text-xs font-bold uppercase tracking-wide text-findmi">{closingSec.eyebrow}</p>
            <h2 className="font-display max-w-lg text-xl font-semibold tracking-tight sm:text-2xl">
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
      ),
    },
  ];

  return (
    <div>
      {/* Masthead — headline + category chips + business doorway. Pinned
          first, outside the Site Editor's reordering system (same as
          header/footer), but its own text is still founder-editable. */}
      {hero.visible && (
        <section className="border-b border-black/5 bg-white">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:px-6 sm:py-5">
            <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl">
              {hero.heading}
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
            {doorway.visible && (
              <Link
                href={doorway.ctaUrl ?? "/join"}
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-dashed border-ink/20 px-3 py-1.5 text-xs font-medium text-ink/55 transition hover:border-ink/35 hover:text-ink/80"
              >
                <BriefcaseGlyph className="h-3.5 w-3.5" />
                {doorway.heading}
              </Link>
            )}
          </div>
        </section>
      )}

      {orderedSections
        .sort((a, b) => a.order - b.order)
        .map(({ key, node }) => (
          <Fragment key={key}>{node}</Fragment>
        ))}
    </div>
  );
}

function PreviewFragment({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-mist/40 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink/40">{label}</p>
      {children}
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

function BriefcaseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 7.5V6a2 2 0 012-2h3a2 2 0 012 2v1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3.5 12.5h17" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
