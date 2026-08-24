import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import BusinessLogoCard from "@/components/BusinessLogoCard";
import BusinessShowcaseCarousel from "@/components/BusinessShowcaseCarousel";
import HomeEventCard from "@/components/HomeEventCard";
import Section, { HorizontalScroller } from "@/components/Section";
import HomeHero from "@/components/HomeHero";
import SearchBar from "@/components/SearchBar";
import HomeEventDiscovery from "@/components/HomeEventDiscovery";
import { attachEventCategories, getFeaturedBusinesses, getHomeCategories, getUpcomingEvents } from "@/lib/data";
import { getVisibleHomepageRows, resolveHomepageRowItems, type HomepageRow } from "@/lib/homepage-rows";
import { getSiteSections, resolveSection, HOMEPAGE_SECTIONS } from "@/lib/site-sections";

export const revalidate = 60;

export default async function HomePage() {
  const [categories, upNextRaw, todayRaw, weekendRaw, anytimeRaw, heroFallbackBrands, homepageRows, siteSections] =
    await Promise.all([
      getHomeCategories(),
      getUpcomingEvents(10, "anytime"), // "Up Next" — see HomeEventDiscovery's own note on this
      getUpcomingEvents(10, "now"),
      getUpcomingEvents(10, "weekend"),
      getUpcomingEvents(10, "anytime"), // "All Events" — same real chronological query as Up Next
      getFeaturedBusinesses(3), // hero collage fallback imagery only, see below
      getVisibleHomepageRows(),
      getSiteSections("homepage"), // one query for every fixed-section override — see lib/site-sections.ts
    ]);

  const [upNextEvents, todayEvents, weekendEvents, anytimeEvents] = await Promise.all([
    attachEventCategories(upNextRaw),
    attachEventCategories(todayRaw),
    attachEventCategories(weekendRaw),
    attachEventCategories(anytimeRaw),
  ]);

  // Each row's content is resolved in parallel — one query per row
  // (dynamic mode) or a curated-id lookup (curated mode), same shared
  // query functions every other feed on the site already uses. See
  // lib/homepage-rows.ts.
  const resolvedRows = await Promise.all(homepageRows.map((row) => resolveHomepageRowItems(row)));

  // Founder Site Editor overrides for the structural sections that stay
  // fixed-position (hero, event discovery heading/copy, explore by
  // category, closing CTA) — every field falls back to the current
  // hardcoded default (HOMEPAGE_SECTIONS) when no row/field exists.
  const resolve = (key: string) => resolveSection(siteSections, key, HOMEPAGE_SECTIONS[key]);
  const upcomingSec = resolve("featured_events");
  const exploreSec = resolve("explore_by_category");
  const closingSec = resolve("closing_cta");
  const heroSec = resolve("hero");

  // Hero collage — founder-configured images (Site Editor → Hero → Image
  // 1/2/3) take priority; any unconfigured slot falls back to a real
  // photo already being fetched above (never stock/decorative imagery,
  // never fabricated). With zero of either, no collage renders.
  const fallbackImages = [
    heroFallbackBrands[0]?.cover_image_url,
    heroFallbackBrands[1]?.cover_image_url,
    heroFallbackBrands[2]?.cover_image_url,
  ].filter((src): src is string => Boolean(src));
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

      {/* Discovery filters (Up Next default) + first live feed — heading
          is exactly "Upcoming Events Near You" (see HOMEPAGE_SECTIONS'
          featured_events default). */}
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
            categories={categories}
          />
        </div>
      </section>

      {/* Founder-managed Homepage Rows — the central architectural change
          of this pass. Each row is a real database record (see
          /admin/site/homepage/rows): add/rename/edit/hide/reorder/delete
          without a code change, Businesses/Events/Products/Business
          Showcase, Dynamic (filtered) or Curated (hand-picked). */}
      {homepageRows.map((row, i) => (
        <HomepageRowSection key={row.id} row={row} resolved={resolvedRows[i]} />
      ))}

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

function HomepageRowSection({
  row,
  resolved,
}: {
  row: HomepageRow;
  resolved: Awaited<ReturnType<typeof resolveHomepageRowItems>>;
}) {
  if (resolved.contentType === "business_showcase") {
    return (
      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="rounded-3xl border border-black/10 bg-white p-5 sm:p-8">
          <h2 className="font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">{row.title}</h2>
          {row.subtitle && <p className="mt-1 text-sm text-ink/60">{row.subtitle}</p>}
          <div className="mt-5">
            <BusinessShowcaseCarousel />
          </div>
          <div className="mt-5 flex justify-center sm:justify-start">
            <Link
              href="/join"
              className="inline-flex items-center justify-center rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
            >
              Join FindMi →
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (resolved.items.length === 0) return null;

  if (resolved.contentType === "businesses") {
    return (
      <Section title={row.title} subtitle={row.subtitle ?? undefined}>
        <HorizontalScroller>
          {resolved.items.map((b) => (
            <div key={b.id} className="w-[85%] max-w-sm shrink-0 sm:w-96">
              <BusinessLogoCard business={b} />
            </div>
          ))}
        </HorizontalScroller>
      </Section>
    );
  }

  if (resolved.contentType === "events") {
    return (
      <Section title={row.title} subtitle={row.subtitle ?? undefined}>
        <HorizontalScroller>
          {resolved.items.map((e) => (
            <div key={e.id} className="w-[74vw] max-w-[320px] shrink-0 sm:w-72">
              <HomeEventCard event={e} />
            </div>
          ))}
        </HorizontalScroller>
      </Section>
    );
  }

  // products
  return (
    <Section title={row.title} subtitle={row.subtitle ?? undefined}>
      <HorizontalScroller>
        {resolved.items.map((p) => (
          <div key={p.id} className="w-[42%] min-w-[150px] max-w-[176px] shrink-0 sm:w-44">
            <ProductCard product={p} />
          </div>
        ))}
      </HorizontalScroller>
    </Section>
  );
}
