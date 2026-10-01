import Link from "next/link";
import HomepageBusinessRow from "@/components/HomepageBusinessRow";
import HomeEventCard from "@/components/HomeEventCard";
import HomeWeather from "@/components/HomeWeather";
import HomeHero from "@/components/HomeHero";
import HomepageBulletinCarousel from "@/components/HomepageBulletinCarousel";
import BusinessShowcaseCarousel from "@/components/BusinessShowcaseCarousel";
import Section, { HorizontalScroller } from "@/components/Section";
import SearchBar from "@/components/SearchBar";
import AreaPicker from "@/components/discover/AreaPicker";
import FeaturedLocationCard from "@/components/discover/FeaturedLocationCard";
import HomeTimeFilterRail from "@/components/HomeTimeFilterRail";
import {
  attachEventCategories,
  getBusinessGalleryImagesMap,
  getCategoriesForDynamicBusinessRow,
  getConsumerVisibleMarketsWithAreas,
  getFeaturedBusinesses,
  getFeaturedLocations,
  getMarketAreaLabel,
  getUpcomingAppearanceHints,
  getUpcomingEvents,
} from "@/lib/data";
import { getPublishedHomepageBulletins } from "@/lib/homepage-bulletins";
import { getVisibleHomepageRows, resolveHomepageRowItems, type HomepageRow } from "@/lib/homepage-rows";
import {
  getSiteSections,
  resolveHeroImageSlots,
  resolveSection,
  resolveWeatherConfig,
  HOMEPAGE_SECTIONS,
} from "@/lib/site-sections";
import { DISCOVERY_TIME_TABS, WINDOW_BY_TIME_KEY, type DiscoveryTimeKey } from "@/lib/format";
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

// Homepage Section Header Typography Consistency pass — the exact
// effective title/description classes the "What's Happening" heading
// already uses below (font-display text-2xl/3xl font-bold + text-sm/60
// body), reused verbatim as Section's scoped titleClassName/
// subtitleClassName override for the homepage's other major sections
// (Brands We Love, Featured Locations) and the profile-preview intro
// block, so all four read as peer-level section headings on this page.
// Section.tsx's own defaults are untouched — every other page's Section
// usage keeps today's smaller text-lg/text-sm treatment exactly as-is.
const HOMEPAGE_SECTION_TITLE_CLASS = "font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl";
const HOMEPAGE_SECTION_SUBTITLE_CLASS = "mt-1 text-sm text-ink/60";

// Homepage Content Priority pass — same real example business /join's own
// Native Rose Showcase section uses (see PROOF_BUSINESS_SLUG there).
const NATIVE_ROSE_SLUG = "the-native-rose";
// Homepage Live Profile CTA Micro-Polish pass — this showcase has no
// fetched business object (BusinessShowcaseCarousel is static real
// screenshots, see its own comment), so there's no business.name already
// in this page's data path to reuse for the CTA copy. Deriving the
// display name from the existing slug constant (rather than a second,
// independent hardcoded string) keeps the CTA's name tied to whichever
// business NATIVE_ROSE_SLUG actually points to, without adding a new
// query just to read one business's name.
const NATIVE_ROSE_NAME = NATIVE_ROSE_SLUG.split("-")
  .map((word) => word[0].toUpperCase() + word.slice(1))
  .join(" ");

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string; area?: string; when?: string }>;
}) {
  const { market: marketSlug, area: areaSlugRaw, when: whenRaw } = await searchParams;
  // Market -> Area/Submarket Hierarchy V2 — ?area= is only ever meaningful
  // alongside ?market= (same contract as /businesses and /events).
  const areaSlug = marketSlug ? areaSlugRaw : undefined;
  // Public Experience Consolidation pass — same canonical time-filter
  // vocabulary /events already uses (lib/format.ts's DISCOVERY_TIME_TABS/
  // WINDOW_BY_TIME_KEY), reused verbatim rather than inventing a second
  // definition. Defaults to "next" (Up Next), same default /events uses.
  const timeKey: DiscoveryTimeKey = DISCOVERY_TIME_TABS.some((t) => t.key === whenRaw)
    ? (whenRaw as DiscoveryTimeKey)
    : "next";

  // Visual Regression Correction — back to the single getUpcomingEvents
  // call (occurrence override applied internally) now that Home no longer
  // needs each row's raw `occurrence`/`occurrenceLocation` for a homepage
  // anchor (see the removed ConnectionCard section below). The
  // occurrence-aware helpers themselves (getEffectiveUpcomingEvents,
  // applyOccurrenceOverride, getBusinessesForEvent,
  // getOccurrenceBusinessRosters) are untouched in lib/data.ts — this page
  // simply doesn't need their extra detail anymore.
  const [nextRaw, heroFallbackBrands, homepageRows, siteSections, markets, featuredLocations, bulletins] = await Promise.all([
    getUpcomingEvents(10, WINDOW_BY_TIME_KEY[timeKey], marketSlug, areaSlug),
    getFeaturedBusinesses(3), // hero collage fallback imagery only, see below — NEVER Market-filtered (editorial/decorative, see homepage-rows.ts's own note on curated content)
    getVisibleHomepageRows(),
    getSiteSections("homepage"), // one query for every fixed-section override — see lib/site-sections.ts
    getConsumerVisibleMarketsWithAreas(), // Consumer Area Picker V1/V2 — same public list /businesses already uses
    getFeaturedLocations(8), // Public Experience Consolidation pass — Featured Locations carousel
    getPublishedHomepageBulletins(), // Homepage Bulletin Carousel — every published editorial announcement, ordered for display
  ]);

  const nextEvents = await attachEventCategories(nextRaw);

  // Each row's content is resolved in parallel — one query per row
  // (dynamic mode) or a curated-id lookup (curated mode), same shared
  // query functions every other feed on the site already uses. See
  // lib/homepage-rows.ts.
  const resolvedRows = await Promise.all(homepageRows.map((row) => resolveHomepageRowItems(row, marketSlug, areaSlug)));

  // Brands We Love — identified by content type (the first "businesses"
  // row), not by its founder-editable title text, since that title isn't
  // a stable key. Pulled out of the generic founder-rows loop below so it
  // can anchor this pass's "where can I actually find it" moment
  // specifically, using its exact existing selection/ordering logic
  // (is_featured/founding_member tiering, shuffle within tier only — see
  // shuffleWithinFeaturedTiers in lib/data.ts) and its exact existing
  // uniform-card-width fix, completely untouched.
  const brandsRowIndex = homepageRows.findIndex((row) => row.content_type === "businesses");

  // Any OTHER founder-managed row — neither the products rail above nor
  // the Brands We Love row pulled out below. Rare in practice (e.g. a
  // second "events" content-type row), rendered exactly as before.
  const otherRowIndices: number[] = [];
  homepageRows.forEach((row, i) => {
    if (row.content_type === "products") return;
    if (i === brandsRowIndex) return;
    otherRowIndices.push(i);
  });

  // Founder Site Editor overrides for the structural sections that stay
  // fixed-position (hero, event discovery heading/copy, closing CTA) —
  // every field falls back to the current hardcoded default
  // (HOMEPAGE_SECTIONS) when no row/field exists.
  const resolve = (key: string) => resolveSection(siteSections, key, HOMEPAGE_SECTIONS[key]);
  const upcomingSec = resolve("featured_events");
  const closingSec = resolve("closing_cta");
  const heroSec = resolve("hero");
  const businessDoorwaySec = resolve("business_doorway");

  // Homepage Hero Founder Control pass — Image 1 ("Large Image") and
  // Image 2 ("Overlay Image") are purely founder-controlled (Site Editor
  // -> Hero), each with its own optional destination link and an
  // enabled/disabled toggle, and NEVER fall back to a Business/Event/
  // Product photo. Image 3 (desktop-only, bottom-right) still falls back
  // to a real photo already being fetched above when left unconfigured.
  // Slot 0/1 are threaded through BY INDEX (never compacted), so turning
  // one off can never shift the other into its spot. Restored verbatim
  // from the pre-Consumer-V1 baseline (commit b263d56) — this pass only
  // tightened the mobile hero's own internal spacing (see HomeHero.tsx).
  const heroImageSlots = resolveHeroImageSlots(siteSections);
  const heroThirdSlotFallback = heroFallbackBrands[2]?.cover_image_url ?? undefined;
  const heroImages: Array<string | undefined> = [
    heroImageSlots[0]?.enabled && heroImageSlots[0].url ? heroImageSlots[0].url : undefined,
    heroImageSlots[1]?.enabled && heroImageSlots[1].url ? heroImageSlots[1].url : undefined,
    heroImageSlots[2]?.url ?? heroThirdSlotFallback,
  ];
  const heroImageLinks = [heroImageSlots[0]?.link, heroImageSlots[1]?.link];

  // Weather / Local Context — founder-configurable city; only fetched
  // when the founder has the module on, and lib/weather.ts fails soft
  // (returns null, or a result with `conditions: null`) rather than
  // throwing, so a provider outage never breaks the homepage.
  const weatherConfig = resolveWeatherConfig(siteSections);
  const weatherContext = weatherConfig.show ? await getWeatherContext(weatherConfig.city) : null;

  return (
    <div>
      {/* Weather / Local Context — unchanged, directly below the header. */}
      <HomeWeather context={weatherContext} />

      {/* Visual Regression Correction — the illy/founder image-collage hero
          restored verbatim from commit b263d56 (do not re-approximate; see
          HomeHero.tsx for the exact markup, which this pass only tightened
          the mobile vertical spacing of). Copy is whatever the founder has
          configured in Site Editor -> Hero (heroSec.heading/body) — this
          page never hardcodes it. */}
      <HomeHero images={heroImages} imageLinks={heroImageLinks} heading={heroSec.heading} description={heroSec.body} />

      {/* Business Acquisition doorway — content/behavior unchanged; a
          Above-the-Fold Polish pass tightened this to a compact utility
          line (py-1.5, was pb-1/pt-3) so it reads as one quiet row
          between the hero and Search rather than its own spaced-out
          section. */}
      {businessDoorwaySec.visible && (
        <div className="mx-auto max-w-6xl px-4 py-1.5 sm:px-6">
          <Link
            href={businessDoorwaySec.ctaUrl ?? "/join"}
            className="inline-flex flex-wrap items-baseline gap-1 text-sm text-ink/50 transition hover:text-ink/70"
          >
            <span>{businessDoorwaySec.heading}</span>
            <span className="font-semibold text-ink underline decoration-ink/25 underline-offset-2">
              {businessDoorwaySec.ctaLabel}
            </span>
          </Link>
        </div>
      )}

      {/* Homepage Bulletin Carousel — one or more admin-managed editorial
          announcements (see /admin/bulletins). Final Above-the-Fold pass
          moved this ABOVE Search (was below) per live mobile QA — same
          position in this stack, same HomepageBulletin card design;
          HomepageBulletinCarousel only owns rotation when 2+ are
          published. Renders nothing (no gap) when none is published. */}
      {bulletins.length > 0 && (
        <div className="mx-auto max-w-6xl px-4 pt-2 sm:px-6">
          <HomepageBulletinCarousel bulletins={bulletins} />
        </div>
      )}

      {/* Search — behavior/route/sizing unchanged; only its position
          (now after the Bulletin, was before) and this local top padding
          moved, so it reads as related to but distinct from the
          Bulletin above it. */}
      <div className="mx-auto max-w-6xl px-4 pt-3 sm:px-6">
        <SearchBar marketSlug={marketSlug} placeholder="Search anything you're into…" />
      </div>

      {/* Public Experience Consolidation pass — "Must Dos" eyebrow removed
          (the heading itself, "What's Happening", already says what this
          is — an eyebrow above it read as a competing claim, not a real
          product tier). Select Area stays a static, independently-anchored
          control; the time filters to its right are now the shared
          DISCOVERY_TIME_TABS/WINDOW_BY_TIME_KEY vocabulary /events already
          uses (Up Next/Today/This Week/This Weekend/All), as ?when= links
          on THIS SAME page (server-rendered, no client fetch, no duplicate
          filtering system) rather than the previous two ad hoc Today/This
          Weekend links out to /discover. Above-the-Fold Polish pass
          tightened pt-6→pt-4 (this section only — no other homepage
          section spacing changed) so the Bulletin visibly bridges into
          What's Happening instead of leaving what read as an empty gap.
          Final correction pass tightened pt-4→pt-2 (Search→What's
          Happening gap only) and switched this row from items-end to
          items-center — "View all" (text-xs) was sitting low against the
          much larger font-display heading under bottom-edge alignment;
          centering the two removes the mismatch without touching either
          one's typography, and the pb-1 hack that previously compensated
          for it is no longer needed. */}
      <div className="mx-auto max-w-6xl pt-2">
        <div className="px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {upcomingSec.heading ?? HOMEPAGE_SECTIONS.featured_events.heading!}
            </h2>
            <Link
              href={
                marketSlug
                  ? `/events?market=${encodeURIComponent(marketSlug)}${areaSlug ? `&area=${encodeURIComponent(areaSlug)}` : ""}`
                  : "/events"
              }
              className="shrink-0 text-xs font-semibold text-ink/55 underline decoration-ink/25 underline-offset-4 transition hover:text-ink hover:decoration-ink/50"
            >
              View all
            </Link>
          </div>
          {upcomingSec.body && <p className="mt-1 text-sm text-ink/60">{upcomingSec.body}</p>}
          <div className="mt-3 flex items-center gap-2">
            {markets.length > 0 && (
              <div className="shrink-0">
                <AreaPicker
                  unselectedLabel="Select Area"
                  options={markets.map((m) => ({
                    slug: m.slug,
                    label: getMarketAreaLabel(m),
                    areasIncluded: m.areas_included,
                    areas: m.areas.map((a) => ({ slug: a.slug, label: a.display_name || a.name, aliases: a.aliases })),
                  }))}
                />
              </div>
            )}
            <HomeTimeFilterRail activeKey={timeKey} marketSlug={marketSlug} areaSlug={areaSlug} />
          </div>
        </div>
        {nextEvents.length > 0 && (
          <div className="mt-4">
            <HorizontalScroller>
              {nextEvents.slice(0, 6).map((event, i) => (
                <div key={event.id} className="w-[80vw] max-w-[330px] shrink-0 sm:w-72">
                  <HomeEventCard
                    event={event}
                    analyticsContext={{ pageType: "home", placement: "homepage_happening", position: i + 1 }}
                  />
                </div>
              ))}
            </HorizontalScroller>
          </div>
        )}
      </div>

      {/* Homepage Section Reorder pass — BRANDS WE LOVE, second major row,
          right after What's Happening. Same existing row/component,
          completely untouched logic and geometry (protected width fix) —
          placement only. */}
      {brandsRowIndex !== -1 && (
        <HomepageRowSection
          row={homepageRows[brandsRowIndex]}
          resolved={resolvedRows[brandsRowIndex]}
          marketSlug={marketSlug}
          areaSlug={areaSlug}
          isBrandsRow
        />
      )}

      {/* Horizontal Location Carousel pass — FEATURED LOCATIONS, third major
          row. Same data path as before (getFeaturedLocations/lib/data.ts —
          still filters to Locations with at least one real upcoming
          happening; untouched), but a new dedicated card
          (FeaturedLocationCard) and a bespoke outer rail instead of the
          generic Section.tsx HorizontalScroller/RailItem — this section's
          card is now a SHORT, WIDE, horizontally-split [location photo |
          events rail] shape, not the tall vertical grid card
          LocationDiscoveryCard still owns unmodified for /locations and
          /discover. Deliberately not built on RailItem's fixed vw-based
          density tokens: those size a card as a fraction of the VIEWPORT
          (tuned for a uniform vertical card), where this rail instead
          targets a fraction of the CONTAINER for the common multi-event
          case (flex-[0_0_90%], shrinking on larger breakpoints) while
          letting a one-event card size to its own content instead — see
          FeaturedLocationCard's own note on why. The peek of the next
          Location card this leaves at the right edge is the rail's own
          swipe affordance; pagination dots were never part of this rail
          and still aren't added. */}
      {featuredLocations.length > 0 && (
        <Section
          title="Featured Locations"
          subtitle="Places with something happening soon."
          viewAllHref="/locations"
          titleClassName={HOMEPAGE_SECTION_TITLE_CLASS}
          subtitleClassName={HOMEPAGE_SECTION_SUBTITLE_CLASS}
        >
          <div className="flex gap-4 overflow-x-auto px-4 pb-2 snap-x snap-mandatory [overflow-anchor:none] sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {featuredLocations.map((location) => (
              <FeaturedLocationCard
                key={location.id}
                location={location}
                analyticsContext={{ pageType: "home", placement: "homepage_featured_locations" }}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Homepage Content Priority pass — NATIVE ROSE DEMO, fourth and
          final major row (Homepage Section Reorder pass — now after
          Featured Locations, was second): what a real Findmi business
          presence looks like. Reuses BusinessShowcaseCarousel unmodified
          (same real screenshots, same component /join already uses)
          rather than a new UI — see that component's own comment.
          Supporting copy also reused verbatim from /join's own Native Rose
          Showcase section.
          Heading Alignment pass — the intro heading/copy above the
          carousel used to render as a centered, small gray uppercase
          eyebrow, reading as decoration rather than a real section title.
          Restyled (left-aligned) so it reads as a real section heading,
          not a separate visual language.
          Homepage Section Header Typography Consistency pass — that first
          restyle still landed noticeably smaller/lighter than "What's
          Happening" above it (Section.tsx's own default text-lg/text-sm
          treatment, not What's Happening's larger font-display text-2xl/
          3xl font-bold + text-sm/60 body). Now uses the same
          HOMEPAGE_SECTION_TITLE_CLASS/HOMEPAGE_SECTION_SUBTITLE_CLASS
          constants passed to Brands We Love/Featured Locations' own
          Section calls above, so all four read as peer-scale headings.
          Top padding stays pt-6/sm:pt-8 to match the ~py-6 rhythm between
          the Section-based rows above. Carousel and "View live profile"
          CTA below are unchanged (still centered) — only the intro
          block's typography changed. */}
      <div className="mx-auto max-w-4xl px-4 pt-6 sm:px-6 sm:pt-8">
        <h2 className={HOMEPAGE_SECTION_TITLE_CLASS}>See Your Business on Findmi</h2>
        <p className={`${HOMEPAGE_SECTION_SUBTITLE_CLASS} max-w-md`}>
          Your profile brings together who you are, what you offer and where you&rsquo;ll be next.
        </p>
        <div className="mt-4">
          <BusinessShowcaseCarousel />
        </div>
        <div className="mt-3 flex justify-start">
          {/* Small Public UI Polish pass — was a bare text link, reading as
              visually unfinished in the whitespace above the black JOIN
              FINDMI card. Now the same pale-Aqua "soft highlight panel"
              pill treatment used elsewhere (border-findmi/30 + bg-findmi-50
              + text-findmi-700 — see CLAUDE.md's design-system notes on
              that combination), so it reads as a real, compact secondary
              CTA without competing with the black card beneath it. Same
              destination/behavior, unchanged.
              Homepage Live Profile CTA Micro-Polish pass — left-aligned
              (was centered) to sit naturally with the left-aligned section
              heading/copy above it; still a compact pill, not full width.
              Copy now names the business (NATIVE_ROSE_NAME, derived from
              the existing slug — see its own comment) instead of the
              generic "live profile". */}
          <a
            href={`/business/${NATIVE_ROSE_SLUG}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-findmi/30 bg-findmi-50 px-4 py-2 text-sm font-semibold text-findmi-700 transition hover:border-findmi/50 hover:bg-findmi-100"
          >
            View {NATIVE_ROSE_NAME} Live Profile <span aria-hidden>→</span>
          </a>
        </div>
      </div>

      {/* Public Experience Consolidation pass — "Explore What You're Into"
          (the founder-editable explore_by_category section + its category
          pills) removed from the homepage entirely, per this pass's own
          spec. The underlying shared taxonomy (categories table,
          getHomeCategories(), the explore_by_category site_sections entry)
          is untouched — only this homepage module's render is gone. */}

      {/* UI + Copy Polish pass — the homepage "Want it" products section
          is temporarily hidden (display only): Product creation,
          management, moderation, marketplace eligibility, public business-
          profile display, and analytics are all completely unaffected —
          see /marketplace and each business's own public profile, which
          still show products normally. getHomepageRowProducts (lib/data.ts)
          is simply no longer called from this page, so no extra query
          runs for a section that isn't rendered. To restore: reintroduce
          the fetch and the Section block that used to sit here (see git
          history), unchanged. */}

      {/* Any remaining founder-managed Homepage Row (rare — e.g. a second
          "events" content-type row). Unchanged component/logic. */}
      {otherRowIndices.map((i) => (
        <HomepageRowSection
          key={homepageRows[i].id}
          row={homepageRows[i]}
          resolved={resolvedRows[i]}
          marketSlug={marketSlug}
          areaSlug={areaSlug}
        />
      ))}

      {/* Final business CTA — unchanged, founder-editable via Site
          Editor. Homepage Bottom Cleanup pass — the "Keep exploring"
          links block that used to follow this (Explore businesses/
          events/locations) is removed entirely, so this CTA is now the
          last substantive homepage content before Footer (rendered by
          the shared (public)/layout.tsx, already carrying its own mt-16
          top margin) — py-10's own bottom padding plus that margin is
          the only spacing between them, no new wrapper added. */}
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
              className="rounded-2xl bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
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
  areaSlug,
  isBrandsRow,
}: {
  row: HomepageRow;
  resolved: Awaited<ReturnType<typeof resolveHomepageRowItems>>;
  marketSlug?: string;
  areaSlug?: string;
  /** True only for the Brands We Love row pulled out above. Gates the
   * "Showing Up"-style eyebrow and the blank-copy fallback below to that
   * one row specifically. */
  isBrandsRow?: boolean;
}) {
  if (resolved.contentType === "business_showcase") {
    // Discovery Home Composition Reset — this founder-configured row is a
    // business-acquisition pitch sitting in the middle of consumer
    // discovery, redundant with the dedicated deeper acquisition moment
    // near the bottom of this page (closing_cta). Skipped here on the
    // HOMEPAGE specifically — presentation only: the row itself, its
    // title/subtitle, and its config_json are completely untouched in
    // homepage_rows/the admin editor.
    return null;
  }

  if (resolved.items.length === 0) return null;

  if (resolved.contentType === "businesses") {
    const isDynamic = row.mode !== "curated";
    const rowCategories = isDynamic
      ? await getCategoriesForDynamicBusinessRow(row.featured_only, marketSlug, areaSlug)
      : dedupeCategories(resolved.items.flatMap((b) => b.categories));
    const businessIds = resolved.items.map((b) => b.id);
    const [appearanceHintsMap, businessGalleriesMap] = await Promise.all([
      getUpcomingAppearanceHints(businessIds),
      getBusinessGalleryImagesMap(businessIds),
    ]);
    const appearanceHints = Object.fromEntries(appearanceHintsMap);
    const businessGalleries = Object.fromEntries(businessGalleriesMap);
    const viewAllHref = (() => {
      if (!isDynamic) return "/businesses";
      const p = new URLSearchParams();
      if (row.category_slug) p.set("category", row.category_slug);
      if (marketSlug) p.set("market", marketSlug);
      if (marketSlug && areaSlug) p.set("area", areaSlug);
      return `/businesses${p.toString() ? `?${p.toString()}` : ""}`;
    })();
    return (
      <Section
        title={isBrandsRow ? row.title || BRANDS_ROW_HEADING_FALLBACK : row.title}
        subtitle={(isBrandsRow ? row.subtitle || BRANDS_ROW_SUBTITLE_FALLBACK : row.subtitle) ?? undefined}
        // Consumer Experience V1 — "Showing Up" for Brands We Love
        // specifically, to read as the connection moment ("where can I
        // actually find this brand"). Underlying selection/ordering rules
        // are completely untouched — this is a label only.
        eyebrow={isBrandsRow ? "Showing Up" : undefined}
        viewAllHref={viewAllHref}
        titleClassName={HOMEPAGE_SECTION_TITLE_CLASS}
        subtitleClassName={HOMEPAGE_SECTION_SUBTITLE_CLASS}
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
          key={`${row.id}-${marketSlug ?? "all"}`}
          rowId={row.id}
          pageId={row.page_id}
          contentType={row.content_type ?? "businesses"}
          mode={row.mode}
          pinnedIds={row.pinned_ids}
          initialItems={resolved.items}
          categories={rowCategories}
          appearanceHints={appearanceHints}
          businessGalleries={businessGalleries}
          marketSlug={isDynamic ? marketSlug : undefined}
        />
      </Section>
    );
  }

  if (resolved.contentType === "events") {
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

  // Any other founder row content type (products rows are excluded from
  // otherRowIndices above and never routed through here).
  return null;
}

function dedupeCategories(categories: Category[]): Category[] {
  const seen = new Map<string, Category>();
  for (const c of categories) if (!seen.has(c.id)) seen.set(c.id, c);
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}
