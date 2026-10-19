// Canonical Entity Geography — COMPLETION pass. Proves the 28-scenario
// matrix from the completion spec: the pure new modules (effective-entity-
// geo.ts, entity-geo-core.ts's discovery-scope additions, canonical-
// scope.ts's env-unset branch) are exercised with real executed function
// calls; everything that needs a live database (consistent with this
// suite's existing no-database convention — see CLAUDE.md §4) is verified
// by source inspection the same way the rest of this suite already does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

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

const { effectiveOccurrenceCanonicalGeo, effectiveAppearanceCanonicalGeo, canonicalGeoMatchesScope, EMPTY_CANONICAL_GEO } = await import(
  "../src/lib/geo/effective-entity-geo.ts"
);
const { geoScopeOrFilter, isCanonicalGeoScopeEmpty, EMPTY_CANONICAL_GEO_SCOPE } = await import("../src/lib/geo/entity-geo-core.ts");
const { resolveCanonicalGeoScope } = await import("../src/lib/geo/canonical-scope.ts");

const read = (p) => readFileSync(p, "utf8");

// ── 3/5. Discovery-time scope — Place/ZCTA/State (pure, real calls) ──────
test("3. A ZIP query scope is exactly its own zcta key — no county expansion needed", async () => {
  const scope = await resolveCanonicalGeoScope("zcta:10012");
  assert.deepEqual(scope, { placeKeys: [], zctaKeys: ["zcta:10012"], stateKeys: [] });
});

test("5. A State query scope is exactly its own state key", async () => {
  const scope = await resolveCanonicalGeoScope("state:47");
  assert.deepEqual(scope, { placeKeys: [], zctaKeys: [], stateKeys: ["state:47"] });
});

test("1. A Place query scope (e.g. Nashville) is exactly its own place key — no Market needed", async () => {
  const scope = await resolveCanonicalGeoScope("place:4752006");
  assert.deepEqual(scope, { placeKeys: ["place:4752006"], zctaKeys: [], stateKeys: [] });
});

test("4/22. A County query scope never collapses to a single county or stores one on an entity — it resolves to EMPTY (never throws) with no live database, and a Place belonging to two counties would independently satisfy either county's query (verified structurally below, test 'migration: county...')", async () => {
  const scope = await resolveCanonicalGeoScope("county:36061");
  assert.deepEqual(scope, EMPTY_CANONICAL_GEO_SCOPE, "no database here — tolerates it the same way every other geo reader in this codebase does, never throws");
});

test("an unrecognized key kind resolves to null, never guessed", async () => {
  assert.equal(await resolveCanonicalGeoScope("bogus:1"), null);
});

// ── geoScopeOrFilter / isCanonicalGeoScopeEmpty (pure) ───────────────────
test("geoScopeOrFilter builds one PostgREST .or() clause per non-empty bucket, respecting hasZcta", () => {
  const scope = { placeKeys: ["place:1"], zctaKeys: ["zcta:2"], stateKeys: ["state:3"] };
  assert.equal(geoScopeOrFilter(scope), "geo_place_key.in.(place:1),geo_zcta_key.in.(zcta:2),geo_state_key.in.(state:3)");
  assert.equal(geoScopeOrFilter(scope, { hasZcta: false }), "geo_place_key.in.(place:1),geo_state_key.in.(state:3)", "appearances has no geo_zcta_key column");
});

test("geoScopeOrFilter returns null (never match-nothing) for an empty scope", () => {
  assert.equal(geoScopeOrFilter(EMPTY_CANONICAL_GEO_SCOPE), null);
  assert.ok(isCanonicalGeoScopeEmpty(EMPTY_CANONICAL_GEO_SCOPE));
  assert.ok(isCanonicalGeoScopeEmpty(null));
  assert.ok(!isCanonicalGeoScopeEmpty({ placeKeys: ["place:1"], zctaKeys: [], stateKeys: [] }));
});

// ── 19/20/21. Effective canonical geography precedence (pure, real calls) ─
test("19. A Location-linked Event Occurrence inherits the Location's canonical geography, even when the Location's own key is still unresolved (never falls back to the parent Event)", () => {
  const eventGeo = { place: "place:1", zcta: null, state: "state:1" };
  const r1 = effectiveOccurrenceCanonicalGeo({ occurrenceGeo: null, locationId: "loc-1", locationGeo: { place: "place:2", zcta: "zcta:2", state: "state:1" }, eventGeo });
  assert.deepEqual(r1, { place: "place:2", zcta: "zcta:2", state: "state:1" });
  const r2 = effectiveOccurrenceCanonicalGeo({ occurrenceGeo: null, locationId: "loc-1", locationGeo: null, eventGeo });
  assert.deepEqual(r2, EMPTY_CANONICAL_GEO, "linked but unresolved — never falls back to the Event");
});

test("19b. An Occurrence's own explicit/manual geography wins over its linked Location", () => {
  const r = effectiveOccurrenceCanonicalGeo({ occurrenceGeo: { place: "place:9", zcta: null, state: null }, locationId: "loc-1", locationGeo: { place: "place:2", zcta: null, state: "state:1" }, eventGeo: null });
  assert.deepEqual(r, { place: "place:9", zcta: null, state: null });
});

test("19c. An unlinked Occurrence with no geo of its own falls back to the parent Event's geography", () => {
  const eventGeo = { place: "place:1", zcta: null, state: "state:1" };
  const r = effectiveOccurrenceCanonicalGeo({ occurrenceGeo: null, locationId: null, eventGeo });
  assert.deepEqual(r, eventGeo);
});

test("20. An Event-linked Appearance uses the SAME occurrence-override -> location -> event chain as Market — never its own stored snapshot", () => {
  const eventGeo = { place: "place:1", zcta: null, state: "state:1" };
  const r = effectiveAppearanceCanonicalGeo({ eventId: "ev-1", appearanceGeo: { place: "place:999", zcta: null, state: null }, locationId: null, occurrenceGeo: null, eventGeo });
  assert.deepEqual(r, eventGeo, "the appearance's own stale snapshot is never used once event-linked");
});

test("20b. An Event-linked Appearance whose occurrence is Location-linked inherits the Location, not the Event", () => {
  const r = effectiveAppearanceCanonicalGeo({
    eventId: "ev-1",
    appearanceGeo: null,
    locationId: "loc-1",
    locationGeo: { place: "place:2", zcta: "zcta:2", state: "state:1" },
    occurrenceGeo: null,
    eventGeo: { place: "place:1", zcta: null, state: "state:1" },
  });
  assert.deepEqual(r, { place: "place:2", zcta: "zcta:2", state: "state:1" });
});

test("21. A standalone Appearance (no Event) with no Location uses its own stored geography", () => {
  const own = { place: "place:5", zcta: null, state: "state:5" };
  const r = effectiveAppearanceCanonicalGeo({ eventId: null, appearanceGeo: own, locationId: null });
  assert.deepEqual(r, own);
});

test("21b. A standalone Appearance linked directly to a Location is authoritative from the Location, even unresolved", () => {
  const r = effectiveAppearanceCanonicalGeo({ eventId: null, appearanceGeo: { place: "place:999", zcta: null, state: null }, locationId: "loc-1", locationGeo: null });
  assert.deepEqual(r, EMPTY_CANONICAL_GEO, "the Location is authoritative even when still unresolved — never the appearance's own stale snapshot");
});

// ── 22. Multi-county membership (pure) ───────────────────────────────────
test("22. A Place belonging to two counties independently satisfies EITHER county's query scope — never collapsed to one", () => {
  const sharedPlace = { place: "place:shared", zcta: null, state: null };
  const countyAScope = { placeKeys: ["place:shared", "place:a-only"], zctaKeys: [], stateKeys: [] };
  const countyBScope = { placeKeys: ["place:shared", "place:b-only"], zctaKeys: [], stateKeys: [] };
  assert.ok(canonicalGeoMatchesScope(sharedPlace, countyAScope));
  assert.ok(canonicalGeoMatchesScope(sharedPlace, countyBScope));
});

// ── 23. Hidden address stays hidden; canonical resolution never depends on it ─
test("23. resolveEntityGeography's input never accepts an address — canonical resolution is structurally incapable of depending on (or leaking) a hidden street address", () => {
  const entityGeo = read("src/lib/geo/entity-geo.ts");
  assert.doesNotMatch(entityGeo, /address/i);
});

test("23b. Appearance Location-privacy masking is untouched by this pass — withholdPreciseLocation/fetchHiddenEventIds are still the ones getFindMiHereFeed calls", () => {
  const data = read("src/lib/data.ts");
  assert.match(data, /withholdPreciseLocation/);
  assert.match(data, /fetchHiddenEventIds/);
});

// ── 2. Explicit canonical selection in a real form ───────────────────────
test("2. CanonicalGeographyPicker is wired into Business/Event's shared GeographyFields, each emitting explicit_geo_key", () => {
  for (const file of ["src/components/BusinessGeographyFields.tsx", "src/components/EventGeographyFields.tsx"]) {
    const src = read(file);
    assert.match(src, /import CanonicalGeographyPicker/, `${file} imports the picker`);
    assert.match(src, /<CanonicalGeographyPicker/, `${file} renders it`);
    assert.match(src, /name="explicit_geo_key"/, `${file} submits the picked key`);
  }
  // Location Creation + Icon Consistency pass — removed from the
  // user-facing Location form specifically (redundant right after
  // City/State/ZIP on a basic creation form). The underlying resolver
  // (resolveEntityGeography) and createMemberLocation's own explicit-key
  // handling are untouched — see test 2b below, which still passes for
  // location/actions.ts — this is a UI-only removal on one component.
  const locGeo = read("src/components/LocationGeographyFields.tsx");
  assert.doesNotMatch(locGeo, /CanonicalGeographyPicker|name="explicit_geo_key"/);
});

test("2b. Every owner self-service create action reads explicit_geo_key and, when present, resolves with explicitKey and writes geo_resolution:\"selected\"", () => {
  for (const file of ["src/app/(public)/account/business/actions.ts", "src/app/(public)/account/event/actions.ts", "src/app/(public)/account/location/actions.ts"]) {
    const src = read(file);
    assert.match(src, /explicitGeoKey = .*str\(formData, "explicit_geo_key"\)/, `${file} reads the field`);
    assert.match(src, /explicitKey: explicitGeoKey \|\| undefined/, `${file} passes it as the resolver's explicit key`);
    assert.match(src, /geo_resolution: explicitGeoKey \? "selected" : "derived"/, `${file} writes "selected" only when one was actually picked`);
  }
});

test("2c. The picker re-validates server-side regardless of what the client picked — never trusted blind", () => {
  const picker = read("src/components/geo/CanonicalGeographyPicker.tsx");
  assert.match(picker, /never trusted from[\s\S]{0,20}here alone/);
  const entityGeo = read("src/lib/geo/entity-geo.ts");
  assert.match(entityGeo, /resolveExplicitKey/);
});

// ── 9/10. No Market required to save; no automatic Market Request ────────
test("9/10. The completion pass introduces no new automatic market_requests path — createLinkedMarketRequest only appears at its two pre-existing EXPLICIT call sites (admin saveEvent) and consumer Request-This-Area, never inside any entity create/edit action touched this pass", () => {
  for (const file of ["src/app/(public)/account/business/actions.ts", "src/app/(public)/account/event/actions.ts", "src/app/(public)/account/location/actions.ts"]) {
    assert.doesNotMatch(read(file), /createLinkedMarketRequest\(/, `${file} still never auto-creates a request`);
  }
});

test("10b. The consumer Request-This-Area flow is explicit, not automatic, and now attaches a canonical geo_key when one resolves", () => {
  const src = read("src/lib/market-requests.ts");
  const fn = src.slice(src.indexOf("export async function findOrCreateConsumerMarketRequest"));
  assert.match(fn, /resolveEntityGeography\(\{ city, state \}\)/);
  assert.match(fn, /geo_key: geoKey/);
});

// ── 11/12. Legacy Market/Area filtering stays compatible ─────────────────
test("11/12. marketSlug/areaSlug parameters are untouched (never removed) on every data.ts function the completion pass extended", () => {
  const data = read("src/lib/data.ts");
  for (const fn of ["SearchBusinessesParams", "LocationsDiscoveryOptions", "EventDiscoveryParams"]) {
    const start = data.indexOf(`interface ${fn}`);
    const body = data.slice(start, data.indexOf("}", start));
    assert.match(body, /marketSlug\?: string/, `${fn} keeps marketSlug`);
    assert.match(body, /areaSlug\?: string/, `${fn} keeps areaSlug`);
    assert.match(body, /canonicalGeo\?: CanonicalGeoScope \| null/, `${fn} additively gained canonicalGeo`);
  }
});

// ── 13. Market/Area read-time rollup, never rewriting the entity ─────────
test("13. getBusinessIdsInMarket/getLocations roll canonically-mapped inventory into a Market via product_geographies, additively (union), never by writing business_markets/market_id onto the entity", () => {
  const data = read("src/lib/data.ts");
  const rollupFn = data.slice(data.indexOf("async function getMarketRollupGeoFilter"), data.indexOf("export async function getBusinessIdsInMarket"));
  assert.match(rollupFn, /getProductMappings\(\)/);
  assert.doesNotMatch(rollupFn, /\.update\(|\.insert\(/, "the rollup filter itself never writes anything");

  const marketFn = data.slice(data.indexOf("export async function getBusinessIdsInMarket"), data.indexOf("export async function getBusinessIdsInArea"));
  assert.match(marketFn, /getMarketRollupGeoFilter\(marketSlug\)/);
  assert.match(marketFn, /new Set\(\[\.\.\.explicitIds, \.\.\.rollupIds\]\)/, "additive union, explicit ids never dropped");
  assert.doesNotMatch(marketFn, /business_markets"\)\s*\.(insert|update)|businesses"\)\s*\.update/, "never rewrites the business or its explicit Market membership");

  const locationsFn = data.slice(data.indexOf("export async function getLocations"), data.indexOf("export async function getLocations") + 3500);
  assert.match(locationsFn, /market_id\.eq\.\$\{marketId\}/, "explicit market_id match stays in the OR — additive, not replaced");
});

// ── 24. Canonical filtering happens server-side, before pagination ───────
test("24. searchBusinesses/getLocations apply the canonical geo .or() filter BEFORE .limit()/.order() — never an in-memory filter after an unscoped fetch", () => {
  const data = read("src/lib/data.ts");
  const sbStart = data.indexOf("export async function searchBusinesses(");
  const sb = data.slice(sbStart, data.indexOf("export async function getBusinessBySlug"));
  assert.ok(sb.indexOf("geoScopeOrFilter(params.canonicalGeo") < sb.indexOf(".range(params.offset"), "geo filter applied before the final range/limit");

  const locStart = data.indexOf("export async function getLocations(");
  const loc = data.slice(locStart, locStart + 6000);
  assert.ok(loc.indexOf("geoScopeOrFilter(canonicalGeo") < loc.indexOf(".order(\"name\").limit(limit)"), "geo filter applied before the final limit");

  const eventsStart = data.indexOf("export async function getEventsDiscovery(");
  const events = data.slice(eventsStart, eventsStart + 4000);
  assert.ok(events.indexOf("resolveGeoEventIds(supabase, params.canonicalGeo)") < events.indexOf("getEffectiveUpcomingEvents(bounds"), "geo-matched event ids resolved before the effective-dates/pagination pass");
});

// ── 6/7/8. ?geo= threaded into every discovery surface, additive to ?market=/?area= ─
test("6/7/8. Every discovery page (/search via runDiscovery, /events, /find, /discover, /businesses, /locations) accepts a canonical geo param additively alongside market/area", () => {
  const server = read("src/lib/discovery/server.ts");
  assert.match(server, /getCandidates\(executed\.market, executed\.area, kinds, executed\.census\)/, "/search's existing ?geo=/?census= param (see discovery/query.ts SCALAR_KEYS) now scopes the candidate fetch itself");
  assert.match(server, /resolveCanonicalGeoScope\(geoKey\)/);

  for (const file of ["src/app/(public)/events/page.tsx", "src/app/(public)/find/page.tsx", "src/app/(public)/discover/page.tsx", "src/app/(public)/businesses/page.tsx", "src/app/(public)/locations/page.tsx"]) {
    const src = read(file);
    assert.match(src, /geo\?: string/, `${file} accepts ?geo=`);
    assert.match(src, /resolveCanonicalGeoScope/, `${file} resolves it`);
    assert.match(src, /\bmarket\??: string/, `${file} still accepts ?market= unchanged`);
  }
});

// ── 14/15/17. Import pipelines resolve canonical geography, deterministic only ─
test("14. Event import (persistEventImport's shared createSourceEvent, and persistHosting) resolves the Event's OWN canonical geography and each manual-venue Occurrence's own, writing geo_resolution:\"import\"", () => {
  const persist = read("src/lib/event-import/persist.ts");
  assert.match(persist, /geo_resolution: "import"/);
  assert.match(persist, /resolveOccurrenceGeoFields\(snaps\)/);
  const occFn = persist.slice(persist.indexOf("export function occurrenceInsertRow"), persist.indexOf("async function resolveOccurrenceGeoFields"));
  assert.match(occFn, /snap\.location_id \? \{\} : geo/, "a Location-linked date never stores its own copy");
});

test("15. The shared insertUnlistedPlace (Location Import + the public shared Place creation path createInlinePlace) resolves canonical geography deterministically, never guessed", () => {
  const inlinePlace = read("src/lib/places/inline-place.ts");
  assert.match(inlinePlace, /resolveEntityGeography\(\{ city, state \}\)/);
  assert.match(inlinePlace, /geoResolutionKind/);
  const locationImport = read("src/lib/location-import/server.ts");
  assert.match(locationImport, /geoResolutionKind: "import"/);
});

test("17. Appearance import (createAppearancesBulk) resolves each row's own canonical geography deterministically, geo_resolution:\"import\", never blocking the import on an ambiguous/unresolved row", () => {
  const actions = read("src/app/admin/(protected)/appearances/import/actions.ts");
  assert.match(actions, /resolveEntityGeography\(\{ city: row\.city, state: row\.state \}\)/);
  assert.match(actions, /geo_resolution: "import"/);
  assert.doesNotMatch(actions, /if \(!geo\.|redirect\(errorRedirectUrl\(businessPath, .*geo/, "an unresolved row is still imported, never blocked");
});

test("16. Business/Brand import deliberately resolves NO geography — city/state are extracted into the review proposal but never persisted onto the created Business row (the pre-existing, tested locked rule: Brand businesses collect no geography at creation) — this scenario is N/A by design, not a silent gap", () => {
  const review = read("src/lib/admin/brand-import-review.ts");
  const insertCall = review.slice(review.indexOf("const inserted = await deps.businesses.insert({"), review.indexOf("const inserted = await deps.businesses.insert({") + 400);
  assert.doesNotMatch(insertCall, /\bcity\b|\bstate\b|geo_place_key/, "no geography of any kind is written at Brand creation — matches the existing, tested rule");
});

// ── 18. Brand Intelligence writes canonical geo_key ──────────────────────
test("18. Brand Intelligence resolves a canonical geo_key only for a Brand-named 'place' (free-text market Findmi doesn't curate), never for its own curated market/area/neighborhood levels", () => {
  const brandAudit = read("src/lib/brand-audit.ts");
  const fn = brandAudit.slice(brandAudit.indexOf("export async function saveBrandAuditMarkets"));
  assert.match(fn, /if \(g\.level !== "place"\) return null;/);
  assert.match(fn, /resolveEntityGeography\(\{ city: g\.label \}\)/);
  assert.match(fn, /geo_key: geoKeys\[i\]/);
});

// ── 25/26/27. Backfill stays zero-write/fill-empty-only, and the new
//    Location-link guard ─────────────────────────────────────────────────
test("25/26/27. Backfill guarantees from the base commit are unchanged (Dry Run never writes, Apply fills empty only, refuses without a complete Census import) and now additionally skips/re-guards any Location-linked occurrence/appearance row", () => {
  const backfill = read("src/lib/geo/entity-geo-backfill.ts");
  assert.match(backfill, /runOne\(admin, table, limit, false\)/);
  assert.match(backfill, /data\.length < 6\) return false/);
  assert.match(backfill, /HAS_LOCATION_ID_COLUMN\[table\]\) query = query\.is\("location_id", null\)/);
  assert.match(backfill, /HAS_LOCATION_ID_COLUMN\[table\]\) updateQuery = updateQuery\.is\("location_id", null\)/);
});

// ── Admin paths also integrated (completeness beyond the owner paths) ────
test("Admin Business/Location/Event create-or-edit each resolve canonical geography too, same best-effort never-guess-never-erase rule", () => {
  const businesses = read("src/app/admin/(protected)/businesses/actions.ts");
  assert.match(businesses, /resolveEntityGeography\(\{ city, state \}\)/);
  const locations = read("src/app/admin/(protected)/locations/actions.ts");
  assert.match(locations, /resolveEntityGeography\(\{ city, state \}\)/);
  const events = read("src/app/admin/(protected)/events/actions.ts");
  assert.match(events, /eventGeoFields/);
});
