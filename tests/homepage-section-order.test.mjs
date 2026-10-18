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
  ["Discovery Lanes", "<DiscoveryLanes market={marketSlug} area={areaSlug} />"],
  ["What's Happening", "{upcomingSec.heading ?? HOMEPAGE_SECTIONS.featured_events.heading!}"],
  ["Brands We Love", "isBrandsRow\n        />"],
  ["Findmi Moments", 'aria-labelledby="home-moments-heading"'],
  ["Featured Locations", 'title="Featured Locations"'],
  ["Start Here doorway", "New to Findmi? Start here"],
  ["Business Showcase", "<BusinessShowcaseCarousel />"],
  ["Remaining founder rows", "{otherRowIndices.map((i) => ("],
  ["Closing CTA", "{closingSec.visible && ("],
];

test("each approved section marker appears exactly once in page.tsx", () => {
  for (const [name, marker] of MARKERS) {
    const count = PAGE.split(marker).length - 1;
    assert.equal(count, 1, `${name} marker should appear exactly once (found ${count}) — a stray duplicate or a deleted original would both show up here`);
  }
});

test("the approved homepage render order is: Weather, Hero, Search, Bulletin, Discovery Lanes, What's Happening, Brands We Love, Moments, Featured Locations, Start Here doorway, Business Showcase, remaining founder rows, Closing CTA", () => {
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
  assert.match(PAGE, /\{closingSec\.visible && \(/);
});
