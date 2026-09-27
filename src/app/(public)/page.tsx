import Link from "next/link";
import HomepageBusinessRow from "@/components/HomepageBusinessRow";
import HomeEventCard from "@/components/HomeEventCard";
import HomeWeather from "@/components/HomeWeather";
import HomeHero from "@/components/HomeHero";
import BusinessShowcaseCarousel from "@/components/BusinessShowcaseCarousel";
import Section, { HorizontalScroller } from "@/components/Section";
import SearchBar from "@/components/SearchBar";
import AreaPicker from "@/components/discover/AreaPicker";
import {
  attachEventCategories,
  getCategoriesForDynamicBusinessRow,
  getConsumerVisibleMarketsWithAreas,
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

// Homepage Content Priority pass — same real example business /join's own
// Native Rose Showcase section uses (see PROOF_BUSINESS_SLUG there).
const NATIVE_ROSE_SLUG = "the-native-rose";

// Consumer Home V1 — "Explore What You're Into" light/pastel category
// treatment. Purely a cyclic presentation array, applied by index — no new
// business logic, no schema change. All stock Tailwind palette colors
// (no purple/lime), with FindMi Aqua's own pale tint (bg-findmi-50)
// included as one of the rotation's colors, matching the brand's existing
// "pale Aqua tints are soft highlight panels" pattern.
const CATEGORY_TINTS = [
  "bg-findmi-50 text-findmi-700",
  "bg-amber-50 text-amber-800",
  "bg-rose-50 text-rose-800",
  "bg-sky-50 text-sky-800",
  "bg-emerald-50 text-emerald-800",
  "bg-orange-50 text-orange-800",
];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string; area?: string }>;
}) {
  const { market: marketSlug, area: areaSlugRaw } = await searchParams;
  // Market -> Area/Submarket Hierarchy V2 — ?area= is only ever meaningful
  // alongside ?market= (same contract as /businesses and /events).
  const areaSlug = marketSlug ? areaSlugRaw : undefined;

  // Visual Regression Correction — back to the single getUpcomingEvents
  // call (occurrence override applied internally) now that Home no longer
  // needs each row's raw `occurrence`/`occurrenceLocation` for a homepage
  // anchor (see the removed ConnectionCard section below). The
  // occurrence-aware helpers themselves (getEffectiveUpcomingEvents,
  // applyOccurrenceOverride, getBusinessesForEvent,
  // getOccurrenceBusinessRosters) are untouched in lib/data.ts — this page
  // simply doesn't need their extra detail anymore.
  const [categories, nextRaw, heroFallbackBrands, homepageRows, siteSections, markets] = await Promise.all([
    getHomeCategories(), // BUSINESS categories — category pills + Explore By Category only, never events
    getUpcomingEvents(10, "anytime", marketSlug, areaSlug),
    getFeaturedBusinesses(3), // hero collage fallback imagery only, see below — NEVER Market-filtered (editorial/decorative, see homepage-rows.ts's own note on curated content)
    getVisibleHomepageRows(),
    getSiteSections("homepage"), // one query for every fixed-section override — see lib/site-sections.ts
    getConsumerVisibleMarketsWithAreas(), // Consumer Area Picker V1/V2 — same public list /businesses already uses
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
  // fixed-position (hero, event discovery heading/copy, explore by
  // category, closing CTA) — every field falls back to the current
  // hardcoded default (HOMEPAGE_SECTIONS) when no row/field exists.
  const resolve = (key: string) => resolveSection(siteSections, key, HOMEPAGE_SECTIONS[key]);
  const upcomingSec = resolve("featured_events");
  const exploreSec = resolve("explore_by_category");
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

      {/* Business Acquisition doorway — unchanged content/behavior,
          directly beneath the hero, before the search entry. */}
      {businessDoorwaySec.visible && (
        <div className="mx-auto max-w-6xl px-4 pb-1 pt-3 sm:px-6">
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

      {/* Search — unchanged: the existing homepage search field, same
          /api/homepage-search route. */}
      <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
        <SearchBar marketSlug={marketSlug} placeholder="Search anything you're into…" />
      </div>

      {/* Homepage Content Priority pass — MUST DOS / WHAT'S HAPPENING is now
          the first major content row after the opening/search area (was
          third, after Brands We Love and category pills). Same real
          chronological event query, event-card geometry/treatment
          (HomeEventCard), and AreaPicker/Today/This Weekend controls as
          before — placement only, nothing about this row itself changed. */}
      <div className="mx-auto max-w-6xl pt-6">
        <div className="px-4 sm:px-6">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-findmi-700">Must Dos</p>
          <div className="flex items-end justify-between gap-4">
            <h2 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {upcomingSec.heading ?? HOMEPAGE_SECTIONS.featured_events.heading!}
            </h2>
            <Link
              href={
                marketSlug
                  ? `/events?market=${encodeURIComponent(marketSlug)}${areaSlug ? `&area=${encodeURIComponent(areaSlug)}` : ""}`
                  : "/events"
              }
              className="shrink-0 pb-1 text-xs font-semibold text-ink/55 underline decoration-ink/25 underline-offset-4 transition hover:text-ink hover:decoration-ink/50"
            >
              View all
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {markets.length > 0 && (
              <AreaPicker
                options={markets.map((m) => ({
                  slug: m.slug,
                  label: getMarketAreaLabel(m),
                  areasIncluded: m.areas_included,
                  areas: m.areas.map((a) => ({ slug: a.slug, label: a.display_name || a.name, aliases: a.aliases })),
                }))}
              />
            )}
            <Link
              href="/discover?when=today"
              className="flex h-10 shrink-0 items-center justify-center rounded-xl border border-black/10 px-3.5 text-sm text-ink/70 transition hover:border-black/20"
            >
              Today
            </Link>
            <Link
              href="/discover?when=weekend"
              className="flex h-10 shrink-0 items-center justify-center rounded-xl border border-black/10 px-3.5 text-sm text-ink/70 transition hover:border-black/20"
            >
              This Weekend
            </Link>
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

      {/* Homepage Content Priority pass — NATIVE ROSE DEMO, second major
          row: what a real Findmi business presence looks like. Reuses
          BusinessShowcaseCarousel unmodified (same real screenshots,
          same component /join already uses) rather than a new UI — see
          that component's own comment. Copy also reused verbatim from
          /join's own Native Rose Showcase section. */}
      <div className="mx-auto max-w-4xl px-4 pt-10 sm:px-6 sm:pt-12">
        <p className="text-center text-xs font-bold uppercase tracking-wide text-ink/35">
          See what your Findmi can become.
        </p>
        <p className="mx-auto mt-1.5 max-w-sm text-center text-sm text-ink/60">
          One page. Your business, products and everywhere you&rsquo;ll be next.
        </p>
        <div className="mt-4">
          <BusinessShowcaseCarousel />
        </div>
        <div className="mt-3 flex justify-center">
          <a
            href={`/business/${NATIVE_ROSE_SLUG}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-findmi-700 transition hover:text-findmi-800"
          >
            View live profile <span aria-hidden>→</span>
          </a>
        </div>
      </div>

      {/* Homepage Content Priority pass — BRANDS WE LOVE, third major row
          (was second, before What's Happening). Same existing row/
          component, completely untouched logic and geometry (protected
          width fix) — placement only. */}
      {brandsRowIndex !== -1 && (
        <HomepageRowSection
          row={homepageRows[brandsRowIndex]}
          resolved={resolvedRows[brandsRowIndex]}
          marketSlug={marketSlug}
          areaSlug={areaSlug}
          isBrandsRow
        />
      )}

      {/* Homepage Content Priority pass — category discovery pushed below
          the first three real-activity rows (was directly under search).
          Same real business-category taxonomy (getHomeCategories()),
          same /businesses?category= links, same compact chip row —
          placement only. */}
      {categories.length > 0 && (
        <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/40">{exploreSec.heading}</p>
          <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map((c, i) => (
              <Link
                key={c.id}
                href={`/businesses?category=${c.slug}${marketSlug ? `&market=${encodeURIComponent(marketSlug)}` : ""}${marketSlug && areaSlug ? `&area=${encodeURIComponent(areaSlug)}` : ""}`}
                className={`flex min-w-[100px] shrink-0 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition hover:opacity-80 ${CATEGORY_TINTS[i % CATEGORY_TINTS.length]}`}
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}

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
          Editor. */}
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
              className="rounded-xl bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
            >
              {closingSec.ctaLabel}
            </Link>
          </div>
        </section>
      )}

      {/* Keep Exploring — unchanged. */}
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
    const appearanceHints = Object.fromEntries(
      await getNextAppearanceHints(resolved.items.map((b) => b.id))
    );
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
