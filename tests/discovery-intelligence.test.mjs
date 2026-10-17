// Discovery Intelligence V1 + canonical U.S. geography. The REAL pure
// modules (query vocabulary, executor, parser, geography resolution, Census
// file rules, ZIP reader) and the REAL import engine against an in-memory
// writer. Fixture rows mirror the official Census file layouts exactly
// (header names, delimiters, LSAD suffixes) — they are small excerpts for
// tests, never presented as import counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { deflateRawSync } from "node:zlib";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");
const ROOT = process.cwd();
const isFile = (f) => existsSync(f) && statSync(f).isFile();
const withExt = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(isFile);
const js = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
const STUBS = {
  "server-only": "export{}",
  "@/lib/admin/supabase-admin": "export const getAdminSupabase=()=>null;",
  "@/lib/admin/auth": "export async function requireAdmin(){ if(!globalThis.__admin) throw new Error('admin only'); }",
};
registerHooks({
  resolve(specifier, context, next) {
    if (STUBS[specifier] !== undefined) return js(STUBS[specifier]);
    if (specifier.startsWith("@/")) {
      const f = withExt(resolvePath(ROOT, "src", specifier.slice(2)));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.includes("/src/")) {
      const f = withExt(resolvePath(fileURLToPath(new URL(".", context.parentURL)), specifier));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && /\/src\/.*\.tsx?$/.test(url)) {
      const src = readFileSync(fileURLToPath(url), "utf8");
      const out = transform(src, { transforms: ["typescript", "jsx"], jsxRuntime: "automatic", production: true }).code;
      return { format: "module", source: out, shortCircuit: true };
    }
    return next(url, context);
  },
});

const Q = await import("../src/lib/discovery/query.ts");
const E = await import("../src/lib/discovery/engine.ts");
const P = await import("../src/lib/discovery/parse.ts");
const R = await import("../src/lib/geo/resolve-core.ts");
const C = await import("../src/lib/geo/census-format.ts");
const Z = await import("../src/lib/geo/zip.ts");
const I = await import("../src/lib/geo/census-import.ts");
const MIGRATION = readFileSync("supabase/migrations/20261024000000_discovery_intelligence_v1.sql", "utf8");

// Saturday 2026-10-17, 2:00 PM New York (EDT, UTC-4).
const NOW = new Date("2026-10-17T18:00:00Z");

// ------------------------------------------------------------ query

test("Topic queries are strict: unknown keys and bad slugs are rejected", () => {
  assert.equal(Q.validateTopicQuery({ formats: ["pop-up"], when: "weekend" }).ok, true);
  assert.equal(Q.validateTopicQuery({ sql: "drop table" }).ok, false);
  assert.equal(Q.validateTopicQuery({ formats: ["Pop Up!"] }).ok, false);
  assert.equal(Q.validateTopicQuery({ free: false }).ok, false);
});

test("every seeded Topic query in the migration validates", () => {
  const rows = [...MIGRATION.matchAll(/\('([a-z0-9-]+)',\s*'[^']+',\s*'[^']*',\s*'\{[^']*\}',\s*'(\{[^']*\})'/g)];
  assert.ok(rows.length >= 21, `found ${rows.length} topic seeds`);
  for (const [, slug, q] of rows) assert.equal(Q.validateTopicQuery(JSON.parse(q)).ok, true, slug);
});

test("queries round-trip through URLs; invalid params degrade, never throw", () => {
  const q = { when: "weekend", formats: ["pop-up", "sample-sale"], free: true, area: "soho", market: "nyc", text: "vintage", census: "place:4752006" };
  assert.deepEqual(Q.paramsToQuery(Q.queryToParams(q)), q);
  assert.deepEqual(Q.paramsToQuery(new URLSearchParams("when=yesterday&fmt=OK!&q=hats")), { text: "hats" });
  assert.equal(Q.searchHref({}), "/search");
});

test("mergeQueries unions taxonomy and lets a later Topic set the time window", () => {
  const m = Q.mergeQueries({ area: "soho", formats: ["pop-up"] }, { formats: ["sample-sale"], when: "weekend" });
  assert.deepEqual(m, { area: "soho", formats: ["pop-up", "sample-sale"], when: "weekend" });
  assert.deepEqual(Q.entitiesFor(m), ["event", "appearance"]);
  assert.deepEqual(Q.entitiesFor({ area: "soho" }), ["event", "appearance", "place", "business"]);
});

// ------------------------------------------------------------ engine

const item = (over) => ({
  kind: "event", id: over.id, title: over.id, href: `/event/${over.id}`, image: null, subtitle: null,
  start_at: null, end_at: null, start_date: null, end_date: null, created_at: "2026-09-01T00:00:00Z",
  categories: [], formats: [], is_free: null, family_friendly: null, rsvp: false, tickets: false,
  city: "New York", state: "NY", postal_code: null, area: null, is_featured: false, has_description: false,
  haystack: over.id, related: [over.id], ...over,
});
const live = item({ id: "live", start_at: "2026-10-17T16:00:00Z", end_at: "2026-10-17T22:00:00Z", start_date: "2026-10-17", formats: ["pop-up"] });
const tonight = item({ id: "tonight", start_at: "2026-10-17T23:00:00Z", end_at: "2026-10-18T02:00:00Z", start_date: "2026-10-17", is_free: true });
const dateOnlyToday = item({ id: "dateonly", start_date: "2026-10-17", categories: ["family-kids"] });
const sunday = item({ id: "sunday", start_at: "2026-10-18T15:00:00Z", end_at: "2026-10-18T20:00:00Z", start_date: "2026-10-18", categories: ["food-drink", "tastings-drinks"] });
const nextWeek = item({ id: "nextweek", start_at: "2026-10-24T15:00:00Z", end_at: "2026-10-24T20:00:00Z", start_date: "2026-10-24", formats: ["sample-sale"], created_at: "2026-10-15T00:00:00Z" });
const ended = item({ id: "ended", start_at: "2026-10-17T12:00:00Z", end_at: "2026-10-17T15:00:00Z", start_date: "2026-10-17" });
const place = item({ kind: "place", id: "place", city: "Nashville", state: "TN", postal_code: "37203" });
const ALL = [live, tonight, dateOnlyToday, sunday, nextWeek, ended, place];
const ids = (r) => r.items.map((x) => x.item.id).sort();

test("time windows: Here Now is genuinely live; tonight is timed-only; weekend is Fri–Sun", () => {
  assert.deepEqual(E.windowDates("weekend", NOW), { from: "2026-10-17", to: "2026-10-18" });
  assert.deepEqual(E.windowDates("week", NOW), { from: "2026-10-17", to: "2026-10-18" });
  assert.deepEqual(ids(E.executeDiscovery(ALL, { when: "now" }, { now: NOW })), ["live"]);
  assert.deepEqual(ids(E.executeDiscovery(ALL, { when: "tonight" }, { now: NOW })), ["live", "tonight"]);
  assert.deepEqual(ids(E.executeDiscovery(ALL, { when: "today" }, { now: NOW })), ["dateonly", "live", "tonight"]);
  assert.deepEqual(ids(E.executeDiscovery(ALL, { when: "weekend" }, { now: NOW })), ["dateonly", "live", "sunday", "tonight"]);
  assert.ok(!ids(E.executeDiscovery(ALL, {}, { now: NOW })).includes("ended"), "ended items never surface");
});

test("taxonomy is Categories ∪ Formats; free/family/ending-soon/just-announced are real predicates", () => {
  assert.deepEqual(ids(E.executeDiscovery(ALL, { formats: ["pop-up"], categories: ["food-drink"] }, { now: NOW })), ["live", "sunday"]);
  assert.deepEqual(ids(E.executeDiscovery(ALL, { free: true }, { now: NOW })), ["tonight"]);
  assert.deepEqual(ids(E.executeDiscovery(ALL, { family: true }, { now: NOW })), ["dateonly"]);
  assert.deepEqual(ids(E.executeDiscovery(ALL, { endingSoonHours: 6 }, { now: NOW })), ["live"]);
  assert.deepEqual(ids(E.executeDiscovery(ALL, { justAnnouncedDays: 7 }, { now: NOW })), ["nextweek"]);
});

test("Census scopes match an item's own stored city/state/ZIP — never coordinates", () => {
  const nash = { label: "Nashville, TN", usps: "TN", cityKeys: [E.cityKey("Nashville", "TN")] };
  assert.deepEqual(ids(E.executeDiscovery(ALL, {}, { now: NOW, geo: nash })), ["place"]);
  assert.deepEqual(ids(E.executeDiscovery(ALL, {}, { now: NOW, geo: { label: "37203", zips: ["37203"] } })), ["place"]);
  assert.deepEqual(ids(E.executeDiscovery(ALL, {}, { now: NOW, geo: { label: "Tennessee", usps: "TN" } })), ["place"]);
});

test("ranking is transparent: the score is exactly the sum of its explained parts; personal is bounded", () => {
  const r = E.executeDiscovery(ALL, {}, { now: NOW, personal: { relatedIds: new Set(["sunday"]), topicSlugs: new Set(["food-drink"]) } });
  for (const x of r.items) assert.equal(x.score, x.explain.reduce((s, [, n]) => s + n, 0));
  assert.equal(r.items[0].item.id, "live", "Happening Now leads");
  const forYou = r.items.find((x) => x.item.id === "sunday").explain.find(([l]) => l === "For You");
  assert.ok(forYou && forYou[1] <= 12);
});

test("refinements are executable, non-empty, and narrower than the current result", () => {
  const r = E.executeDiscovery(ALL, { entities: ["event"] }, { now: NOW, taxonomyNames: { "pop-up": "Pop-Up", "food-drink": "Food + Drink" }, topCategories: ["food-drink"] });
  assert.ok(r.refinements.length > 0);
  for (const f of r.refinements) {
    assert.ok(f.count > 0 && f.count < r.total, f.label);
    assert.ok(f.href.startsWith("/search"));
    assert.equal(E.executeDiscovery(ALL, f.query, { now: NOW }).total, f.count, f.label);
  }
});

// ------------------------------------------------------------ parser + resolution

const VOCAB = {
  topics: [{ slug: "pop-ups", name: "Pop-Ups", aliases: ["popups"] }, { slug: "sample-sales", name: "Sample Sales" }],
  taxonomy: [{ slug: "pop-up", name: "Pop-Up", kind: "event_format" }, { slug: "food-drink", name: "Food + Drink", kind: "event" }],
  areas: [
    { slug: "manhattan", name: "Manhattan", market: "nyc" },
    { slug: "soho", name: "SoHo", market: "nyc" },
    { slug: "jersey-city", name: "Jersey City", market: "north-jersey" },
  ],
  markets: [{ slug: "nyc", name: "New York City" }, { slug: "north-jersey", name: "North Jersey" }],
};
const parse = (t) => P.parseSearch(t, VOCAB);

test("Findmi vocabulary wins: New York, New York City, Manhattan, SoHo, Jersey City", () => {
  assert.deepEqual(parse("New York").query, { market: "nyc" });
  assert.deepEqual(parse("new york city").query, { market: "nyc" });
  assert.deepEqual(parse("things to do in Manhattan").query, { area: "manhattan", market: "nyc" });
  assert.deepEqual(parse("pop ups in soho this weekend").query, { topics: ["pop-ups"], area: "soho", market: "nyc", when: "weekend" });
  assert.deepEqual(parse("Jersey City").query, { area: "jersey-city", market: "north-jersey" });
  assert.equal(parse("New York").stateUsps, null, "the Market beats the State of the same name");
});

test("States, ZIPs and leftover place names are recognized for Census resolution", () => {
  assert.equal(parse("Tennessee").stateUsps, "TN");
  assert.equal(parse("New Jersey").stateUsps, "NJ");
  assert.equal(parse("10012").zip, "10012");
  assert.equal(parse("07302").zip, "07302");
  assert.equal(parse("37203").zip, "37203");
  const n = parse("free food and drink in Nashville, TN tonight");
  assert.deepEqual(n.phrases, ["nashville"]);
  assert.equal(n.stateUsps, "TN");
  assert.deepEqual({ free: n.query.free, when: n.query.when, categories: n.query.categories }, { free: true, when: "tonight", categories: ["food-drink"] });
  assert.equal(parse("Nashville Tennessee").stateUsps, "TN");
  assert.equal(parse("pizza in Nashville in").stateUsps, null, "lower-case 'in' is not Indiana");
  assert.equal(parse("pop ups near me").nearMe, true);
});

const hit = (geo_key, display_name, state_usps, aland_m2, extra = []) => ({ geo_key, kind: geo_key.split(":")[0], name: display_name, display_name, state_usps, aland_m2, search_names: [C.normalizeSearch(display_name), ...extra] });
const NASH_TN = hit("place:4752006", "Nashville-Davidson", "TN", 1_230_000_000, ["nashville"]);
const NASH_GA = hit("place:1354124", "Nashville", "GA", 12_000_000);
const NASH_AR = hit("place:0548890", "Nashville", "AR", 18_000_000);
const MAPPINGS = [
  { geo_key: "place:3651000", role: "primary", market_slug: "nyc", market_name: "New York City", area_slug: null, area_name: null },
  { geo_key: "county:36061", role: "includes", market_slug: "nyc", market_name: "New York City", area_slug: null, area_name: null },
  { geo_key: "county:36061", role: "primary", market_slug: "nyc", market_name: "New York City", area_slug: "manhattan", area_name: "Manhattan" },
  { geo_key: "county:36061", role: "within", market_slug: "nyc", market_name: "New York City", area_slug: "soho", area_name: "SoHo" },
  { geo_key: "place:3436000", role: "primary", market_slug: "north-jersey", market_name: "North Jersey", area_slug: "jersey-city", area_name: "Jersey City" },
];

test("ambiguous place names are never guessed; a state narrows them deterministically", () => {
  const amb = R.resolvePlacePhrase("Nashville", [NASH_GA, NASH_TN, NASH_AR], MAPPINGS);
  assert.equal(amb.status, "ambiguous");
  assert.deepEqual(amb.options.map((o) => o.label), ["Nashville-Davidson, TN", "Nashville, AR", "Nashville, GA"]);
  const tn = R.resolvePlacePhrase("Nashville", [NASH_GA, NASH_TN, NASH_AR], MAPPINGS, "TN");
  assert.equal(tn.status, "resolved");
  assert.equal(tn.target.geo_key, "place:4752006");
  const scope = R.scopeForCensus(tn.target);
  assert.ok(scope.cityKeys.includes(E.cityKey("Nashville", "TN")), "the consolidated-city alias matches stored 'Nashville'");
});

test("product mappings win; a ZIP maps to the Findmi Area of its dominant county, else stays a ZCTA", () => {
  const nyc = R.resolvePlacePhrase("New York", [hit("place:3651000", "New York", "NY", 780_000_000), hit("place:4852356", "New York", "TX", 1_000)], MAPPINGS);
  assert.deepEqual(nyc.status === "resolved" && nyc.target, { type: "findmi", market: "nyc", area: null, label: "New York City" });
  const z = R.resolveZip("10012", hit("zcta:10012", "10012", null, 1), [{ county_key: "county:36061", land_share: 1 }], MAPPINGS);
  assert.deepEqual(z.target, { type: "findmi", market: "nyc", area: "manhattan", label: "10012 · Manhattan" });
  const nz = R.resolveZip("37203", hit("zcta:37203", "37203", null, 1), [{ county_key: "county:47037", land_share: 1 }], MAPPINGS);
  assert.equal(nz.target.type, "census");
  assert.deepEqual(R.scopeForCensus(nz.target), { label: "37203", zips: ["37203"] });
  assert.equal(R.resolveZip("99999", null, [], MAPPINGS).status, "none");
});

test("a Place is preferred over a County of the same bare name unless 'county' is said", () => {
  const place = hit("place:3651000", "New York", "NY", 1);
  const county = { ...hit("county:36061", "New York County", "NY", 1), search_names: ["new york county", "new york"] };
  assert.equal(R.resolvePlacePhrase("new york", [place, county], []).target.geo_key, "place:3651000");
  assert.equal(R.resolvePlacePhrase("new york county", [place, county], []).target.geo_key, "county:36061");
});

// ------------------------------------------------------------ Census file rules

const STATES_TXT = "STATE|STATEFP|STATENS|STATE_NAME\nNY|36|01779796|New York\nTN|47|01325873|Tennessee\nNJ|34|01779795|New Jersey\n";
const COUNTIES_TXT = "USPS\tGEOID\tANSICODE\tNAME\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG                                                                                                               \nNY\t36061\t00974129\tNew York County\t58690498\t28541727\t22.66\t11.02\t40.776557\t-73.970174\nTN\t47037\t01646676\tDavidson County\t1305478131\t56575208\t504.05\t21.84\t36.169129\t-86.784790\n";
const PLACES_TXT = "USPS\tGEOID\tANSICODE\tNAME\tLSAD\tFUNCSTAT\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG\nNY\t3651000\t02395220\tNew York city\t25\tA\t778189625\t428833458\t300.46\t165.57\t40.6635\t-73.9387\nTN\t4752006\t02405092\tNashville-Davidson metropolitan government (balance)\t00\tF\t1230612094\t50637396\t475.14\t19.55\t36.1715\t-86.7843\nNJ\t3436000\t00885264\tJersey City city\t25\tA\t38315587\t16795049\t14.79\t6.48\t40.7114\t-74.0648\n";
const ZCTAS_TXT = "GEOID\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG\n10012\t1060000\t0\t0.41\t0\t40.7258\t-73.9981\n37203\t9000000\t0\t3.4\t0\t36.1497\t-86.7900\n";
const PLACE_COUNTY_TXT = "STATE|STATEFP|COUNTYFP|COUNTYNAME|PLACEFP|PLACENS|PLACENAME|TYPE|CLASSFP|FUNCSTAT\nNY|36|061|New York County|51000|02395220|New York city|INCORPORATED PLACE|C5|A\nTN|47|037|Davidson County|52006|02405092|Nashville-Davidson metropolitan government (balance)|INCORPORATED PLACE|C7|F\nCT|09|001|Fairfield County|08000|00000000|Bridgeport city|INCORPORATED PLACE|C5|A\n";
const ZCTA_COUNTY_TXT = "OID_ZCTA5_20|GEOID_ZCTA5_20|NAMELSAD_ZCTA5_20|AREALAND_ZCTA5_20|AREAWATER_ZCTA5_20|MTFCC_ZCTA5_20|CLASSFP_ZCTA5_20|FUNCSTAT_ZCTA5_20|OID_COUNTY_20|GEOID_COUNTY_20|NAMELSAD_COUNTY_20|AREALAND_COUNTY_20|AREAWATER_COUNTY_20|MTFCC_COUNTY_20|CLASSFP_COUNTY_20|FUNCSTAT_COUNTY_20|AREALAND_PART|AREAWATER_PART\n1|10012|ZCTA5 10012|1060000|0|G6350|B5|S|2|36061|New York County|58690498|28541727|G4020|H6|C|1060000|0\n3|37203|ZCTA5 37203|9000000|0|G6350|B5|S|4|47037|Davidson County|1305478131|56575208|G4020|H1|A|9000000|0\n||||||||5|36061|New York County|58690498|28541727|G4020|H6|C||\n";

test("Census files parse by header name; official names become searchable display names", () => {
  const places = C.buildPlaces(PLACES_TXT, "2026");
  assert.deepEqual(places.map((p) => [p.geo_key, p.display_name, p.state_usps]), [["place:3651000", "New York", "NY"], ["place:4752006", "Nashville-Davidson", "TN"], ["place:3436000", "Jersey City", "NJ"]]);
  assert.ok(places[1].search_names.includes("nashville"), "consolidated (balance) alias");
  assert.equal(places[0].name, "New York city", "the official name is preserved");
  const counties = C.buildCounties(COUNTIES_TXT, "2026");
  assert.deepEqual(counties[0].search_names, ["new york county", "new york"]);
  assert.equal(counties[1].intpt_lat, 36.169129);
  assert.deepEqual(C.buildStates(STATES_TXT, "2026").map((s) => [s.geo_key, s.state_usps]), [["state:36", "NY"], ["state:47", "TN"], ["state:34", "NJ"]]);
  assert.throws(() => C.buildPlaces("USPS\tNAME\nNY\tX\n", "2026"), /missing expected column GEOID/);
});

test("relationship files: Place↔County, ZCTA↔County with land share, implied ZCTA↔State", () => {
  const pc = C.buildPlaceCountyLinks(PLACE_COUNTY_TXT, "2026");
  assert.deepEqual(pc.map((l) => [l.child_key, l.parent_key]), [["place:3651000", "county:36061"], ["place:4752006", "county:47037"], ["place:0908000", "county:09001"]]);
  const zc = C.buildZctaCountyLinks(ZCTA_COUNTY_TXT, "2026");
  assert.deepEqual(zc.map((l) => [l.child_key, l.parent_key, l.relation, l.land_share]), [
    ["zcta:10012", "county:36061", "zcta_in_county", 1],
    ["zcta:10012", "state:36", "zcta_in_state", 1],
    ["zcta:37203", "county:47037", "zcta_in_county", 1],
    ["zcta:37203", "state:47", "zcta_in_state", 1],
  ]);
  const { links } = C.buildDataset("places", PLACES_TXT, "2026");
  assert.ok(links.every((l) => l.relation === "place_in_state"));
});

// ------------------------------------------------------------ ZIP reader

function makeZip(name, content, method = 8) {
  const data = Buffer.from(content);
  const body = method === 8 ? deflateRawSync(data) : data;
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(method, 10); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(0, 42);
  const cenOffset = local.length + n.length + body.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cen.length + n.length, 12); eocd.writeUInt32LE(cenOffset, 16);
  return Buffer.concat([local, n, body, cen, n, eocd]);
}

test("ZIP reader extracts deflated and stored Gazetteer text", () => {
  assert.equal(Z.readZip(makeZip("2026_Gaz_place_national.txt", PLACES_TXT))[0].data.toString(), PLACES_TXT);
  assert.equal(Z.readZip(makeZip("a.txt", "hello", 0))[0].data.toString(), "hello");
  assert.throws(() => Z.readZip(Buffer.from("not a zip at all, definitely not")), /Not a ZIP/);
});

// ------------------------------------------------------------ import engine

function memoryWriter() {
  const geos = new Map(), links = new Map(), jobs = new Map();
  return {
    geos, links, jobs,
    async getJob(v, d) { return jobs.get(`${v}|${d}`) ?? null; },
    async saveJob(j) { jobs.set(`${j.vintage}|${j.dataset}`, { ...(jobs.get(`${j.vintage}|${j.dataset}`) ?? {}), ...j }); },
    async upsertGeos(rows) { for (const r of rows) geos.set(r.geo_key, { ...r, retired_vintage: null }); },
    async existingKeys(keys) { return new Set(keys.filter((k) => geos.has(k))); },
    async upsertLinks(rows) { for (const r of rows) links.set(`${r.child_key}|${r.parent_key}|${r.relation}`, r); },
    async retire(kind, vintage) { let n = 0; for (const g of geos.values()) if (g.kind === kind && g.vintage !== vintage && !g.retired_vintage) { g.retired_vintage = vintage; n++; } return n; },
  };
}
const FILES = {
  states: Buffer.from(STATES_TXT),
  counties: makeZip("2026_Gaz_counties_national.txt", COUNTIES_TXT),
  places: makeZip("2026_Gaz_place_national.txt", PLACES_TXT),
  zctas: makeZip("2026_Gaz_zcta_national.txt", ZCTAS_TXT),
  place_county: Buffer.from(PLACE_COUNTY_TXT),
  zcta_county: Buffer.from(ZCTA_COUNTY_TXT),
};
const fetchFixture = async (url) => {
  const ds = Object.keys(FILES).find((d) => C.CENSUS_SOURCES[d].url("2026") === url);
  assert.ok(ds, `unexpected URL ${url}`);
  return FILES[ds];
};

async function importAll(writer, maxRows = 2) {
  const steps = [];
  for (const dataset of C.CENSUS_IMPORT_ORDER) {
    for (let guard = 0; guard < 50; guard++) {
      const r = await I.importCensusSlice({ writer, fetchBytes: fetchFixture, dataset, vintage: "2026", maxRows });
      steps.push(r);
      if (r.status === "complete") break;
    }
  }
  return steps;
}

test("the importer is bounded, resumable, link-safe and idempotent on rerun", async () => {
  const w = memoryWriter();
  const steps = await importAll(w, 2);
  assert.ok(steps.filter((s) => s.dataset === "places").length >= 3, "places imported across several bounded slices");
  assert.equal(w.geos.size, 3 + 2 + 3 + 2);
  const skipped = steps.filter((s) => s.dataset === "place_county").reduce((n, s) => n + s.skippedLinks, 0);
  assert.equal(skipped, 1, "a link to a geography not in the import (old CT county) is skipped and counted");
  assert.ok(w.links.has("zcta:10012|county:36061|zcta_in_county"));
  assert.ok(w.links.has("place:3651000|state:36|place_in_state"));
  for (const d of C.CENSUS_IMPORT_ORDER) assert.equal(w.jobs.get(`2026|${d}`).status, "complete", d);
  assert.equal(w.jobs.get("2026|states").source_vintage, "2020 reference codes");

  const before = JSON.stringify([[...w.geos.entries()], [...w.links.entries()]]);
  const rerun = await importAll(w, 1000);
  assert.ok(rerun.every((s) => s.status === "complete" && s.upserted === 0), "completed datasets are skipped");
  for (const d of C.CENSUS_IMPORT_ORDER) await I.importCensusSlice({ writer: w, fetchBytes: fetchFixture, dataset: d, vintage: "2026", maxRows: 1000, restart: true });
  assert.equal(JSON.stringify([[...w.geos.entries()], [...w.links.entries()]]), before, "a forced full re-run changes nothing");
});

test("a newer vintage retires (never deletes) rows it no longer contains; empty files are refused", async () => {
  const w = memoryWriter();
  w.geos.set("place:9999999", { geo_key: "place:9999999", kind: "place", vintage: "2025", retired_vintage: null });
  const r = await I.importCensusSlice({ writer: w, fetchBytes: fetchFixture, dataset: "places", vintage: "2026", maxRows: 100 });
  assert.equal(r.retired, 1);
  assert.equal(w.geos.get("place:9999999").retired_vintage, "2026");
  await assert.rejects(I.importCensusSlice({ writer: memoryWriter(), fetchBytes: async () => Buffer.from("STATE|STATEFP|STATE_NAME\n"), dataset: "states", vintage: "2026", maxRows: 10 }), /refusing to import an empty file/);
});

test("the Admin import step requires an Admin before doing anything", async () => {
  globalThis.__admin = false;
  await assert.rejects(I.runCensusImportStep({ vintage: "2026" }), /admin only/);
  await assert.rejects(I.getCensusStatus("2026"), /admin only/);
});

// ------------------------------------------------------------ migration shape

test("migration: additive, idempotent, neighborhoods hidden, no geometry or demographics", () => {
  assert.doesNotMatch(MIGRATION, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b|postgis|geometry\(/i);
  for (const s of ["soho", "tribeca", "williamsburg", "long-island-city", "astoria", "harlem", "dumbo", "park-slope"]) assert.match(MIGRATION, new RegExp(`'${s}'`));
  assert.match(MIGRATION, /consumer_visible[^;]*false/i);
  assert.doesNotMatch(MIGRATION, /'zcta:1\d{4}'/, "no invented neighborhood → ZIP mappings");
  assert.doesNotMatch(MIGRATION, /'north-jersey',\s*null/, "North Jersey stays unmapped");
  assert.match(MIGRATION, /create table if not exists public\.census_geographies/);
  assert.match(MIGRATION, /create policy[^;]*census_imports|census_imports enable row level security/i);
});
