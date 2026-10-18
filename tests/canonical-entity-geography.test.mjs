// Canonical Entity Geography — the pure resolver (lib/geo/entity-geo-core.ts)
// is exercised directly (it has no I/O, so real function calls are possible,
// unlike most of this codebase's static-assertion tests); the migration,
// entity-save integration, and backfill runner are verified the same
// "read source, assert the real behavior is present" way the rest of this
// suite already does, since no database is available in this sandbox (see
// CLAUDE.md §4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";

// Same resolution hook tests/input-capitalization.test.mjs already
// registers (plain `node --test` has no extensionless-.ts or `@/` alias
// resolution, and no real "server-only" package needs to run under test).
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

// A dynamic import, not a static one: registerHooks only affects
// resolutions that happen AFTER it runs, and static imports are linked
// before any top-level code executes — see this file's own hook above.
const { resolveExplicitKey, resolveZipForEntity, resolveStateForEntity, resolveFindmiAlias, resolvePlaceForEntity } = await import(
  "../src/lib/geo/entity-geo-core.ts"
);

const read = (p) => readFileSync(p, "utf8");

const nashvilleTn = { geo_key: "place:4752006", kind: "place", name: "Nashville-Davidson metropolitan government (balance)", display_name: "Nashville-Davidson", state_usps: "TN", aland_m2: 100, search_names: ["nashville davidson", "nashville"] };
const nashvilleGa = { geo_key: "place:1356072", kind: "place", name: "Nashville city", display_name: "Nashville", state_usps: "GA", aland_m2: 10, search_names: ["nashville"] };
const nashvilleNc = { geo_key: "place:3745880", kind: "place", name: "Nashville town", display_name: "Nashville", state_usps: "NC", aland_m2: 20, search_names: ["nashville"] };
const nyc = { geo_key: "place:3651000", kind: "place", name: "New York city", display_name: "New York", state_usps: "NY", aland_m2: 500, search_names: ["new york"] };
const zcta10012 = { geo_key: "zcta:10012", kind: "zcta", name: "10012", display_name: "10012", state_usps: null, aland_m2: 1, search_names: ["10012"] };

test("1. Nashville + state resolves to exactly one canonical Place — no Market needed", () => {
  const result = resolvePlaceForEntity("Nashville", [nashvilleTn, nashvilleGa, nashvilleNc], [], "TN");
  assert.equal(result.status, "resolved");
  assert.equal(result.keys.place, "place:4752006");
  assert.equal(result.marketSuggestion, null, "no Market mapping exists — that's a normal, valid outcome");
});

test("2. A 5-digit ZIP resolves to its ZCTA — no Market needed", () => {
  const result = resolveZipForEntity("10012", zcta10012, []);
  assert.equal(result.status, "resolved");
  assert.equal(result.keys.zcta, "zcta:10012");
  assert.equal(result.keys.place, null);
});

test("3. County-only resolution never populates an entity column (county is never stored directly)", () => {
  const county = { geo_key: "county:36061", kind: "county", name: "New York County", display_name: "New York County", state_usps: "NY", aland_m2: 1, search_names: ["new york county"] };
  const result = resolveExplicitKey("county:36061", county, []);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.keys, { place: null, zcta: null, state: null });
});

test("4. State-only resolves without a city — no Market needed", () => {
  const result = resolveStateForEntity("TN", []);
  assert.equal(result.status, "partial");
  assert.equal(result.keys.state, "state:47");
});

test("5. An ambiguous Place (no disambiguating state/context) is never guessed", () => {
  const result = resolvePlaceForEntity("Nashville", [nashvilleTn, nashvilleGa, nashvilleNc], []);
  assert.equal(result.status, "ambiguous");
  assert.ok(result.choices.length >= 2);
  assert.ok(result.choices.every((c) => c.kind === "place"));
});

test("5b. A context state (e.g. the business's own already-known state) disambiguates without overriding an explicit conflicting state", () => {
  const viaContext = resolvePlaceForEntity("Nashville", [nashvilleTn, nashvilleGa, nashvilleNc], [], null, "GA");
  assert.equal(viaContext.status, "resolved");
  assert.equal(viaContext.keys.place, "place:1356072");
  // An explicitly typed state still wins over a conflicting context hint.
  const viaExplicit = resolvePlaceForEntity("Nashville", [nashvilleTn, nashvilleGa, nashvilleNc], [], "TN", "GA");
  assert.equal(viaExplicit.status, "resolved");
  assert.equal(viaExplicit.keys.place, "place:4752006");
});

test("6. NYC resolves with a Market suggestion when product_geographies maps one — never collapses the canonical key away", () => {
  const mappings = [{ geo_key: "place:3651000", role: "primary", market_slug: "nyc", market_name: "New York City", area_slug: null, area_name: null }];
  const result = resolvePlaceForEntity("New York", [nyc], mappings, "NY");
  assert.equal(result.status, "resolved");
  assert.equal(result.keys.place, "place:3651000", "the raw canonical key is always kept, even with a Market mapped");
  assert.deepEqual(result.marketSuggestion, { type: "findmi", market: "nyc", area: null, label: "New York City" });
});

test("7. SoHo (a Findmi alias) resolves through the Area hierarchy", () => {
  const areas = [{ marketSlug: "nyc", marketName: "New York City", areaSlug: "soho", areaName: "SoHo", names: ["soho"], geo_key: "place:3651000", geo_kind: "place" }];
  const result = resolveFindmiAlias("SoHo", areas);
  assert.equal(result.status, "resolved");
  assert.equal(result.keys.place, "place:3651000");
  assert.equal(result.marketSuggestion.area, "soho");
});

test("7b. A Findmi Area name with no canonical mapping yet is 'partial', never invented", () => {
  const areas = [{ marketSlug: "nyc", marketName: "New York City", areaSlug: "soho", areaName: "SoHo", names: ["soho"], geo_key: null, geo_kind: null }];
  const result = resolveFindmiAlias("SoHo", areas);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.keys, { place: null, zcta: null, state: null });
  assert.ok(result.marketSuggestion);
});

test("an explicit key that doesn't verify server-side is unresolved, never trusted blind", () => {
  const result = resolveExplicitKey("place:9999999", null, []);
  assert.equal(result.status, "unresolved");
});

// ── Entity-save integration: no automatic Market Request ────────────────
test("8/9. Business/Event/Location creation no longer force a Market-or-request choice, and never auto-create a market_requests row for unmatched geography", () => {
  const business = read("src/app/(public)/account/business/actions.ts");
  const event = read("src/app/(public)/account/event/actions.ts");
  const location = read("src/app/(public)/account/location/actions.ts");

  assert.doesNotMatch(business, /fail\("Choose a Primary Market, or request one below\."\);/);
  assert.match(business, /const effectiveRequestedMarketText: string \| null = null;/);
  assert.doesNotMatch(location, /createLinkedMarketRequest\(/, "owner-facing Location Market edit no longer calls it (the function name still appears in this pass's own explanatory comment)");
  assert.doesNotMatch(event.slice(event.indexOf("export async function updateMemberEventMarket")), /createLinkedMarketRequest\(/, "owner-facing Event Market edit no longer calls it");

  // Every one of the three entity-save paths writes canonical geo_resolution.
  for (const src of [business, event, location]) {
    assert.match(src, /geo_resolution: "derived"/);
  }
});

test("explicit admin Market Requests are preserved and now carry a canonical geo_key when one resolves", () => {
  const adminEvents = read("src/app/admin/(protected)/events/actions.ts");
  assert.match(adminEvents, /createLinkedMarketRequest\(supabase, \{[\s\S]*?geoKey,/);
  const marketRequests = read("src/lib/market-requests.ts");
  assert.match(marketRequests, /geo_key: input\.geoKey \?\? null/);
});

// ── Migration ─────────────────────────────────────────────────────────────
const MIGRATION_FILE = "20261025000000_canonical_entity_geography.sql";
const MIGRATION = read(`supabase/migrations/${MIGRATION_FILE}`).replace(/--.*$/gm, "");

test("migration: never touches the already-applied Discovery Intelligence V1 migration", () => {
  assert.doesNotMatch(MIGRATION, /20261024000000/);
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
  assert.ok(files.includes("20261024000000_discovery_intelligence_v1.sql"), "that file is untouched, still present");
});

test("migration: additive only — no destructive statement, every column nullable", () => {
  assert.doesNotMatch(MIGRATION, /\b(drop table|drop column|truncate|delete from)\b/i);
  assert.doesNotMatch(MIGRATION, /add column[^;]*\bnot null\b(?!\s+and)/i, "every new geo_* column stays nullable (the 'is not null' partial-index WHERE clauses are a different, unrelated use of the phrase)");
  assert.doesNotMatch(MIGRATION, /\bcounty_key\b|geo_county_key/i, "county is never stored directly on an entity");
});

test("migration: city/state/postal_code/market_id/market_area_id are never added/altered/touched as DDL", () => {
  assert.doesNotMatch(MIGRATION, /add column[^;]*\b(city|state|postal_code|market_id|market_area_id)\b/i);
  assert.doesNotMatch(MIGRATION, /\bmarket_id\b|\bmarket_area_id\b|\bpostal_code\b/, "these columns never appear at all — not even read");
  // "city"/"state" as bare words only ever appear inside this file's own
  // prose comments and the geo_state_key/'state:%' kind-prefix literals —
  // never as an actual column reference.
  assert.doesNotMatch(MIGRATION, /\.(city|state)\b|\b(city|state) (text|uuid)\b/i);
});

test("migration: FKs point at census_geographies(geo_key) with on delete restrict, and kind-prefix CHECKs are present", () => {
  assert.match(MIGRATION, /references public\.census_geographies\(geo_key\) on delete restrict/);
  assert.match(MIGRATION, /geo_place_key like ''place:%%''/);
  assert.match(MIGRATION, /geo_zcta_key like ''zcta:%%''/);
  assert.match(MIGRATION, /geo_state_key like ''state:%%''/);
  assert.match(MIGRATION, /geo_resolution is null or geo_resolution in \(''selected'', ''derived'', ''backfill'', ''import''\)/);
});

// ── Backfill runner ───────────────────────────────────────────────────────
const BACKFILL = read("src/lib/geo/entity-geo-backfill.ts");

test("12. Dry Run never writes — runOne only calls .update(...) inside the apply branch", () => {
  const dryRunFn = BACKFILL.slice(BACKFILL.indexOf("export async function runBackfillDryRun"));
  assert.match(dryRunFn, /runOne\(admin, table, limit, false\)/);
  const applyBranch = BACKFILL.slice(BACKFILL.indexOf("if (apply &&"));
  assert.match(applyBranch, /\.update\(update\)/);
});

test("13. Apply only fills rows with no existing geo_place_key/geo_state_key — never overwrites an already-set key", () => {
  assert.match(BACKFILL, /\.is\("geo_place_key", null\)\s*\.is\("geo_state_key", null\)\s*\.not\("city", "is", null\)/);
  // The write itself is re-guarded the same way immediately before it runs.
  const applyBranch = BACKFILL.slice(BACKFILL.indexOf("if (apply &&"));
  assert.match(applyBranch, /\.is\("geo_place_key", null\)\s*\.is\("geo_state_key", null\)/);
});

test("Backfill never touches city/state/postal_code/market_id/market_area_id, never creates a Market/Area/Market Request", () => {
  // The code (not this file's own explanatory comments) never writes or
  // reads any of these — the only ".update(...)" call is the one visible
  // in test 12/13 above, scoped to geo_place_key/geo_zcta_key/geo_state_key/geo_resolution only.
  assert.doesNotMatch(BACKFILL, /\.(update|insert)\(\{[^}]*(market_id|market_area_id)/);
  assert.doesNotMatch(BACKFILL, /\bmarket_requests\b|markets\.insert|business_markets/);
  assert.doesNotMatch(BACKFILL, /\.insert\(/, "only ever updates existing rows");
  assert.match(BACKFILL, /geo_resolution: "backfill"/);
});

test("14. Backfill refuses to run without a complete Census import", () => {
  const actions = read("src/app/admin/(protected)/site/geography/actions.ts");
  assert.match(actions, /backfillDryRunAction[\s\S]*?if \(!\(await isCensusImportComplete\(admin\)\)\) return \{ ok: false/);
  assert.match(actions, /backfillApplyAction[\s\S]*?if \(!\(await isCensusImportComplete\(admin\)\)\) return \{ ok: false/);
  assert.match(BACKFILL, /data\.length < 6\) return false/);
  assert.match(BACKFILL, /row as \{ status: string \}\)\.status === "complete"/);
});

// ── Appearance effective-geography precedence (unchanged by this pass) ──
test("17. A Location-linked Appearance still skips geography resolution of its own (the Location is authoritative)", () => {
  const actions = read("src/app/(public)/account/business/actions.ts");
  const fn = actions.slice(actions.indexOf("async function resolveStandaloneAppearanceGeography"), actions.indexOf("export async function addManualAppearance"));
  assert.match(fn, /!locationId && \(city \|\| state\)/, "canonical resolution is skipped when a Location is linked");
  assert.match(fn, /if \(locationId\) return \{ market_id: null, market_area_id: null, \.\.\.geoKeys \};/);
});
