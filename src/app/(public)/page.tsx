import { Fragment } from "react";
import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import BusinessShowcaseCarousel from "@/components/BusinessShowcaseCarousel";
import DiscoveryTopics from "@/components/DiscoveryTopics";
import HomepageBusinessRow from "@/components/HomepageBusinessRow";
import HomeEventCard from "@/components/HomeEventCard";
import HomeWeather from "@/components/HomeWeather";
import Section, { HorizontalScroller } from "@/components/Section";
import HomeHero from "@/components/HomeHero";
import Logo from "@/components/Logo";
import SearchBar from "@/components/SearchBar";
import HomeEventDiscovery from "@/components/HomeEventDiscovery";
import SortSelect from "@/components/discover/SortSelect";
import {
  attachEventCategories,
  getActiveMarkets,
  getCategoriesForDynamicBusinessRow,
  getEventCategories,
  getFeaturedBusinesses,
  getHomeCategories,
  getNextAppearanceHints,
  getShowcaseBusiness,
  getUpcomingEvents,
} from "@/lib/data";
import { getVisibleHomepageRows, resolveHomepageRowItems, type HomepageRow } from "@/lib/homepage-rows";
import {
  getSiteSections,
  resolveSection,
  resolveDiscoveryTopics,
  resolveWeatherConfig,
  HOMEPAGE_SECTIONS,
} from "@/lib/site-sections";
import type { Category } from "@/lib/types";
import { getWeatherContext } from "@/lib/weather";

export const revalidate = 60;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string }>;
}) {
  const { market: marketSlug } = await searchParams;

  const [
    categories,
    eventCategories,
    upNextRaw,
    todayRaw,
    weekendRaw,
    anytimeRaw,
    heroFallbackBrands,
    homepageRows,
    siteSections,
    markets,
  ] = await Promise.all([
    getHomeCategories(), // BUSINESS categories — category pills + Explore By Category only, never events
    getEventCategories(), // EVENT categories — the event discovery filter only, see that function's note
    getUpcomingEvents(10, "anytime"), // "Up Next" — see HomeEventDiscovery's own note on this
    getUpcomingEvents(10, "now"),
    getUpcomingEvents(10, "weekend"),
    getUpcomingEvents(10, "anytime"), // "All Events" — same real chronological query as Up Next
    getFeaturedBusinesses(3), // hero collage fallback imagery only, see below — NEVER Market-filtered (editorial/decorative, see homepage-rows.ts's own note on curated content)
    getVisibleHomepageRows(),
    getSiteSections("homepage"), // one query for every fixed-section override — see lib/site-sections.ts
    getActiveMarkets(), // Homepage Market Filtering V1 — same public list /businesses already uses
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
  // lib/homepage-rows.ts. marketSlug is passed through unconditionally —
  // resolveHomepageRowItems itself only ever applies it to a DYNAMIC
  // "businesses" row (curated rows/business_showcase/events/products all
  // ignore it, per that function's own note).
  const resolvedRows = await Promise.all(homepageRows.map((row) => resolveHomepageRowItems(row, marketSlug)));

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

  // Discovery Topics — navigation-only shortcut row, founder-editable at
  // /admin/site/homepage (see lib/site-sections.ts). Already filtered to
  // visible topics with a real destination; renders nothing if the
  // founder hasn't configured any.
  const discoveryTopics = resolveDiscoveryTopics(siteSections);

  // Homepage order pass: Discovery Topics now mounts immediately after
  // the "Brands We Love" business carousel — identified by content
  // type (the first "businesses" Homepage Row), not by its founder-
  // editable title text, since that title isn't a stable key. Falls
  // back to rendering after every row if no businesses row exists at
  // all (e.g. the founder deleted it), so this never silently vanishes.
  const brandsRowIndex = homepageRows.findIndex((row) => row.content_type === "businesses");

  // Weather / Local Context — founder-configurable city (see
  // lib/site-sections.ts's resolveWeatherConfig); only fetched when the
  // founder has the module on, and lib/weather.ts fails soft (returns
  // null, or a result with `conditions: null`) rather than throwing, so a
  // provider outage never breaks the homepage.
  const weatherConfig = resolveWeatherConfig(siteSections);
  const weatherContext = weatherConfig.show ? await getWeatherContext(weatherConfig.city) : null;

  return (
    <div>
      {/* Weather / Local Context — position-only move: now sits directly
          below the header and above the Hero (was between Hero and
          Search). Renders nothing on its own if weather is off or
          unavailable. */}
      <HomeWeather context={weatherContext} />

      <HomeHero images={heroImages} heading={heroSec.heading} description={heroSec.body} />

      {/* Homepage Market Filtering V1 — compact, URL-only ("?market=",
          never persisted to a cookie/localStorage/session — see
          SortSelect's own note). Reuses that exact URL-param select
          component (already proven on /businesses for `sort`) rather than
          building a new one; "All Markets" is options[0], so picking it
          removes the param entirely. Scopes ONLY dynamic business
          discovery below (rows, category chips, search) — never events,
          products, appearances, or venues, which never read this param at
          all. Deliberately NOT in the global header — page-scoped only. */}
      {markets.length > 0 && (
        <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
          <SortSelect
            label="Market"
            paramName="market"
            options={[{ value: "", label: "All Markets" }, ...markets.map((m) => ({ value: m.slug, label: m.name }))]}
          />
        </div>
      )}

      {/* Discovery filters (Up Next default) + first live feed — heading
          is exactly "Upcoming Events Near You" (see HOMEPAGE_SECTIONS'
          featured_events default). Begins immediately after the Hero now
          (homepage order pass) — Search moved below this complete
          section (see below), so event cards are visible sooner. */}
      {/* Business Profile + Event Detail V2 polish pass, item 1: reuses
          Section's own header (title left, View All same line/vertically
          centered to it, smaller/underlined, subtitle-free here) instead
          of a page-specific hand-rolled header — the shared architecture
          this item asked for, not a one-off. */}
      <div className="mx-auto max-w-6xl">
        <Section title={upcomingSec.heading ?? HOMEPAGE_SECTIONS.featured_events.heading!} viewAllHref="/events">
          <HomeEventDiscovery
            upNext={upNextEvents}
            today={todayEvents}
            weekend={weekendEvents}
            anytime={anytimeEvents}
            eventCategories={eventCategories}
          />
        </Section>
      </div>

      {/* Search — homepage order pass: moved from right after the Hero
          to right after the complete Upcoming Events section (heading,
          filters, and event feed all above this now). Component/
          behavior/styling untouched. */}
      <section className="border-b border-black/5 bg-white px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto max-w-6xl">
          <SearchBar marketSlug={marketSlug} />
        </div>
      </section>

      {/* Founder-managed Homepage Rows — the central architectural change
          of this pass. Each row is a real database record (see
          /admin/site/homepage/rows): add/rename/edit/hide/reorder/delete
          without a code change, Businesses/Events/Products/Business
          Showcase, Dynamic (filtered) or Curated (hand-picked).
          Discovery Topics (homepage order pass) mounts immediately after
          the "Brands We Love" businesses row specifically — not after
          the whole list — via brandsRowIndex above; falls back to
          rendering after every row if no businesses row exists. */}
      {homepageRows.map((row, i) => (
        <Fragment key={row.id}>
          <HomepageRowSection row={row} resolved={resolvedRows[i]} marketSlug={marketSlug} />
          {i === brandsRowIndex && <DiscoveryTopics topics={discoveryTopics} />}
        </Fragment>
      ))}
      {brandsRowIndex === -1 && <DiscoveryTopics topics={discoveryTopics} />}

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
                  href={`/businesses?category=${c.slug}${marketSlug ? `&market=${encodeURIComponent(marketSlug)}` : ""}`}
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

async function HomepageRowSection({
  row,
  resolved,
  marketSlug,
}: {
  row: HomepageRow;
  resolved: Awaited<ReturnType<typeof resolveHomepageRowItems>>;
  /** Homepage Market Filtering V1 — only ever applied below for a
   * DYNAMIC "businesses" row (chip eligibility, View All link, and the
   * client-side re-filter route). Curated rows and every other content
   * type ignore it entirely, per LOCKED V1 policy. */
  marketSlug?: string;
}) {
  if (resolved.contentType === "business_showcase") {
    // Real demo business (The Native Rose) — fetched only when a
    // business_showcase row actually exists, not on every homepage load.
    // Falls back to illustrative markup inside the carousel itself if
    // this resolves to null (live-QA correction, Part 14).
    const demo = await getShowcaseBusiness();
    return (
      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="overflow-hidden rounded-3xl border border-findmi/15 bg-gradient-to-br from-findmi-50 via-white to-white p-5 sm:p-9">
          {/* Launch-polish pass item 7 — restrained FindMi brand mark on
              the business/brand promotional section, using the existing
              logo asset/component (no new asset, no full Homepage Builder
              editability). */}
          <Logo heightClassName="h-6" className="mb-3" />
          <h2 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">{row.title}</h2>
          {row.subtitle && <p className="mt-1.5 max-w-md text-sm text-ink/60">{row.subtitle}</p>}
          <div className="mt-5">
            <BusinessShowcaseCarousel demo={demo} />
          </div>
          <div className="mt-5 flex justify-center sm:justify-start">
            <Link
              href="/join"
              className="inline-flex items-center justify-center rounded-full bg-findmi px-6 py-3 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-findmi-600"
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
    // Chip list is scoped to THIS row's own filters — never the generic
    // homepage-wide category list — so a shown chip can never be a dead
    // end (live-QA fix pass; see getCategoriesForDynamicBusinessRow's own
    // note for the proven root cause this replaces). Curated rows derive
    // chips straight from the businesses actually in the row; dynamic
    // rows ask which categories have a business that would survive this
    // row's own featured_only/is_demo/publication_status rules.
    const isDynamic = row.mode !== "curated";
    const rowCategories = isDynamic
      ? await getCategoriesForDynamicBusinessRow(row.featured_only, marketSlug)
      : dedupeCategories(resolved.items.flatMap((b) => b.categories));
    // Bulk-fetched once per row (not once per card) via the same
    // appearances architecture /businesses already uses for its own card
    // hint (getNextAppearanceHints) — BusinessLogoCard's NEXT UP module,
    // visual polish pass item 2. Converted to a plain object since a Map
    // isn't how props normally cross the server/client boundary here.
    const appearanceHints = Object.fromEntries(
      await getNextAppearanceHints(resolved.items.map((b) => b.id))
    );
    // Homepage Market Filtering V1 — Market only ever propagates into
    // /businesses from a DYNAMIC row's View All link; a curated row
    // ignores Market for its own content (LOCKED V1 policy), so its View
    // All link stays exactly as it always was too — never implying the
    // curated set itself was Market-scoped.
    const viewAllHref = isDynamic && marketSlug ? `/businesses?market=${encodeURIComponent(marketSlug)}` : "/businesses";
    return (
      // Launch-polish pass item 2 — /businesses (Discovery/Archive V2) is
      // a real canonical destination regardless of this row's own
      // curated/dynamic filters, so every "businesses" row gets View All.
      <Section title={row.title} subtitle={row.subtitle ?? undefined} viewAllHref={viewAllHref}>
        <HomepageBusinessRow
          // Remounts (resetting its internal category cache/selection)
          // whenever the homepage's own Market changes — without this, a
          // previously-cached category's businesses could keep showing
          // stale results from the PRIOR Market after switching (the
          // component's cache is keyed only by category slug, not Market).
          key={`${row.id}-${marketSlug ?? "all"}`}
          rowId={row.id}
          initialItems={resolved.items}
          categories={rowCategories}
          appearanceHints={appearanceHints}
          marketSlug={isDynamic ? marketSlug : undefined}
        />
      </Section>
    );
  }

  if (resolved.contentType === "events") {
    return (
      <Section title={row.title} subtitle={row.subtitle ?? undefined} viewAllHref="/events">
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
    <Section title={row.title} subtitle={row.subtitle ?? undefined} viewAllHref="/marketplace">
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

function dedupeCategories(categories: Category[]): Category[] {
  const seen = new Map<string, Category>();
  for (const c of categories) if (!seen.has(c.id)) seen.set(c.id, c);
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}
