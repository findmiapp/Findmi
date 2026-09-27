import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import HomepageBusinessRow from "@/components/HomepageBusinessRow";
import HomeEventCard from "@/components/HomeEventCard";
import HomeWeather from "@/components/HomeWeather";
import HomeHero, { type HeroCollageImages } from "@/components/HomeHero";
import SupabaseImage from "@/components/SupabaseImage";
import Section, { HorizontalScroller } from "@/components/Section";
import SearchBar from "@/components/SearchBar";
import AreaPicker from "@/components/discover/AreaPicker";
import {
  attachEventCategories,
  getCategoriesForDynamicBusinessRow,
  getCategoryShowcaseImages,
  getConsumerVisibleMarketsWithAreas,
  getFeaturedBusinesses,
  getHomeCategories,
  getHomepageRowProducts,
  getMarketAreaLabel,
  getNextAppearanceHints,
  getUpcomingEvents,
} from "@/lib/data";
import { getVisibleHomepageRows, resolveHomepageRowItems, type HomepageRow } from "@/lib/homepage-rows";
import {
  getSiteSections,
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
  const [categories, nextRaw, heroFallbackBrands, homepageRows, siteSections, markets, wantItProducts] =
    await Promise.all([
      getHomeCategories(), // BUSINESS categories — circular "Explore What You're Into" row + Explore By Category, never events
      getUpcomingEvents(10, "anytime", marketSlug, areaSlug),
      // Homepage Visual North Star V1 — the hero collage's business-photo
      // candidates (brand/place role). NEVER Market-filtered (editorial/
      // decorative, see homepage-rows.ts's own note on curated content).
      // Limit raised from 3 to 6 purely to give the collage enough real
      // candidates to choose from — same is_featured/live/non-demo query.
      getFeaturedBusinesses(6),
      getVisibleHomepageRows(),
      getSiteSections("homepage"), // one query for every fixed-section override — see lib/site-sections.ts
      getConsumerVisibleMarketsWithAreas(), // Consumer Area Picker V1/V2 — same public list /businesses already uses
      // Consumer Experience V1 — "Want it." Real marketplace-approved
      // products (marketplace_status='approved', is_active=true), ordered
      // deterministically (is_featured first as a tie-break, then
      // home_sort_order, then name — see getHomepageRowProducts) rather
      // than REQUIRING is_featured=true the way a founder-configured
      // "products" Homepage Row's featured_only setting can. That
      // combination (marketplace_status='approved' AND is_featured=true)
      // is exactly what was producing only one visible product on
      // production — this consumer discovery rail draws from the same
      // real approved products directly instead, without changing what
      // is_featured means anywhere else.
      getHomepageRowProducts({ limit: 10 }),
    ]);

  const nextEvents = await attachEventCategories(nextRaw);

  // Homepage Visual North Star V1 — one real photo per home category for
  // the circular "Explore What You're Into" row (see getCategoryShowcaseImages'
  // own note: an actual business genuinely tagged with that category,
  // never a stock photo). Fetched here (not the Promise.all above) since
  // it needs `categories`' resolved ids first.
  const categoryImages = await getCategoryShowcaseImages(categories.map((c) => c.id));

  // Each row's content is resolved in parallel — one query per row
  // (dynamic mode) or a curated-id lookup (curated mode), same shared
  // query functions every other feed on the site already uses. See
  // lib/homepage-rows.ts.
  const resolvedRows = await Promise.all(homepageRows.map((row) => resolveHomepageRowItems(row, marketSlug, areaSlug)));

  // Consumer Experience V1 — a founder-configured "products" Homepage Row
  // (if one exists) still supplies this rail's HEADING copy (title/
  // subtitle stay founder-editable via /admin/site/homepage/rows), but its
  // ITEMS come from wantItProducts above, not resolvedRows — see that
  // fetch's own note. A founder who never configured one still gets a
  // sensible default heading; the rail itself never depends on the row
  // existing at all.
  const productsRow = homepageRows.find((row) => row.content_type === "products") ?? null;

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
  const businessDoorwaySec = resolve("business_doorway");

  // Homepage Visual North Star V1 — the collage's five roles, each filled
  // by a REAL, already-fetched photo from a different part of the FindMi
  // graph (never stock imagery, never a fabricated relationship): brand
  // (business cover photo), place/experience (event cover photo), and
  // product (product photo). heroFallbackBrands/wantItProducts/nextEvents
  // are the exact same real, live, non-demo content already queried above
  // for other homepage sections — this reuses them rather than adding a
  // new "hero-only" content query. Distinct businesses/events are used for
  // the two business/event roles so the collage doesn't repeat a photo.
  // Any role with no real candidate is simply omitted (see HomeHero's own
  // graceful-degradation note) — never a placeholder image.
  const collageBusinesses = heroFallbackBrands.filter((b) => b.cover_image_url);
  const collageProducts = wantItProducts.filter((p) => p.image_url);
  const collageEvents = nextEvents.filter((e) => e.cover_image_url);
  const heroImages: HeroCollageImages = {
    left: collageBusinesses[0]
      ? { src: collageBusinesses[0].cover_image_url!, alt: collageBusinesses[0].name }
      : undefined,
    topRight: collageEvents[0] ? { src: collageEvents[0].cover_image_url!, alt: collageEvents[0].name } : undefined,
    circle: collageProducts[0] ? { src: collageProducts[0].image_url!, alt: collageProducts[0].name } : undefined,
    bottomRight: collageEvents[1] ? { src: collageEvents[1].cover_image_url!, alt: collageEvents[1].name } : undefined,
    bottomCenter: collageBusinesses[1]
      ? { src: collageBusinesses[1].cover_image_url!, alt: collageBusinesses[1].name }
      : collageProducts[1]
        ? { src: collageProducts[1].image_url!, alt: collageProducts[1].name }
        : undefined,
  };

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

      {/* Homepage Visual North Star V1 — editorial serif headline + real-
          photo collage (see HomeHero.tsx). Copy is fixed by this pass's
          visual spec, not the founder's Site Editor -> Hero heading/body
          fields (still stored, no longer consumed here); images are real
          business/product/event photos already fetched above, not the
          founder's separate Hero Image 1/2 slots. */}
      <HomeHero images={heroImages} />

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

      {/* Homepage Visual North Star V1 — the taste layer becomes circular
          real photo + label (was a text pill row), same real
          getHomeCategories() fetch and same /businesses?category= links
          this always used. A category with no real photographed business
          yet (see getCategoryShowcaseImages) falls back to a plain tinted
          circle with its initial, never a stock photo. */}
      {categories.length > 0 && (
        <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink/40">{exploreSec.heading}</p>
          <div className="flex gap-4 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map((c, i) => {
              const image = categoryImages[c.id];
              return (
                <Link
                  key={c.id}
                  href={`/businesses?category=${c.slug}${marketSlug ? `&market=${encodeURIComponent(marketSlug)}` : ""}${marketSlug && areaSlug ? `&area=${encodeURIComponent(areaSlug)}` : ""}`}
                  className="flex shrink-0 flex-col items-center gap-1.5"
                >
                  {image ? (
                    <div className="relative h-16 w-16 overflow-hidden rounded-full ring-1 ring-black/5">
                      <SupabaseImage src={image} alt="" fill sizes="64px" className="object-cover" />
                    </div>
                  ) : (
                    <div
                      className={`flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold ${CATEGORY_TINTS[i % CATEGORY_TINTS.length]}`}
                    >
                      {c.name.charAt(0)}
                    </div>
                  )}
                  <span className="max-w-[72px] text-center text-xs font-semibold leading-tight text-ink/75">{c.name}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* WANT IT — real, approved marketplace products (see wantItProducts
          above), collectible-object entity grammar (square photo, brand
          byline, price, a "Want" heart — never a checkout-forward
          treatment). Founder-editable heading when a "products" Homepage
          Row exists; a sensible default otherwise. Honest empty state:
          renders nothing if there are genuinely no approved products yet. */}
      {wantItProducts.length > 0 && (
        <Section
          title={productsRow?.title || "Want it"}
          subtitle={productsRow?.subtitle || "Real products from FindMi businesses"}
          viewAllHref="/marketplace"
          impressionPayload={{
            event_name: "discovery_section_impression",
            page_type: "home",
            page_path: "/",
            metadata: { content_type: "products", mode: "consumer_discovery" },
          }}
        >
          <HorizontalScroller>
            {wantItProducts.map((p, i) => (
              <div key={p.id} className="w-[42%] min-w-[150px] max-w-[176px] shrink-0 sm:w-44">
                <ProductCard
                  product={p}
                  analyticsContext={{ pageType: "home", placement: "homepage_want_it", position: i + 1 }}
                />
              </div>
            ))}
          </HorizontalScroller>
        </Section>
      )}

      {/* BRANDS SHOWING UP — the existing Brands We Love row/component,
          completely untouched logic and geometry (protected width fix). */}
      {brandsRowIndex !== -1 && (
        <HomepageRowSection
          row={homepageRows[brandsRowIndex]}
          resolved={resolvedRows[brandsRowIndex]}
          marketSlug={marketSlug}
          areaSlug={areaSlug}
          isBrandsRow
        />
      )}

      {/* MUST DOS / WHAT'S HAPPENING — the same real chronological event
          query as before. Event-card geometry/treatment (HomeEventCard)
          and the AreaPicker/Today/This Weekend controls are completely
          untouched. */}
      <div className="mx-auto max-w-6xl pt-8">
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
              className="flex h-10 shrink-0 items-center justify-center rounded-full border border-black/10 px-3.5 text-sm text-ink/70 transition hover:border-black/20"
            >
              Today
            </Link>
            <Link
              href="/discover?when=weekend"
              className="flex h-10 shrink-0 items-center justify-center rounded-full border border-black/10 px-3.5 text-sm text-ink/70 transition hover:border-black/20"
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
              className="rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
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

  // Any other founder row content type (products rows are never routed
  // through here anymore — see productsRow/wantItProducts above).
  return null;
}

function dedupeCategories(categories: Category[]): Category[] {
  const seen = new Map<string, Category>();
  for (const c of categories) if (!seen.has(c.id)) seen.set(c.id, c);
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}
