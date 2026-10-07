// Homepage Appearance Eligibility pass — regression coverage for the fix
// to the root cause behind Fox Den LeatherCraft (no qualifying Appearance)
// appearing in the homepage's primary businesses discovery carousel: the
// old code made temporal (Appearance) eligibility implicit in
// featured_only, so a non-featured dynamic row had no Appearance gate at
// all. requireUpcomingAppearance is now an independent flag, composed
// with featuredOnly rather than caused by it, and applied uniformly
// across all three row modes (dynamic/curated/hybrid) for the ONE primary
// row only. No network, no production Storage/DB — pure functions and
// static source guards only. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const D = await import("../src/lib/data.ts");
const H = await import("../src/lib/homepage-rows.ts");

// Mirrors getBusinessIdsWithUpcomingAppearance's SQL condition
// (status <> 'canceled' AND end_at > now()) over in-memory fixtures, so
// these tests can exercise the four appearance shapes without a live
// Supabase client. This is test-only fixture logic, not a second runtime
// definition — the real rule is the unmodified SQL in lib/data.ts, reused
// verbatim by every caller (see that function's own doc).
function resolveUpcomingIds(appearances, now = new Date()) {
  const ids = new Set();
  for (const a of appearances) {
    if (a.status === "canceled") continue;
    if (!a.end_at) continue;
    if (new Date(a.end_at).getTime() > now.getTime()) ids.add(a.business_id);
  }
  return ids;
}

const NOW = new Date("2026-06-15T12:00:00Z");

// ── 1-4: the four Appearance shapes, via composeEligibleBusinessIds ──────
test("live business + upcoming Appearance -> eligible", () => {
  const upcomingIds = resolveUpcomingIds([{ business_id: "b1", status: "confirmed", end_at: "2026-07-01T00:00:00Z" }], NOW);
  assert.deepEqual(D.composeEligibleBusinessIds(["b1"], { requireUpcomingAppearance: true, upcomingIds }), ["b1"]);
});

test("live business + only a past Appearance -> ineligible", () => {
  const upcomingIds = resolveUpcomingIds([{ business_id: "b1", status: "confirmed", end_at: "2026-01-01T00:00:00Z" }], NOW);
  assert.deepEqual(D.composeEligibleBusinessIds(["b1"], { requireUpcomingAppearance: true, upcomingIds }), []);
});

test("live business + a canceled future Appearance -> ineligible (status beats date)", () => {
  const upcomingIds = resolveUpcomingIds([{ business_id: "b1", status: "canceled", end_at: "2026-12-01T00:00:00Z" }], NOW);
  assert.deepEqual(D.composeEligibleBusinessIds(["b1"], { requireUpcomingAppearance: true, upcomingIds }), []);
});

test("live business + no Appearance at all -> ineligible (the Fox Den case)", () => {
  const upcomingIds = resolveUpcomingIds([], NOW);
  assert.deepEqual(D.composeEligibleBusinessIds(["b1"], { requireUpcomingAppearance: true, upcomingIds }), []);
});

// ── 5-6: curated / hybrid-pinned must not bypass eligibility ─────────────
test("curated business without an upcoming Appearance -> ineligible (curation never resurrects it)", () => {
  const curated = [{ id: "fox-den" }, { id: "eligible-co" }];
  const upcomingIds = new Set(["eligible-co"]);
  assert.deepEqual(D.selectBusinessesWithUpcomingAppearance(curated, upcomingIds).map((b) => b.id), ["eligible-co"]);
});

test("hybrid pinned business without an upcoming Appearance -> ineligible (pinning never resurrects it)", () => {
  const pinned = [{ id: "fox-den" }, { id: "eligible-co" }];
  const upcomingIds = new Set(["eligible-co"]);
  assert.deepEqual(D.selectBusinessesWithUpcomingAppearance(pinned, upcomingIds).map((b) => b.id), ["eligible-co"]);
});

// ── 7-8: featuredOnly and requireUpcomingAppearance are independent ──────
test("featured_only=false does not disable Appearance eligibility", () => {
  const upcomingIds = new Set(["b2"]);
  const eligible = D.composeEligibleBusinessIds(["b1", "b2"], { requireUpcomingAppearance: true, featuredOnly: false, upcomingIds });
  assert.deepEqual(eligible, ["b2"]);
});

test("featured_only=true requires BOTH a qualifying Appearance AND is_featured — neither alone is enough", () => {
  const upcomingIds = new Set(["b1", "b2"]); // b1, b2 have a qualifying appearance; b3 does not
  const featuredIds = new Set(["b2", "b3"]); // b2, b3 are is_featured; b1 is not
  const eligible = D.composeEligibleBusinessIds(["b1", "b2", "b3"], {
    requireUpcomingAppearance: true,
    featuredOnly: true,
    upcomingIds,
    featuredIds,
  });
  assert.deepEqual(eligible, ["b2"]); // b1 fails featured, b3 fails appearance, only b2 passes both
});

// ── Guard against reverting to the old coupling ───────────────────────────
test("requireUpcomingAppearance omitted: every OTHER businesses row keeps its exact prior (non-appearance-gated) behavior", () => {
  const eligible = D.composeEligibleBusinessIds(["b1", "b2"], { upcomingIds: new Set() });
  assert.deepEqual(eligible, ["b1", "b2"], "no requireUpcomingAppearance flag -> appearance is never consulted");
});

test("featuredOnly alone (no requireUpcomingAppearance) never triggers an appearance check", () => {
  const featuredIds = new Set(["b1"]);
  const eligible = D.composeEligibleBusinessIds(["b1", "b2"], { featuredOnly: true, featuredIds, upcomingIds: new Set() });
  assert.deepEqual(eligible, ["b1"], "featured_only is purely editorial again — decoupled from appearances");
});

// ── findPrimaryBusinessesRowId: scoping to exactly one row ────────────────
function row(overrides) {
  return {
    id: "r",
    title: "Row",
    subtitle: null,
    content_type: "businesses",
    mode: "dynamic",
    category_slug: null,
    featured_only: false,
    time_window: null,
    item_limit: 8,
    curated_ids: [],
    pinned_ids: [],
    is_visible: true,
    sort_order: 0,
    page_id: "page-1",
    parent_id: null,
    section_type: "feed",
    market_slug: null,
    area_slug: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

test("findPrimaryBusinessesRowId: the first visible, top-level businesses row by sort_order — others ignored", () => {
  const rows = [
    row({ id: "events-row", content_type: "events", sort_order: 0 }),
    row({ id: "hidden-businesses", content_type: "businesses", sort_order: 1, is_visible: false }),
    row({ id: "child-businesses", content_type: "businesses", sort_order: 1, parent_id: "group-1" }),
    row({ id: "primary", content_type: "businesses", sort_order: 2 }),
    row({ id: "secondary-businesses", content_type: "businesses", sort_order: 3 }),
  ];
  assert.equal(H.findPrimaryBusinessesRowId(rows), "primary");
  // Order of the input array shouldn't matter — sort_order decides, not array position.
  assert.equal(H.findPrimaryBusinessesRowId([...rows].reverse()), "primary");
});

test("findPrimaryBusinessesRowId: null when no eligible businesses row exists", () => {
  assert.equal(H.findPrimaryBusinessesRowId([row({ content_type: "events" })]), null);
  assert.equal(H.findPrimaryBusinessesRowId([]), null);
});

// ── Static guards: the fix threads through every call site, all 3 modes ──
test("static guard: resolveHomepageRowItems applies requireUpcomingAppearance to ALL THREE businesses modes", () => {
  const src = readFileSync("src/lib/homepage-rows.ts", "utf8");
  assert.match(src, /resolveCuratedBusinesses\(row, requireUpcomingAppearance\)/);
  assert.match(src, /resolveHybridBusinesses\(row, marketSlug, areaSlug, requireUpcomingAppearance\)/);
  assert.match(src, /requireUpcomingAppearance,\s*\n\s*}\);/, "dynamic branch passes requireUpcomingAppearance into getHomepageRowBusinesses");
  // Curated path filters, never bypasses.
  assert.match(src, /resolveCuratedBusinesses[\s\S]{0,400}filterBusinessesWithUpcomingAppearance/);
  // Hybrid's PINNED portion is filtered too, not just the auto-fill.
  assert.match(src, /const pinned = requireUpcomingAppearance \? await filterBusinessesWithUpcomingAppearance\(pinnedAll\) : pinnedAll;/);
});

test("static guard: the homepage page and the category-refetch API route both scope the flag to the primary row only", () => {
  const page = readFileSync("src/app/(public)/page.tsx", "utf8");
  assert.match(page, /findPrimaryBusinessesRowId\(homepageRows\)/);
  assert.match(page, /requireUpcomingAppearance: row\.id === primaryBusinessesRowId/);

  const route = readFileSync("src/app/api/homepage-business-row/route.ts", "utf8");
  assert.match(route, /isPrimaryBusinessesRow\(typedRow\)/);
  assert.match(route, /requireUpcomingAppearance/);
});

test("static guard: admin UX no longer lets Featured Only imply appearance causation", () => {
  const card = readFileSync("src/components/admin/HomepageRowCard.tsx", "utf8");
  assert.match(card, /no effect on whether a Business currently has a qualifying upcoming Appearance/);
  assert.match(card, /isPrimaryBusinessesRow/);
});

test("static guard: media-calibration work and its execution gate are untouched by this pass", () => {
  const calibration = readFileSync("src/lib/admin/media-calibration.ts", "utf8");
  assert.match(calibration, /MEDIA_CALIBRATION_ENABLED/);
  const route = readFileSync("src/app/admin/api/media-calibration/route.ts", "utf8");
  assert.match(route, /isCalibrationExecutionEnabled/);
});
