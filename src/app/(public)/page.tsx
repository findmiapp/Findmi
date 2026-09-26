import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import HomepageBusinessRow from "@/components/HomepageBusinessRow";
import HomeEventCard from "@/components/HomeEventCard";
import HomeWeather from "@/components/HomeWeather";
import Section, { HorizontalScroller } from "@/components/Section";
import HomeHero from "@/components/HomeHero";
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

// Consumer Home V1 — "Explore What You're Into" light/pastel category
// treatment (Section 12: the beginnings of a pastel interest/category
// visual system, without a per-category color column or new token
// system). Purely a cyclic presentation array, applied by index — no new
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

  // Discovery Home Composition Reset — the homepage no longer reproduces
  // /discover's full Time x Category filtering (that lived entirely in
  // the now-deleted HomeEventDiscovery: 4 of these 5 event windows —
  // now/week/weekend, plus a duplicate "anytime" call for "All" — and
  // the event-category chip list existed ONLY to feed its 5 tabs + chip
  // row). Homepage = discovery, /discover = deeper filtering (task's own
  // distinction) — so only the single real chronological "anytime" query
  // remains, now feeding the homepage's "Must Dos" events rail instead.
  // Net effect: 4 fewer real database queries per homepage render, not a
  // new one.
  const [categories, nextRaw, heroFallbackBrands, homepageRows, siteSections, markets] = await Promise.all([
    getHomeCategories(), // BUSINESS categories — category pills + Explore By Category only, never events
    // Consumer Event Market Filtering V1 — marketSlug scopes by every
    // candidate occurrence's EFFECTIVE physical Market (see
    // lib/event-markets.ts), never business Market entitlement. Absent =
    // today's unfiltered behavior, unchanged.
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
  // lib/homepage-rows.ts. marketSlug is passed through unconditionally —
  // resolveHomepageRowItems itself only ever applies it to a DYNAMIC
  // "businesses" row (curated rows/business_showcase/events/products all
  // ignore it, per that function's own note).
  const resolvedRows = await Promise.all(homepageRows.map((row) => resolveHomepageRowItems(row, marketSlug, areaSlug)));

  // Consumer Home V1 — no new query: the same founder-managed Homepage
  // Rows fetched above are now rendered in TWO passes instead of one
  // strict top-to-bottom loop, so the real product data ("Shop Local")
  // can surface as the homepage's V1 "Must Haves" moment near the top
  // instead of its old position after every business row. Indices (not
  // filtered copies of the rows themselves) are what's split, so
  // resolvedRows stays index-aligned with homepageRows throughout —
  // brandsRowIndex (below) is unaffected. A row rendered in the first
  // pass is excluded from the second pass, so nothing appears twice.
  const productRowIndices: number[] = [];
  const otherRowIndices: number[] = [];
  homepageRows.forEach((row, i) => {
    (row.content_type === "products" ? productRowIndices : otherRowIndices).push(i);
  });

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
  // Business Acquisition + Stale Plan Copy Cleanup pass — this key was
  // marked SUPERSEDED (2026 feed-builder pass) when the Business Showcase
  // moved to a founder-managed Homepage Row, and page.tsx stopped reading
  // it. Reused again here, unchanged shape, purely as ordinary founder-
  // editable heading/cta text for a much smaller presentation (see the
  // single-line acquisition prompt below) — not the old full showcase
  // section. Verified no live site_sections override exists for this key
  // before relying on its default copy.
  const businessDoorwaySec = resolve("business_doorway");

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

      {/* Business Acquisition + Stale Plan Copy Cleanup pass — restores a
          small, single-line business entry beneath the hero imagery and
          BEFORE the consumer search entry. Present in an earlier homepage
          pass, then lost when a later recomposition removed the FOR YOU /
          FOR BRANDS module entirely — removing that giant split was
          correct; removing this one small line was not (a business
          visitor should be able to understand "I can put my brand on
          this" without the consumer homepage becoming a business landing
          page). Additive only: one understated text line, not a card, no
          pricing, doesn't compete with the search entry directly below
          it. Deeper acquisition still lives only at the closing_cta near
          the bottom — this is not a second competing module. */}
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

      {/* CONSUMER HOME V1 — discovery entry. A single lightweight search
          field directly below the hero, reusing the existing homepage
          search exactly as it already worked (SearchBar / the existing
          /api/homepage-search route) — no new backend, no fake
          autocomplete, no new component. This is the homepage's own
          "what are you into?" moment (breadth across businesses,
          locations, events, and products, all real), distinct from the
          header's own search icon. */}
      <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
        <SearchBar marketSlug={marketSlug} placeholder="Search anything you're into…" />
      </div>

      {/* MUST HAVES — Consumer Home V1's real-data "things to have"
          surface. Real products already resolved above for this exact
          homepage render (productRowIndices/otherRowIndices, no new
          query) — the founder-managed "Shop Local" Homepage Row, simply
          rendered FIRST instead of after every business row, with an
          eyebrow label (the same additive Section prop Brands We Love's
          "Discover" already uses) rather than a rewritten title, so the
          founder's own row title/subtitle stay intact. Discovery
          language only — see HomepageRowSection's products branch
          (completely unchanged): no Want/Have/Love persistence, no fake
          save state, no fabricated pricing. */}
      {productRowIndices.map((i) => (
        <HomepageRowSection
          key={homepageRows[i].id}
          row={homepageRows[i]}
          resolved={resolvedRows[i]}
          marketSlug={marketSlug}
          areaSlug={areaSlug}
          isMustHavesRow
        />
      ))}

      {/* MUST DOS / WHAT'S HAPPENING — Consumer Home V1. Same real,
          already-fetched chronological event query as before (zero new
          query) — but no more single dominant "lead" card (the prior
          HomeDiscoveryMosaic's giant lead + 2 supporting tiles). Every
          card here is the same compact size, so this reads as "several
          real things happening," not one editorial event owning the
          page (Section 8/2's own core requirement). AreaPicker and
          Today/This Weekend now live here specifically, not at the very
          top — they're temporal/location controls, so they belong with
          the temporal section, not the search/discovery entry above.
          AreaPicker's own component/behavior (real market/area data,
          ?market=/?area= query params, search) is completely untouched.
          Full Time x Category filtering still lives at /discover, never
          reproduced here. */}
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
              {/* Must Dos Event Card Visual Restoration pass — the prior
                  ~38vw/170px wrapper (an over-correction from Composition
                  Reset) shrank these into unreadable thumbnails that
                  truncated nearly every field. HomeEventCard's own
                  full-bleed visual grammar (photo, gradient, badge,
                  title, date, location — see that component) was never
                  the problem; only this wrapper's width was. Restored to
                  a substantial card (~80vw on mobile, capped so the next
                  card visibly peeks) using the exact same sm:+ width
                  (`sm:w-72`) the founder-managed "events" Homepage Row
                  already uses for this identical card elsewhere in this
                  file — reused, not reinvented. Event selection/query
                  (`nextEvents`, still the same single already-fetched
                  query) is completely unchanged. */}
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

      {/* Founder-managed Homepage Rows — every row EXCEPT the products
          row(s) already rendered above as Must Haves (see
          otherRowIndices). Each remaining row is still a real database
          record (see /admin/site/homepage/rows): add/rename/edit/hide/
          reorder/delete without a code change. isBrandsRow (Brands We
          Love fallback copy) still targets brandsRowIndex exactly as
          before — that index is into the full homepageRows array, so
          splitting the render into two passes doesn't affect it. */}
      {otherRowIndices.map((i) => (
        <HomepageRowSection
          key={homepageRows[i].id}
          row={homepageRows[i]}
          resolved={resolvedRows[i]}
          marketSlug={marketSlug}
          areaSlug={areaSlug}
          isBrandsRow={i === brandsRowIndex}
        />
      ))}

      {/* EXPLORE WHAT YOU'RE INTO — Consumer Home V1. Existing category
          data/destinations completely untouched (same getHomeCategories()
          fetch, same /businesses?category= links); moved here from its
          old position at the very bottom of the page (removed there, not
          duplicated) and restyled with a light/pastel per-category tint
          (Section 12 — a cyclic presentation array, CATEGORY_TINTS above,
          no new schema/column, no per-category business logic). This is
          real business-category taxonomy, not a fabricated interest
          graph — no "Your Interests" label, nothing saved, nothing
          personalized. */}
      {categories.length > 0 && (
        <section className="py-5">
          <div className="mx-auto max-w-6xl">
            <div className="mb-3 px-4 sm:px-6">
              <h2 className="text-lg font-semibold tracking-tight text-ink">{exploreSec.heading}</h2>
            </div>
            <div className="flex gap-2.5 overflow-x-auto px-4 pb-1 sm:flex-wrap sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {categories.map((c, i) => (
                <Link
                  key={c.id}
                  href={`/businesses?category=${c.slug}${marketSlug ? `&market=${encodeURIComponent(marketSlug)}` : ""}${marketSlug && areaSlug ? `&area=${encodeURIComponent(areaSlug)}` : ""}`}
                  className={`flex min-w-[132px] shrink-0 items-center rounded-2xl px-4 py-3.5 text-sm font-semibold transition hover:opacity-80 ${CATEGORY_TINTS[i % CATEGORY_TINTS.length]}`}
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
  isMustHavesRow,
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
  /** Consumer Home V1 — true only for a "products" content-type row
   * (page.tsx's productRowIndices), rendered near the top of the
   * homepage as the "Must Haves" moment. Adds an eyebrow label only —
   * same additive Section prop isBrandsRow's "Discover" already uses —
   * so the founder's own row title/subtitle ("Shop Local" / "Real
   * products from FindMi businesses") stay exactly as configured. */
  isMustHavesRow?: boolean;
}) {
  if (resolved.contentType === "business_showcase") {
    // Discovery Home Composition Reset, task Section 16 — this founder-
    // configured row (currently live, sort_order 20, between Brands We
    // Love and Shop Local) is a business-acquisition pitch sitting in the
    // middle of consumer discovery, redundant with the dedicated deeper
    // acquisition moment near the bottom of this exact page (closing_cta,
    // below). Skipped here on the HOMEPAGE specifically — presentation
    // only: the row itself, its title/subtitle, and its config_json are
    // completely untouched in homepage_rows/the admin editor
    // (/admin/site/homepage/rows), so a founder who reorders/edits it
    // there sees their own data intact; this page simply no longer
    // renders this one content type. BusinessShowcaseCarousel itself is
    // untouched and importable elsewhere if ever needed again.
    return null;
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
      eyebrow={isMustHavesRow ? "Must Haves" : undefined}
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
