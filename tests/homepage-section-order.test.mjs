// Preservation-First Homepage Reorder pass — regression coverage for the
// approved render order. Source-inspection style, consistent with this
// suite's existing homepage guards (see homepage-business-eligibility.
// test.mjs's own "static guard" tests): page.tsx is a Server Component
// this suite can't render without a live Supabase client, so the real
// JSX order is verified by reading the actual file, the same way every
// other structural claim about this page is already checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGE = readFileSync("src/app/(public)/page.tsx", "utf8");

// Each marker is a string that appears EXACTLY ONCE in the file, taken
// directly from the real render call/condition for that section — never
// a paraphrase — so this test breaks the moment the real markup changes
// shape, not just when it moves.
const MARKERS = [
  ["Weather", '<HomeWeather context={weatherContext} />'],
  ["Hero", "<HomeHero images={heroImages}"],
  ["SearchBar", "<SearchBar marketSlug={marketSlug}"],
  ["Bulletin Carousel", "<HomepageBulletinCarousel bulletins={bulletins} />"],
  ["Start Here doorway", "New to Findmi? Start here"],
  ["Primary Discovery", '<DiscoveryLanes market={marketSlug} area={areaSlug} placement="primary" />'],
  ["What's Happening", "{upcomingSec.heading ?? HOMEPAGE_SECTIONS.featured_events.heading!}"],
  ["Brands We Love", "isBrandsRow\n        />"],
  ["Findmi Moments", 'aria-labelledby="home-moments-heading"'],
  ["Featured Locations", 'title="Featured Locations"'],
  ["Explore More Discovery", '<DiscoveryLanes market={marketSlug} area={areaSlug} placement="explore_more" />'],
  ["Business Showcase", "<BusinessShowcaseCarousel />"],
  ["Remaining founder rows", "{otherRowIndices.map((i) => ("],
  ["Closing CTA", "{site.features.business && closingSec.visible && ("],
];

test("each approved section marker appears exactly once in page.tsx", () => {
  for (const [name, marker] of MARKERS) {
    const count = PAGE.split(marker).length - 1;
    assert.equal(count, 1, `${name} marker should appear exactly once (found ${count}) — a stray duplicate or a deleted original would both show up here`);
  }
});

test("the approved homepage render order is: Weather, Hero, Search, Bulletin, Start Here doorway, Primary Discovery, What's Happening, Brands We Love, Moments, Featured Locations, Explore More Discovery, Business Showcase, remaining founder rows, Closing CTA", () => {
  const positions = MARKERS.map(([name, marker]) => ({ name, index: PAGE.indexOf(marker) }));
  for (const p of positions) assert.ok(p.index !== -1, `${p.name} marker not found at all`);
  for (let i = 1; i < positions.length; i++) {
    assert.ok(
      positions[i].index > positions[i - 1].index,
      `${positions[i].name} (at ${positions[i].index}) must render after ${positions[i - 1].name} (at ${positions[i - 1].index})`
    );
  }
});

test("row-identification logic (findPrimaryBusinessesRowId / brandsRowIndex / otherRowIndices) is computed once, before the return statement — never re-derived per section, so it can't drift from the render order above", () => {
  const bodyBeforeReturn = PAGE.slice(PAGE.indexOf("export default async function HomePage"), PAGE.indexOf("  return (\n    <div>"));
  assert.match(bodyBeforeReturn, /const primaryBusinessesRowId = findPrimaryBusinessesRowId\(homepageRows\);/);
  assert.match(bodyBeforeReturn, /const brandsRowIndex = homepageRows\.findIndex\(\(row\) => row\.content_type === "businesses"\);/);
  assert.match(bodyBeforeReturn, /const otherRowIndices: number\[\] = \[\];/);
  // otherRowIndices excludes both the products rail and whichever row
  // brandsRowIndex points to — unaffected by where either is rendered.
  assert.match(bodyBeforeReturn, /if \(row\.content_type === "products"\) return;\s*\n\s*if \(i === brandsRowIndex\) return;/);
});

test("Brands We Love and the remaining founder rows render exactly once each, from the same homepageRows/resolvedRows arrays computed above — no duplicate row rendering introduced by the reorder", () => {
  assert.equal((PAGE.match(/row={homepageRows\[brandsRowIndex\]}/g) ?? []).length, 1);
  assert.equal((PAGE.match(/row={homepageRows\[i\]}/g) ?? []).length, 1);
  // Only two call sites render a HomepageRowSection: Brands We Love
  // (singular) and the otherRowIndices loop (plural) — never a third.
  assert.equal((PAGE.match(/<HomepageRowSection/g) ?? []).length, 2);
});

test("every section's own conditional guard is preserved exactly as before the reorder (bulletins/brandsRowIndex/moments/featuredLocations/closingSec) — only position changed", () => {
  assert.match(PAGE, /\{bulletins\.length > 0 && \(/);
  assert.match(PAGE, /\{brandsRowIndex !== -1 && \(/);
  assert.match(PAGE, /\{momentFeed\.cards\.length > 0 && \(/);
  assert.match(PAGE, /\{featuredLocations\.length > 0 && \(/);
  // Plus the site's business-acquisition switch (lib/site.ts; always on for Findmi).
  assert.match(PAGE, /\{site\.features\.business && closingSec\.visible && \(/);
});

// ── Final CTA Repositioning pass ─────────────────────────────────────────

test("the Start Here doorway's wrapper uses the tight pb-1/pt-2 (sm:pb-2/sm:pt-3) spacing — the same 'tight, related block' gap Search/Bulletin already use between each other, now that it sits directly between Bulletin and Primary Discovery", () => {
  assert.match(PAGE, /<div className="mx-auto max-w-6xl px-4 pb-1 pt-2 sm:px-6 sm:pb-2 sm:pt-3">/);
  // The previous pb-4/pt-3 (sm:pb-5/sm:pt-5), tuned for the doorway's old
  // neighbor (Explore More Discovery -> Business Showcase), is gone.
  assert.doesNotMatch(PAGE, /px-4 pb-4 pt-3 sm:px-6 sm:pb-5 sm:pt-5/);
});

test("the doorway's own content — My Moments / Add Business cards, copy, hrefs — is byte-identical to before the move", () => {
  assert.match(PAGE, /Find what you love\. Get discovered\./);
  assert.match(PAGE, /href="\/my-world\/journal"/);
  assert.match(PAGE, /My Moments<\/span>/);
  assert.match(PAGE, /Document your experiences\./);
  assert.match(PAGE, /href="\/join\/brand"/);
  assert.match(PAGE, /Add Business<\/span>/);
  assert.match(PAGE, /Get discovered and grow with Findmi\./);
  assert.match(PAGE, /href="\/join" className="mr-1\.5 inline-flex items-center gap-0\.5 font-semibold text-findmi-700 hover:underline"/);
  assert.match(PAGE, /No credit card or app download required\./);
});

test("HomepageBulletinCarousel/HomepageBulletin are untouched by the repositioning — the excessive-gap fix lives entirely in page.tsx's own wrapper padding, never in the carousel's nav-row spacing or carousel functionality", () => {
  const CAROUSEL = readFileSync("src/components/HomepageBulletinCarousel.tsx", "utf8");
  const BULLETIN = readFileSync("src/components/HomepageBulletin.tsx", "utf8");
  assert.match(CAROUSEL, /<div className="mt-1\.5 flex items-center justify-center gap-3">/);
  assert.match(CAROUSEL, /ROTATE_INTERVAL_MS = 3000/);
  assert.match(CAROUSEL, /SWIPE_THRESHOLD_PX = 45/);
  assert.match(BULLETIN, /"flex items-center gap-3 rounded-2xl border border-black\/10 bg-white p-3 transition hover:border-black\/20"/);
});
