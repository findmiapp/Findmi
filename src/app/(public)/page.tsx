import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import BusinessShowcaseCarousel from "@/components/BusinessShowcaseCarousel";
import HomepageBusinessRow from "@/components/HomepageBusinessRow";
import HomeEventCard from "@/components/HomeEventCard";
import HomeWeather from "@/components/HomeWeather";
import Section, { HorizontalScroller } from "@/components/Section";
import HomeHero from "@/components/HomeHero";
import HomeEventDiscovery from "@/components/HomeEventDiscovery";
import AreaPicker from "@/components/discover/AreaPicker";
import {
  attachEventCategories,
  getCategoriesForDynamicBusinessRow,
  getConsumerVisibleMarketsWithAreas,
  getEventCategories,
  getFeaturedBusinesses,
  getHomeCategories,
  getMarketAreaLabel,
  getNextAppearanceHints,
  getUpcomingEvents,
} from "@/lib/data";
import { getVisibleHomepageRows, resolveHomepageRowItems, type HomepageRow } from "@/lib/homepage-rows";
import {
  getSiteSections,
  resolveHeroImageSlots,
  resolveSection,
  resolveWeatherConfig,
  HOMEPAGE_SECTIONS,
} from "@/lib/site-sections";
import type { Category } from "@/lib/types";
import { getWeatherContext } from "@/lib/weather";

export const revalidate = 60;

// Brands We Love admin-control pass — a "businesses" Homepage Row's
// title/subtitle come straight from homepage_rows (admin-editable at
// /admin/site/homepage/rows), which already guarantees a non-blank
// title at save time (see that route's saveHomepageRow action). These
// are a presentation-only safety net for the edge case anyway — never
// written back to the row — so this generic "businesses" row archetype
// never renders with a visibly blank heading/subtitle.
const BRANDS_ROW_HEADING_FALLBACK = "Brands We Love";
const BRANDS_ROW_SUBTITLE_FALLBACK = "Real businesses, worth discovering";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string; area?: string }>;
}) {
  const { market: marketSlug, area: areaSlugRaw } = await searchParams;
  // Market -> Area/Submarket Hierarchy V2 — ?area= is only ever meaningful
  // alongside ?market= (same contract as /businesses and /events).
  const areaSlug = marketSlug ? areaSlugRaw : undefined;

  const [
    categories,
    eventCategories,
    nextRaw,
    todayRaw,
    weekRaw,
    weekendRaw,
    allRaw,
    heroFallbackBrands,
    homepageRows,
    siteSections,
    markets,
  ] = await Promise.all([
    getHomeCategories(), // BUSINESS categories — category pills + Explore By Category only, never events
    getEventCategories(), // EVENT categories — the event discovery filter only, see that function's note
    // Consumer Event Market Filtering V1 — marketSlug scopes each window
    // by every candidate occurrence's EFFECTIVE physical Market (see
    // lib/event-markets.ts), never business Market entitlement. Absent =
    // today's unfiltered behavior, unchanged.
    getUpcomingEvents(10, "anytime", marketSlug, areaSlug), // "Next Up" — see HomeEventDiscovery's own note on this
    getUpcomingEvents(10, "now", marketSlug, areaSlug),
    getUpcomingEvents(10, "week", marketSlug, areaSlug), // Standardize Upcoming Event Time Filters pass — new "This Week" tab
    getUpcomingEvents(10, "weekend", marketSlug, areaSlug),
    getUpcomingEvents(10, "anytime", marketSlug, areaSlug), // "All" — same real chronological query as Next Up
    getFeaturedBusinesses(3), // hero collage fallback imagery only, see below — NEVER Market-filtered (editorial/decorative, see homepage-rows.ts's own note on curated content)
    getVisibleHomepageRows(),
    getSiteSections("homepage"), // one query for every fixed-section override — see lib/site-sections.ts
    getConsumerVisibleMarketsWithAreas(), // Consumer Area Picker V1/V2 — same public list /businesses already uses
  ]);

  const [nextEvents, todayEvents, weekEvents, weekendEvents, allEvents] = await Promise.all([
    attachEventCategories(nextRaw),
    attachEventCategories(todayRaw),
    attachEventCategories(weekRaw),
    attachEventCategories(weekendRaw),
    attachEventCategories(allRaw),
  ]);

  // Each row's content is resolved in parallel — one query per row
  // (dynamic mode) or a curated-id lookup (curated mode), same shared
  // query functions every other feed on the site already uses. See
  // lib/homepage-rows.ts. marketSlug is passed through unconditionally —
  // resolveHomepageRowItems itself only ever applies it to a DYNAMIC
  // "businesses" row (curated rows/business_showcase/events/products all
  // ignore it, per that function's own note).
  const resolvedRows = await Promise.all(homepageRows.map((row) => resolveHomepageRowItems(row, marketSlug, areaSlug)));

  // Founder Site Editor overrides for the structural sections that stay
  // fixed-position (hero, event discovery heading/copy, explore by
  // category, closing CTA) — every field falls back to the current
  // hardcoded default (HOMEPAGE_SECTIONS) when no row/field exists.
  //
  // Screenshot showcase pass — closing_cta (the black "GET DISCOVERED
  // TODAY" / "More Visibility..." block) is restored after a prior pass
  // removed its rendering; it was correctly identified as still desired
  // (the final business-conversion statement before the footer) and
  // restored using this exact existing implementation, not rebuilt.
  const resolve = (key: string) => resolveSection(siteSections, key, HOMEPAGE_SECTIONS[key]);
  const upcomingSec = resolve("featured_events");
  const exploreSec = resolve("explore_by_category");
  const closingSec = resolve("closing_cta");
  const heroSec = resolve("hero");

  // Homepage Hero Founder Control pass — Image 1 ("Large Image", the
  // large lower/left tile) and Image 2 ("Overlay Image", the smaller
  // upper-right tile) are now purely founder-controlled (Site Editor →
  // Hero), each with its own optional destination link and an
  // enabled/disabled toggle, and NEVER fall back to a Business/Event/
  // Product photo — a disabled or unconfigured slot is a real gap, not
  // a stand-in from platform content. Image 3 (desktop-only,
  // bottom-right) is unchanged from before: it still falls back to a
  // real photo already being fetched above when left unconfigured — it
  // isn't one of the two founder-named positions in this pass. Slot 0/1
  // are threaded through BY INDEX (never compacted), so turning one off
  // can never shift the other into its spot.
  const heroImageSlots = resolveHeroImageSlots(siteSections);
  const heroThirdSlotFallback = heroFallbackBrands[2]?.cover_image_url ?? undefined;
  const heroImages: Array<string | undefined> = [
    heroImageSlots[0]?.enabled && heroImageSlots[0].url ? heroImageSlots[0].url : undefined,
    heroImageSlots[1]?.enabled && heroImageSlots[1].url ? heroImageSlots[1].url : undefined,
    heroImageSlots[2]?.url ?? heroThirdSlotFallback,
  ];
  const heroImageLinks = [heroImageSlots[0]?.link, heroImageSlots[1]?.link];

  // Brands We Love fallback-copy gate — identified by content type (the
  // first "businesses" Homepage Row), not by its founder-editable title
  // text, since that title isn't a stable key. See isBrandsRow below
  // (HomepageRowSection): only that one row gets the "Brands We Love" /
  // "Real businesses, worth discovering" blank-copy fallback.
  //
  // Homepage discovery flow pass — this index previously also positioned
  // the "Food + Drink / Markets + Fairs / View All" Discovery Topics row
  // right after this one. That row is no longer rendered on the homepage
  // (see the report: its two category chips duplicated Explore By
  // Category below, and its "View All" duplicated the new Keep Exploring
  // section's role — see this pass's own report). Its component/CMS
  // config (site_sections "discovery_topics", /admin/site/homepage) is
  // completely untouched, just unused here now.
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

      <HomeHero images={heroImages} imageLinks={heroImageLinks} heading={heroSec.heading} description={heroSec.body} />

      {/* Consumer Discovery Homepage V2.1 — mobile density pass. The
          Area Picker no longer renders as its own isolated full-width
          band above this section (a real complaint from the live mobile
          review: one small pill consuming an entire visual row, with
          most of that row's width left blank). It now renders INSIDE
          this same Section, directly above the time filters — WHERE,
          then WHEN, then RESULTS, as one discovery control system
          instead of three unrelated homepage sections. AreaPicker's own
          component/behavior (real market/area data, ?market=/?area=
          query params, search) is completely untouched — only its call
          site moved. Section's own default "py-6" vertical rhythm is
          tightened here (pt-2, keeping pb-6) specifically for this one
          instance — Section's className prop exists for exactly this
          per-caller override (see its own doc comment) and no other
          Section caller is affected.
          Heading changed from "Upcoming Events Near You" to "What's
          Happening" (HOMEPAGE_SECTIONS.featured_events, verified not
          live-overridden) — this section has no geolocation signal at
          all, only an explicit Area filter the visitor chooses, so
          "Near You" claimed a proximity the product doesn't actually
          have. */}
      <div className="mx-auto max-w-6xl">
        <Section
          title={upcomingSec.heading ?? HOMEPAGE_SECTIONS.featured_events.heading!}
          className="pt-2 pb-6"
          // Consumer Event Market Filtering V1, item I — this section
          // represents general event browsing (never the curated/editorial
          // Featured Events concept — see getFeaturedEvents, untouched by
          // this pass), so its View All propagates the selected Market.
          viewAllHref={
            marketSlug
              ? `/events?market=${encodeURIComponent(marketSlug)}${areaSlug ? `&area=${encodeURIComponent(areaSlug)}` : ""}`
              : "/events"
          }
        >
          {markets.length > 0 && (
            <div className="mb-3 px-4 sm:px-6">
              <AreaPicker
                options={markets.map((m) => ({
                  slug: m.slug,
                  label: getMarketAreaLabel(m),
                  areasIncluded: m.areas_included,
                  areas: m.areas.map((a) => ({ slug: a.slug, label: a.display_name || a.name, aliases: a.aliases })),
                }))}
              />
            </div>
          )}
          <HomeEventDiscovery
            // Remounts (resetting its internal time×category cache) when
            // the homepage's own Market/Area changes — same lesson already
            // applied to HomepageBusinessRow's own cache below.
            key={`${marketSlug ?? "all"}-${areaSlug ?? "all"}`}
            next={nextEvents}
            today={todayEvents}
            week={weekEvents}
            weekend={weekendEvents}
            all={allEvents}
            eventCategories={eventCategories}
            marketSlug={marketSlug}
            areaSlug={areaSlug}
          />
        </Section>
      </div>

      {/* Homepage discovery flow pass — the homepage-body search field
          that used to sit here (between Upcoming Events and Brands We
          Love) is removed: the global/header search already covers this,
          and it left a large, redundant field between two discovery
          sections. SearchBar's component/API/global header search are
          completely untouched — this only stops this ONE page-body call
          site from rendering it. */}

      {/* Founder-managed Homepage Rows — each row is a real database
          record (see /admin/site/homepage/rows): add/rename/edit/hide/
          reorder/delete without a code change, Businesses/Events/
          Products/Business Showcase, Dynamic (filtered) or Curated
          (hand-picked). isBrandsRow (Brands We Love fallback copy) still
          targets brandsRowIndex exactly as before. */}
      {homepageRows.map((row, i) => (
        <HomepageRowSection
          key={row.id}
          row={row}
          resolved={resolvedRows[i]}
          marketSlug={marketSlug}
          areaSlug={areaSlug}
          isBrandsRow={i === brandsRowIndex}
        />
      ))}

      {/* Explore By Category — compact rail, existing category data/
          destinations untouched. Homepage discovery flow pass — pills
          switched from a rounded-2xl/px-4 py-3 "card" treatment to a
          rounded-full/px-4 py-2 pill (matching the same compact-pill
          pattern already used elsewhere on this page), and the section's
          own py-6 tightened to py-5, so this reads as a full, intentional
          rail rather than a few oversized controls surrounded by
          whitespace. Still the same horizontally-scrollable-on-mobile,
          wraps-on-sm: layout as before (that mechanic already existed);
          no new carousel, no data/query change. */}
      {categories.length > 0 && (
        <section className="py-5">
          <div className="mx-auto max-w-6xl">
            <div className="mb-3 px-4 sm:px-6">
              <h2 className="text-lg font-semibold tracking-tight text-ink">{exploreSec.heading}</h2>
            </div>
            <div className="flex gap-2 overflow-x-auto px-4 pb-1 sm:flex-wrap sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {categories.map((c) => (
                <Link
                  key={c.id}
                  href={`/businesses?category=${c.slug}${marketSlug ? `&market=${encodeURIComponent(marketSlug)}` : ""}${marketSlug && areaSlug ? `&area=${encodeURIComponent(areaSlug)}` : ""}`}
                  className="flex shrink-0 items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-findmi/50 hover:bg-findmi-50"
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Final business CTA — restored (screenshot-showcase pass) and now
          repositioned ABOVE Keep Exploring (homepage closing-flow pass):
          it's the strong, final business-conversion statement, so it
          belongs immediately after the remaining discovery/category
          content, closer to the footer than a plain links strip. Exact
          prior implementation, untouched — eyebrow/heading/body/cta are
          all founder-editable via Site Editor rather than hardcoded; only
          its position in the page moved. */}
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

      {/* Keep Exploring — homepage closing-flow pass: a compact, footer-
          adjacent navigation strip (not a section-sized block) — py-10/
          mt-3 tightened to py-4/mt-2, no other structural change. Plain
          links to the same canonical /businesses and /events destinations
          every "View all" on this page already uses — no new routes, no
          pricing/signup pitch, no redundant business-acquisition CTA
          (that job belongs to the product-demo module and the black CTA
          directly above). */}
      <section className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <p className="text-center text-xs font-bold uppercase tracking-wide text-ink/35">Keep exploring</p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
          <Link href="/businesses" className="text-sm font-semibold text-ink/70 underline underline-offset-2 hover:text-ink">
            Explore businesses →
          </Link>
          <Link href="/events" className="text-sm font-semibold text-ink/70 underline underline-offset-2 hover:text-ink">
            Explore events →
          </Link>
          <Link href="/locations" className="text-sm font-semibold text-ink/70 underline underline-offset-2 hover:text-ink">
            Explore locations →
          </Link>
        </div>
      </section>
    </div>
  );
}

async function HomepageRowSection({
  row,
  resolved,
  marketSlug,
  areaSlug,
  isBrandsRow,
}: {
  row: HomepageRow;
  resolved: Awaited<ReturnType<typeof resolveHomepageRowItems>>;
  /** Homepage Market Filtering V1 — only ever applied below for a
   * DYNAMIC "businesses" row (chip eligibility, View All link, and the
   * client-side re-filter route). Curated rows and every other content
   * type ignore it entirely, per LOCKED V1 policy. */
  marketSlug?: string;
  /** Browse Mode + Area-Aware Discovery pass — follows the exact same
   * DYNAMIC-"businesses"-row-only rule as marketSlug above (chip
   * eligibility, View All link). Curated rows and every other content
   * type ignore it entirely, same as Market. */
  areaSlug?: string;
  /** Brands We Love admin-control pass — true only for the same row
   * HomePage's own brandsRowIndex identifies (the first "businesses"
   * row). Gates the literal "Brands We Love"/"Real businesses, worth
   * discovering" blank-copy fallback below to that one row specifically
   * — a second "businesses" row the founder adds later keeps today's
   * plain behavior (blank subtitle just hides the subtitle line) rather
   * than silently inheriting Brands We Love's own fallback copy. */
  isBrandsRow?: boolean;
}) {
  if (resolved.contentType === "business_showcase") {
    // Homepage Business Acquisition Section Rebuild pass — this section no
    // longer fetches/depends on live business data at all: it shows real,
    // static screenshots (see BusinessShowcaseCarousel's own note) rather
    // than a data-driven UI approximation, so there's nothing to fetch or
    // null-check here anymore. Outer card styling (white/pale-aqua
    // gradient, restrained border, rounded-3xl) is unchanged; only the
    // copy hierarchy and CTA label changed (see this pass's own report).
    return (
      <section className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <div className="overflow-hidden rounded-3xl border border-findmi/15 bg-gradient-to-br from-findmi-50 via-white to-white p-4 sm:p-6">
          <h2 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">{row.title}</h2>
          {row.subtitle && <p className="mt-1.5 max-w-md text-sm text-ink/60">{row.subtitle}</p>}
          <div className="mt-4">
            <BusinessShowcaseCarousel />
          </div>
          <div className="mt-4 flex justify-center sm:justify-start">
            <Link
              href="/join"
              className="inline-flex items-center justify-center rounded-full bg-findmi px-6 py-3 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-findmi-600"
            >
              Create your Findmi page
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
      ? await getCategoriesForDynamicBusinessRow(row.featured_only, marketSlug, areaSlug)
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
    //
    // Homepage category View All fix (Browse Mode pass) — a category-
    // scoped DYNAMIC row previously dropped its own category_slug here
    // entirely (View All landed on the whole unfiltered directory, or
    // just Market-scoped, never the row's own category) even though
    // getHomepageRowBusinesses/the chip list above already apply it
    // correctly. Now builds the same market/area/category query
    // /businesses' own filters and chips already use, so View All always
    // preserves the row's actual scope. Area only ever accompanies
    // Market, same convention as everywhere else this pattern appears.
    const viewAllHref = (() => {
      if (!isDynamic) return "/businesses";
      const p = new URLSearchParams();
      if (row.category_slug) p.set("category", row.category_slug);
      if (marketSlug) p.set("market", marketSlug);
      if (marketSlug && areaSlug) p.set("area", areaSlug);
      return `/businesses${p.toString() ? `?${p.toString()}` : ""}`;
    })();
    return (
      // Launch-polish pass item 2 — /businesses (Discovery/Archive V2) is
      // a real canonical destination regardless of this row's own
      // curated/dynamic filters, so every "businesses" row gets View All.
      <Section
        title={isBrandsRow ? row.title || BRANDS_ROW_HEADING_FALLBACK : row.title}
        subtitle={(isBrandsRow ? row.subtitle || BRANDS_ROW_SUBTITLE_FALLBACK : row.subtitle) ?? undefined}
        // Consumer Discovery Homepage V2 — Brands We Love specifically
        // (never any other founder-added "businesses" row) reads as a
        // discovery moment rather than a plain row. Underlying selection/
        // ordering rules (is_featured/founding_member tiering, shuffle
        // within tier only) are completely untouched — this is a label
        // only, see shuffleWithinFeaturedTiers in lib/data.ts.
        eyebrow={isBrandsRow ? "Discover" : undefined}
        viewAllHref={viewAllHref}
        impressionPayload={{
          event_name: "discovery_section_impression",
          discovery_page_id: row.page_id,
          discovery_section_id: row.id,
          page_type: "home",
          page_path: "/",
          metadata: { content_type: row.content_type, mode: row.mode },
        }}
      >
        <HomepageBusinessRow
          // Remounts (resetting its internal category cache/selection)
          // whenever the homepage's own Market changes — without this, a
          // previously-cached category's businesses could keep showing
          // stale results from the PRIOR Market after switching (the
          // component's cache is keyed only by category slug, not Market).
          key={`${row.id}-${marketSlug ?? "all"}`}
          rowId={row.id}
          pageId={row.page_id}
          contentType={row.content_type ?? "businesses"}
          mode={row.mode}
          pinnedIds={row.pinned_ids}
          initialItems={resolved.items}
          categories={rowCategories}
          appearanceHints={appearanceHints}
          marketSlug={isDynamic ? marketSlug : undefined}
        />
      </Section>
    );
  }

  if (resolved.contentType === "events") {
    // Consumer Event Market Filtering V1 — resolveHomepageRowItems only
    // ever applies marketSlug to this row's content in DYNAMIC mode (see
    // that function's own note); View All must match, so a curated row's
    // link never implies its hand-picked set was Market-scoped, exactly
    // the same isDynamic-gated pattern the "businesses" branch above uses.
    const isDynamicEvents = row.mode !== "curated";
    const eventsViewAllHref =
      isDynamicEvents && marketSlug ? `/events?market=${encodeURIComponent(marketSlug)}` : "/events";
    return (
      <Section
        title={row.title}
        subtitle={row.subtitle ?? undefined}
        viewAllHref={eventsViewAllHref}
        impressionPayload={{
          event_name: "discovery_section_impression",
          discovery_page_id: row.page_id,
          discovery_section_id: row.id,
          page_type: "home",
          page_path: "/",
          metadata: { content_type: row.content_type, mode: row.mode },
        }}
      >
        <HorizontalScroller>
          {resolved.items.map((e, i) => (
            <div key={e.id} className="w-[74vw] max-w-[320px] shrink-0 sm:w-72">
              <HomeEventCard
                event={e}
                analyticsContext={{
                  pageType: "home",
                  placement: "homepage_row",
                  discoveryPageId: row.page_id,
                  discoverySectionId: row.id,
                  sectionContentType: row.content_type ?? undefined,
                  sectionMode: row.mode,
                  origin: row.mode === "hybrid" ? (row.pinned_ids.includes(e.id) ? "pinned" : "auto") : undefined,
                  position: i + 1,
                }}
              />
            </div>
          ))}
        </HorizontalScroller>
      </Section>
    );
  }

  // products
  return (
    <Section
      title={row.title}
      subtitle={row.subtitle ?? undefined}
      viewAllHref="/marketplace"
      impressionPayload={{
        event_name: "discovery_section_impression",
        discovery_page_id: row.page_id,
        discovery_section_id: row.id,
        page_type: "home",
        page_path: "/",
        metadata: { content_type: row.content_type, mode: row.mode },
      }}
    >
      <HorizontalScroller>
        {resolved.items.map((p, i) => (
          <div key={p.id} className="w-[42%] min-w-[150px] max-w-[176px] shrink-0 sm:w-44">
            <ProductCard
              product={p}
              analyticsContext={{
                pageType: "home",
                placement: "homepage_row",
                discoveryPageId: row.page_id,
                discoverySectionId: row.id,
                sectionContentType: row.content_type ?? undefined,
                sectionMode: row.mode,
                origin: row.mode === "hybrid" ? (row.pinned_ids.includes(p.id) ? "pinned" : "auto") : undefined,
                position: i + 1,
              }}
            />
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
