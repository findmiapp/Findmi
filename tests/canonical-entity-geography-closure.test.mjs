// Canonical Entity Geography — CLOSURE pass. Closes the two gaps the
// completion-pass report disclosed: Area-level (not just Market-level)
// read-time rollup, and the initial Event occurrence's canonical
// geography invariant — plus a strengthened, explicit re-verification of
// the Business/Brand import N/A finding. Source-inspection style,
// consistent with this suite's no-database convention (see CLAUDE.md §4)
// — getAreaRollupGeoFilter/getBusinessIdsInArea/getLocations all make a
// real Supabase call that can't run here, so their SQL-shape guarantees
// are verified by reading the real generated code, the same way every
// other DB-touching claim in this suite already is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const DATA = read("src/lib/data.ts");
const EVENT_ACTIONS = read("src/app/(public)/account/event/actions.ts");

// ── Area-level read-time rollup ──────────────────────────────────────────

test("getAreaRollupGeoFilter queries product_geographies.market_area_id directly — a Market-only mapping (market_area_id null) can never match .in(), so it structurally cannot broaden into every Area under that Market (requirement C)", () => {
  const fn = DATA.slice(DATA.indexOf("async function getAreaRollupGeoFilter"), DATA.indexOf("export async function getBusinessIdsInMarket"));
  assert.match(fn, /from\("product_geographies"\)\.select\("geo_key"\)\.in\("market_area_id", areaIds\)/, "scoped to specific Area ids, never market_id alone");
  assert.doesNotMatch(fn, /\.eq\("market_id"/, "never falls back to a plain market-wide match here — that is getMarketRollupGeoFilter's own, separate job");
});

test("A/B. getBusinessIdsInArea additively rolls canonical inventory into an Area (and, via the SAME expanded areaScopeIds the existing explicit business_market_areas query already uses, into its parent Area too — the SoHo -> Manhattan case) without rewriting any business row", () => {
  const fn = DATA.slice(DATA.indexOf("export async function getBusinessIdsInArea"), DATA.indexOf("export async function getBusinessIdsWithUpcomingAppearance"));
  assert.match(fn, /const areaScopeIds = await getAreaScopeIds\(supabase, area\.id\);/, "the same parent+children expansion the pre-existing explicit path already used");
  assert.match(fn, /\.in\("market_area_id", areaScopeIds\)/, "explicit business_market_areas match still uses the full scope (parent rollup unchanged)");
  assert.match(fn, /getAreaRollupGeoFilter\(areaScopeIds\)/, "canonical rollup uses the IDENTICAL scope — a child Area's own canonical mapping surfaces under its parent for free, same mechanism as the pre-existing explicit rollup");
  // (+ publicIds: a geo-locked site's public-relationship brands — always [] on Findmi)
  assert.match(fn, /new Set\(\[\.\.\.explicitIds, \.\.\.rollupIds(, \.\.\.publicIds)?\]\)/, "additive union");
  assert.doesNotMatch(fn, /\.update\(|\.insert\(/, "never writes to the business row or any membership table — read-time only");
});

test("D. Explicit market_area_id / business_market_areas behavior is unchanged: the pre-existing two-step explicit match (candidate ids, then require an active business_markets row) still runs exactly as before, untouched by the rollup addition", () => {
  const fn = DATA.slice(DATA.indexOf("export async function getBusinessIdsInArea"), DATA.indexOf("export async function getBusinessIdsWithUpcomingAppearance"));
  assert.match(fn, /from\("business_market_areas"\)\s*\.select\("business_id"\)\s*\.eq\("market_id", market\.id\)\s*\.in\("market_area_id", areaScopeIds\)/);
  assert.match(fn, /from\("business_markets"\)\s*\.select\("business_id"\)\s*\.eq\("market_id", market\.id\)\s*\.eq\("active", true\)\s*\.in\("business_id", candidateIds\)/, "an explicit Area match still additionally requires an active Market membership, exactly as before");
});

test("A. getLocations' Area branch applies the same additive canonical rollup, alongside (never instead of) the explicit market_area_id match", () => {
  const locStart = DATA.indexOf("export async function getLocations(");
  const loc = DATA.slice(locStart, locStart + 6000);
  assert.match(loc, /const rollupFilter = await getAreaRollupGeoFilter\(areaIds\);/);
  assert.match(loc, /market_area_id\.in\.\(\$\{areaIds\.join\(","\)\}\)/, "the explicit match is still present inside the .or(), never replaced");
  assert.doesNotMatch(loc, /\.update\(\{[^}]*market_area_id/, "never rewrites a Location's own market_area_id as a side effect of the rollup");
});

test("Area rollup never creates a Market/Area and never duplicates Census geography into one — getAreaRollupGeoFilter only ever reads product_geographies, never writes to markets/market_areas", () => {
  const fn = DATA.slice(DATA.indexOf("async function getAreaRollupGeoFilter"), DATA.indexOf("export async function getBusinessIdsInMarket"));
  assert.doesNotMatch(fn, /from\("markets"\)|from\("market_areas"\)|\.insert\(|\.update\(/);
});

// ── Initial Event occurrence canonical geography ─────────────────────────

test("A manual-venue Event creation seeds NO event_occurrences row at all (the Event's own row IS the single effective date — see getEffectiveUpcomingEvents' documented legacy fallback); its own geo_place_key/geo_state_key are the complete, correct, already-resolved effective canonical geography for that Event", () => {
  const createFn = EVENT_ACTIONS.slice(EVENT_ACTIONS.indexOf("export async function createMemberEvent"), EVENT_ACTIONS.indexOf("export async function updateMemberEventDetails"));
  const manualBranch = createFn.slice(createFn.indexOf("} else if (manualVenue.venue_name"));
  assert.doesNotMatch(manualBranch, /event_occurrences/, "no occurrence row is seeded on the manual-venue path — nothing to resolve geography for beyond the Event's own row");
  // The Event's own canonical geography IS already resolved earlier in
  // this same function, from the identical manualVenue.city/state, before
  // this branch even runs (see tests/canonical-entity-geography-completion
  // .test.mjs's own "Admin...resolve canonical geography" coverage for the
  // equivalent admin path) — confirmed present in createMemberEvent itself.
  assert.match(createFn, /if \(manualVenue\.city && manualVenue\.state\) \{/);
  assert.match(createFn, /geo_resolution: explicitGeoKey \? "selected" : "derived"/);
});

test("A manual-venue Event never auto-creates a Market Request and never requires a Market, matching the no-occurrence invariant above", () => {
  const createFn = EVENT_ACTIONS.slice(EVENT_ACTIONS.indexOf("export async function createMemberEvent"), EVENT_ACTIONS.indexOf("export async function updateMemberEventDetails"));
  assert.doesNotMatch(createFn, /createLinkedMarketRequest\(/);
  assert.doesNotMatch(createFn, /fail\("Choose a Primary Market/);
});

test("A Location-linked seeded occurrence (the Findmi-place path at Event creation) intentionally stores NO canonical geo of its own — it structurally inherits the Location's at read time (lib/geo/effective-entity-geo.ts), never a redundant copy, for both the two real insert sites that seed one this way", () => {
  // createMemberEvent's own location-hint seed.
  const seed1 = EVENT_ACTIONS.slice(EVENT_ACTIONS.indexOf('location_id: locationHintId,\n          venue_name: location.name'), EVENT_ACTIONS.indexOf('location_id: locationHintId,\n          venue_name: location.name') + 300);
  assert.doesNotMatch(seed1, /geo_place_key|geo_state_key|geo_zcta_key/, "no redundant copy — relies on inheritance via location_id");
  // updateMemberEventLocation's Primary Event Location Relationship seed.
  const seed2 = EVENT_ACTIONS.slice(EVENT_ACTIONS.indexOf("location_id: locationId,\n            venue_name: matchedLocation.name"), EVENT_ACTIONS.indexOf("location_id: locationId,\n            venue_name: matchedLocation.name") + 300);
  assert.doesNotMatch(seed2, /geo_place_key|geo_state_key|geo_zcta_key/, "same invariant at the other seed site");
});

test("The inheritance invariant above actually resolves correctly: effectiveOccurrenceCanonicalGeo, given exactly the shape a freshly-seeded Location-linked occurrence has (no geo of its own, a locationId, the Location's own resolved geo), returns the Location's geography immediately — no edit/import cycle required first", async () => {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith(".")) {
        try {
          return next(specifier, context);
        } catch {
          return next(`${specifier}.ts`, context);
        }
      }
      return next(specifier, context);
    },
  });
  const { effectiveOccurrenceCanonicalGeo } = await import("../src/lib/geo/effective-entity-geo.ts");
  const nashvilleLocation = { place: "place:4752006", zcta: null, state: "state:47" };
  const result = effectiveOccurrenceCanonicalGeo({
    occurrenceGeo: null, // exactly what the seed insert above writes — nothing
    locationId: "loc-nashville",
    locationGeo: nashvilleLocation, // the Location's own, already resolved at ITS OWN creation time
    eventGeo: null, // irrelevant once Location-linked — never consulted
  });
  assert.deepEqual(result, nashvilleLocation, "a brand-new Event's freshly-seeded, Location-linked initial occurrence immediately produces the same effective geography a later edit or import would — no gap, no delay");
});

// ── Business/Brand import — re-verified, N/A confirmed with exact reason ─

test("Business/Brand import genuinely has no deterministic, authoritative signal of a Business's own canonical base geography — city/state exist only as AI-extracted, unverified website content (exactly the 'arbitrary Brand content' category explicitly excluded), never a structured address/postal field a Brand submitted directly — N/A is correct, not a gap", () => {
  const brandImport = read("src/lib/admin/brand-import.ts");
  // The proposal schema's own city/state fields are documented, in this
  // same file, as extracted FROM THE WEBSITE TEXT by the AI step — not a
  // business-submitted structured field, not a ZIP/postal code, not a
  // location tied to an actual appearance/event (which this closure pass
  // was explicitly told never to use as a geography inference source
  // either).
  assert.match(brandImport, /city: z\.string\(\)\.min\(1\)\.max\(80\)\.optional\(\)/);
  assert.match(brandImport, /state: z\.string\(\)\.min\(1\)\.max\(40\)\.optional\(\)/);
  // Confirmed: nothing in this file ties city/state to a postal code, a
  // mailing address, or any field distinct from the free-form extracted
  // profile — there is no second, more authoritative geography signal
  // elsewhere in the brand import pipeline for this closure pass to wire
  // up instead.
  assert.doesNotMatch(brandImport, /postal_code|postalCode|zip\b|address\b/i);

  // And re-confirmed where it actually matters — createBusinessFromCandidate
  // never persists ANY of it onto the created Business row (see the
  // completion pass's own identical test for the full citation).
  const review = read("src/lib/admin/brand-import-review.ts");
  const insertCall = review.slice(review.indexOf("const inserted = await deps.businesses.insert({"), review.indexOf("const inserted = await deps.businesses.insert({") + 400);
  assert.doesNotMatch(insertCall, /\bcity\b|\bstate\b|geo_place_key/);
});
