// Canonical Entity Geography — PRECISION FIX. The Production Dry Run
// exposed that resolveFindmiAlias returned status="resolved" with
// EMPTY_KEYS for every county-kind Findmi alias (Manhattan, Brooklyn,
// Queens, Staten Island, Astoria), overstating 123 backfill rows that
// would have written nothing storable; and that the backfill runner never
// passed the ZIP a row already had, even though resolveEntityGeography's
// own existing precedence (explicit key > ZIP > Findmi alias > city/state
// > state-only) already puts a valid ZCTA ahead of that county alias.
// Same no-database convention as the rest of this suite (CLAUDE.md §4):
// the pure decision layer gets real executed calls; anything requiring a
// live Supabase client (resolveEntityGeography itself, the backfill's own
// DB round-trip) is verified by reading the real source, the same way
// every other DB-touching claim in this suite already is.
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

const { resolveZipForEntity, resolveFindmiAlias, resolvePlaceForEntity, hasAnyKey } = await import("../src/lib/geo/entity-geo-core.ts");

const read = (p) => readFileSync(p, "utf8");
const ENTITY_GEO = read("src/lib/geo/entity-geo.ts");
const BACKFILL = read("src/lib/geo/entity-geo-backfill.ts");

const zcta = (zip) => ({ geo_key: `zcta:${zip}`, kind: "zcta", name: zip, display_name: zip, state_usps: null, aland_m2: 1, search_names: [zip] });

const NYC_BOROUGH_ALIASES = [
  { marketSlug: "nyc", marketName: "New York City", areaSlug: "manhattan", areaName: "Manhattan", names: ["manhattan"], geo_key: "county:36061", geo_kind: "county" },
  { marketSlug: "nyc", marketName: "New York City", areaSlug: "brooklyn", areaName: "Brooklyn", names: ["brooklyn"], geo_key: "county:36047", geo_kind: "county" },
  { marketSlug: "nyc", marketName: "New York City", areaSlug: "queens", areaName: "Queens", names: ["queens"], geo_key: "county:36081", geo_kind: "county" },
  { marketSlug: "nyc", marketName: "New York City", areaSlug: "staten-island", areaName: "Staten Island", names: ["staten island"], geo_key: "county:36085", geo_kind: "county" },
  { marketSlug: "nyc", marketName: "New York City", areaSlug: "astoria", areaName: "Astoria", names: ["astoria"], geo_key: "county:36081", geo_kind: "county" },
];

// ── 1/2/3. ZIP wins over a county-kind Findmi alias ──────────────────────

test("1. Manhattan + NY + 10016 uses the ZCTA path and produces a real, storable result", () => {
  const result = resolveZipForEntity("10016", zcta("10016"), []);
  assert.equal(result.status, "resolved");
  assert.equal(result.keys.zcta, "zcta:10016");
  assert.ok(hasAnyKey(result.keys), "a real key, not the empty-keys the Manhattan county alias alone would have produced");
});

test("1b. resolveEntityGeography tries ZIP strictly before any Findmi alias/city lookup, and returns on a ZIP hit without ever reaching resolveFindmiAlias — so a resolved ZCTA structurally can never be shadowed by the Manhattan/Brooklyn/Queens/Staten Island/Astoria county alias", () => {
  const body = ENTITY_GEO.slice(ENTITY_GEO.indexOf("export async function resolveEntityGeography"));
  const zipBlockAt = body.indexOf("if (zip && /^\\d{5}$/.test(zip))");
  const aliasCallAt = body.indexOf("resolveFindmiAlias(city, areas)");
  assert.ok(zipBlockAt > -1 && aliasCallAt > -1 && zipBlockAt < aliasCallAt, "ZIP branch appears, and appears before the alias lookup");
  // The ZIP branch returns unconditionally — it can't fall through to the
  // alias/city branch below it on any outcome, resolved or not.
  const zipBranch = body.slice(zipBlockAt, body.indexOf("const city = input.city"));
  assert.match(zipBranch, /return resolveZipForEntity\(zip, zcta, mappings\);/);
});

test("1c. The backfill runner now actually supplies the row's own ZIP into resolveEntityGeography — the fix that lets 1/1b apply to a real Manhattan/NY/10016 row, not just the pure function in isolation", () => {
  assert.match(BACKFILL, /resolveEntityGeography\(\{ zip: HAS_POSTAL_COLUMN\[table\] \? row\.postal_code : null, city: row\.city, state: row\.state \}\)/);
});

test("2. Staten Island + NY + a valid Staten Island ZIP produces a real, storable result", () => {
  const result = resolveZipForEntity("10304", zcta("10304"), []);
  assert.equal(result.status, "resolved");
  assert.equal(result.keys.zcta, "zcta:10304");
  assert.ok(hasAnyKey(result.keys));
});

test("3. Brooklyn + NY + a valid Brooklyn ZIP produces a real, storable result", () => {
  const result = resolveZipForEntity("11201", zcta("11201"), []);
  assert.equal(result.status, "resolved");
  assert.equal(result.keys.zcta, "zcta:11201");
  assert.ok(hasAnyKey(result.keys));
});

// ── 4. County-only alias is never a successful "resolved" with nothing ──

test("4. A county-only Findmi alias (Manhattan, Brooklyn, Queens, Staten Island, Astoria) with no usable ZIP is reported 'partial', never 'resolved' with EMPTY_KEYS", () => {
  for (const area of NYC_BOROUGH_ALIASES) {
    const result = resolveFindmiAlias(area.areaName, [area]);
    assert.notEqual(result.status, "resolved", `${area.areaName} must never be a successful resolution — it stores nothing`);
    assert.equal(result.status, "partial", area.areaName);
    assert.deepEqual(result.keys, { place: null, zcta: null, state: null }, area.areaName);
    assert.ok(!hasAnyKey(result.keys), area.areaName);
  }
});

// ── 5. Apply can never stamp geo_resolution with nothing to show for it ──

test("5a. hasAnyKey is the exact invariant: false for EMPTY_KEYS, true the moment any one field is set", () => {
  assert.equal(hasAnyKey({ place: null, zcta: null, state: null }), false);
  assert.equal(hasAnyKey({ place: "place:1", zcta: null, state: null }), true);
  assert.equal(hasAnyKey({ place: null, zcta: "zcta:1", state: null }), true);
  assert.equal(hasAnyKey({ place: null, zcta: null, state: "state:1" }), true);
});

test("5b. The Apply write path requires hasAnyKey(geo.keys) in addition to status — a 'resolved'/'partial' label alone is never enough to write geo_resolution", () => {
  assert.match(BACKFILL, /if \(apply && \(geo\.status === "resolved" \|\| geo\.status === "partial"\) && hasAnyKey\(geo\.keys\)\) \{/);
});

// ── 6/7. No regression in ordinary Place resolution ──────────────────────

test("6. Ordinary city+state Place resolution is unchanged — a single unambiguous Census Place still resolves to its real key", () => {
  const nashvilleTn = { geo_key: "place:4752006", kind: "place", name: "Nashville-Davidson metropolitan government (balance)", display_name: "Nashville-Davidson", state_usps: "TN", aland_m2: 100, search_names: ["nashville davidson", "nashville"] };
  const nashvilleGa = { geo_key: "place:1356072", kind: "place", name: "Nashville city", display_name: "Nashville", state_usps: "GA", aland_m2: 10, search_names: ["nashville"] };
  const result = resolvePlaceForEntity("Nashville", [nashvilleTn, nashvilleGa], [], "TN");
  assert.equal(result.status, "resolved");
  assert.equal(result.keys.place, "place:4752006");
});

test("7. Ambiguous city behavior is unchanged — more than one same-state-filtered Place candidate is never guessed", () => {
  const nashvilleTn = { geo_key: "place:4752006", kind: "place", name: "Nashville-Davidson metropolitan government (balance)", display_name: "Nashville-Davidson", state_usps: "TN", aland_m2: 100, search_names: ["nashville davidson", "nashville"] };
  const nashvilleGa = { geo_key: "place:1356072", kind: "place", name: "Nashville city", display_name: "Nashville", state_usps: "GA", aland_m2: 10, search_names: ["nashville"] };
  const nashvilleNc = { geo_key: "place:3745880", kind: "place", name: "Nashville town", display_name: "Nashville", state_usps: "NC", aland_m2: 20, search_names: ["nashville"] };
  const result = resolvePlaceForEntity("Nashville", [nashvilleTn, nashvilleGa, nashvilleNc], []);
  assert.equal(result.status, "ambiguous");
  assert.ok(result.choices.length >= 2);
});

// ── 8. Location-linked skip behavior is unchanged by this fix ───────────

test("8. The Location-linked occurrence/appearance skip guard (candidate read AND the pre-write re-check) is untouched — this fix only added ZIP input and the hasAnyKey write guard", () => {
  assert.match(BACKFILL, /HAS_LOCATION_ID_COLUMN\[table\]\) query = query\.is\("location_id", null\)/);
  assert.match(BACKFILL, /HAS_LOCATION_ID_COLUMN\[table\]\) updateQuery = updateQuery\.is\("location_id", null\)/);
});

// ── A. postal_code is read only where the table actually has it ─────────

test("A. postal_code is selected only for the four tables that actually have the column — appearances (which has neither postal_code nor geo_zcta_key) never gets one invented", () => {
  assert.match(BACKFILL, /const HAS_POSTAL_COLUMN: Record<BackfillTable, boolean> = \{\n  events: true,\n  event_occurrences: true,\n  locations: true,\n  businesses: true,\n  appearances: false,\n\};/);
  assert.match(BACKFILL, /const selectCols = \(HAS_POSTAL_COLUMN\[table\] \? "id, city, state, postal_code" : "id, city, state"\) as string;/);
  assert.match(BACKFILL, /\.select\(selectCols\)/);
});

test("Backfill still never writes to postal_code/city/state/market_id/market_area_id — reading the row's own ZIP is a SELECT only", () => {
  assert.doesNotMatch(BACKFILL, /\.update\(\{[^}]*postal_code/);
  assert.doesNotMatch(BACKFILL, /\.(update|insert)\(\{[^}]*(market_id|market_area_id)/);
  assert.doesNotMatch(BACKFILL, /\.insert\(/, "only ever updates existing rows");
});
