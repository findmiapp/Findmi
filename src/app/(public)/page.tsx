import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import BusinessLogoCard from "@/components/BusinessLogoCard";
import BusinessShowcaseCarousel from "@/components/BusinessShowcaseCarousel";
import Section, { HorizontalScroller } from "@/components/Section";
import HomeHero from "@/components/HomeHero";
import SearchBar from "@/components/SearchBar";
import HomeEventDiscovery from "@/components/HomeEventDiscovery";
import {
  attachEventCategories,
  getFeaturedBusinesses,
  getFeaturedEvents,
  getFeaturedProducts,
  getHomeCategories,
  getUpcomingEvents,
} from "@/lib/data";
import { getSiteSections, resolveSection, HOMEPAGE_SECTIONS } from "@/lib/site-sections";

export const revalidate = 60;

export default async function HomePage() {
  const [
    categories,
    upNextRaw,
    todayRaw,
    weekendRaw,
    anytimeRaw,
    popularRaw,
    featuredProducts,
    featuredBrands,
    siteSections,
  ] = await Promise.all([
    getHomeCategories(),
    getUpcomingEvents(10, "anytime"), // "Up Next" — see HomeEventDiscovery's own note on this
    getUpcomingEvents(10, "now"),
    getUpcomingEvents(10, "weekend"),
    getUpcomingEvents(10, "anytime"), // "All Events" — same real chronological query as Up Next
    getFeaturedEvents(10),
    getFeaturedProducts(10),
    getFeaturedBusinesses(10),
    getSiteSections("homepage"), // one query for every section override — see lib/site-sections.ts
  ]);

  const [upNextEvents, todayEvents, weekendEvents, anytimeEvents, popularEvents] = await Promise.all([
    attachEventCategories(upNextRaw),
    attachEventCategories(todayRaw),
    attachEventCategories(weekendRaw),
    attachEventCategories(anytimeRaw),
    attachEventCategories(popularRaw),
  ]);

  // Founder Site Editor overrides — every field falls back to the current
  // hardcoded default (HOMEPAGE_SECTIONS) when no row/field exists, so the
  // homepage never depends on this table being populated.
  const resolve = (key: string) => resolveSection(siteSections, key, HOMEPAGE_SECTIONS[key]);
  const showcase = resolve("business_doorway");
  const upcomingSec = resolve("featured_events");
  const shopSec = resolve("shop_findmi");
  const brandsSec = resolve("featured_brands");
  const exploreSec = resolve("explore_by_category");
  const closingSec = resolve("closing_cta");
  const heroSec = resolve("hero");

  // Hero collage — founder-configured images (Site Editor → Hero → Image
  // 1/2/3) take priority; any unconfigured slot falls back to a real photo
  // already being fetched for Featured Brands (never stock/decorative
  // imagery, never fabricated). With zero of either, no collage renders.
  const fallbackImages = [featuredBrands[0]?.cover_image_url, featuredBrands[1]?.cover_image_url, featuredBrands[2]?.cover_image_url].filter(
    (src): src is string => Boolean(src)
  );
  const heroImages = Array.from({ length: 3 }, (_, i) => heroSec.images[i] ?? fallbackImages[i]).filter(
    (src): src is string => Boolean(src)
  );

  return (
    <div>
      <HomeHero images={heroImages} />

      {/* Search — immediately after the hero, live typeahead. */}
      <section className="border-b border-black/5 bg-white px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto max-w-6xl">
          <SearchBar />
        </div>
      </section>

      {/* Category pills — compact, horizontally scrollable, one row. */}
      {categories.length > 0 && (
        <section className="border-b border-black/5 bg-white py-3">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
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

      {/* Discovery filters (Up Next default) + first live feed. */}
      <section className="py-5">
        <div className="mx-auto max-w-6xl">
          <div className="mb-3 px-4 sm:px-6">
            <h2 className="text-lg font-semibold tracking-tight text-ink">{upcomingSec.heading}</h2>
          </div>
          <HomeEventDiscovery
            upNext={upNextEvents}
            today={todayEvents}
            weekend={weekendEvents}
            anytime={anytimeEvents}
            popular={popularEvents}
          />
        </div>
      </section>

      {/* Featured Brands — logo-forward, moved up: "who is here?" comes
          right after "what's happening?". */}
      {featuredBrands.length > 0 && (
        <Section title={brandsSec.heading!} subtitle={brandsSec.body ?? undefined} viewAllHref={brandsSec.ctaUrl ?? undefined}>
          <HorizontalScroller>
            {featuredBrands.map((b) => (
              <div key={b.id} className="w-[38%] min-w-[136px] max-w-[168px] shrink-0 sm:w-44">
                <BusinessLogoCard business={b} />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {/* Business Showcase — "how can my business be here too?" — a
          compact phone-frame carousel demonstrating real FindMi UI. */}
      {showcase.visible && (
        <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="rounded-3xl border border-black/10 bg-white p-5 sm:p-8">
            <h2 className="font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
              {showcase.heading}
            </h2>
            <p className="mt-1 text-sm text-ink/60">{showcase.body}</p>
            <div className="mt-5">
              <BusinessShowcaseCarousel />
            </div>
            <div className="mt-5 flex justify-center sm:justify-start">
              <Link
                href={showcase.ctaUrl ?? "/join"}
                className="inline-flex items-center justify-center rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              >
                {showcase.ctaLabel}
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Shop Local — "what can I buy?" — real product architecture. */}
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

      {/* Explore By Category — compact, broader entry point (categories
          already appeared near the hero, so this stays small). */}
      {categories.length > 0 && (
        <section className="py-6">
          <div className="mx-auto max-w-6xl">
            <div className="mb-3 px-4 sm:px-6">
              <h2 className="text-lg font-semibold tracking-tight text-ink">{exploreSec.heading}</h2>
            </div>
            <div className="flex gap-2.5 overflow-x-auto px-4 pb-1 sm:flex-wrap sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

      {/* Final business CTA — stronger conversion moment near the bottom.
          Eyebrow/heading/body/cta are all founder-editable via Site
          Editor rather than hardcoded — see the report re: why this isn't
          bound to membership_plans.annual_price directly (the live
          founding-500 plan is currently a $1 test price, not $99). */}
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
