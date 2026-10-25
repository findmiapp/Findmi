// Discovery Engine + Map V1. The REAL pure modules (query vocabulary + URL
// serialization, time windows, Map/Feed core, parser, chips, geocoding
// rules, structured attributes) and the REAL MapExplorer mounted in jsdom
// with only framework edges stubbed (next/dynamic → a fake canvas that
// records its props, next/link → <a>, images / Save buttons → null, fetch
// and geolocation → recorded fakes). No network, no Production data.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");
const { JSDOM } = require("jsdom");
const ROOT = process.cwd();
const isFile = (f) => existsSync(f) && statSync(f).isFile();
const withExt = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(isFile);
const js = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
const read = (f) => readFileSync(f, "utf8");

const STUBS = {
  "server-only": "export{}",
  "@/components/SupabaseImage": "export default function SupabaseImage(){ return null; }",
  "@/components/EventSaveButton": "export default function EventSaveButton(){ return null; }",
  "@/components/LocationSaveButton": "export default function LocationSaveButton(){ return null; }",
  "@/components/SaveButton": "export default function SaveButton(){ return null; }",
};
const FILE_STUBS = { "next/dynamic": "tests/fixtures/map/dynamic.mjs", "next/link": "tests/fixtures/map/link.mjs" };
registerHooks({
  resolve(specifier, context, next) {
    if (STUBS[specifier] !== undefined) return js(STUBS[specifier]);
    if (FILE_STUBS[specifier]) return { url: pathToFileURL(resolvePath(ROOT, FILE_STUBS[specifier])).href, shortCircuit: true };
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
      const out = transform(read(fileURLToPath(url)), { transforms: ["typescript", "jsx"], jsxRuntime: "automatic", production: true }).code;
      return { format: "module", source: out, shortCircuit: true };
    }
    return next(url, context);
  },
});

const Q = await import("../src/lib/discovery/query.ts");
const T = await import("../src/lib/discovery/time.ts");
const M = await import("../src/lib/discovery/map-core.ts");
const P = await import("../src/lib/discovery/parse.ts");
const CH = await import("../src/lib/discovery/chips.ts");
const A = await import("../src/lib/discovery/attributes.ts");
const G = await import("../src/lib/geo/geocode-core.ts");
const MIGRATION = read("supabase/migrations/20261114000000_discovery_engine_map_v1.sql");

// Saturday 2026-10-17, 2:00 PM New York (EDT, UTC-4).
const NOW = new Date("2026-10-17T18:00:00Z");

const loc = (id, o = {}) => ({ id, name: `Place ${id}`, slug: id, discoverable: true, lat: 40.7233, lng: -74.0030, city: "New York", state: "NY", area: "soho", logo: null, cover: null, hours: null, timezone: null, ...o });
let seq = 0;
const item = (o = {}) => {
  const id = o.id ?? `i${++seq}`;
  return {
    key: `${o.kind === "place" ? "place" : o.kind === "appearance" ? "app" : "occ"}:${id}`,
    kind: "event", id, eventId: `e-${id}`, eventSlug: `e-${id}`, title: id, href: `/event/e-${id}`, image: null, brands: [], location: loc("L1"),
    status: "scheduled", start_at: null, end_at: null, occurrence_date: null, timezone: "America/New_York",
    categories: [], formats: [], is_free: null, family_friendly: null, benefits: [], audience: [], entry: [], rsvp: false, tickets: false,
    featured: false, created_at: null, haystack: ` ${id} `, ...o,
  };
};
const at = (iso) => new Date(iso).toISOString();
const ctx = { now: NOW };
const match = (i, q) => M.matchesMapItem(i, q, ctx);

// ================================================================ geography

test("coordinate validation: range, finiteness, and Null Island are rejected", () => {
  assert.equal(M.isValidCoordinate(40.72, -74), true);
  for (const [la, ln] of [[91, 0], [0, 181], [NaN, 1], [0, 0], ["40", -74], [null, null]]) assert.equal(M.isValidCoordinate(la, ln), false, `${la},${ln}`);
});

test("geocoding: an incomplete address is never sent; a city alone is not a pin", () => {
  assert.equal(G.geocodeQueryFor({ address: "", city: "New York", state: "NY" }).ok, false);
  assert.equal(G.geocodeQueryFor({ address: "200 Fifth Ave", city: "New York" }).ok, false, "needs state or ZIP");
  assert.equal(G.geocodeQueryFor({ address: "TBD", city: "New York", state: "NY" }).ok, false);
  assert.deepEqual(G.geocodeQueryFor({ address: "200 Fifth Ave", city: "New York", state: "NY", postal_code: "10010" }), { ok: true, text: "200 Fifth Ave, New York, NY 10010" });
  assert.equal(G.geocodeQueryFor({ address: "200 Fifth Ave", postal_code: "10010" }).ok, true);
});

test("geocoding: only a precise, unambiguous, in-state answer is stored", () => {
  const good = { lat: 40.7420, lng: -73.9897, accuracy: 1, precision: "rooftop", state: "NY", timezone: "America/New_York" };
  assert.deepEqual(G.decideGeocode([good], "NY"), { status: "resolved", lat: 40.742, lng: -73.9897, timezone: "America/New_York" });
  assert.equal(G.decideGeocode([], "NY").status, "failed");
  assert.equal(G.decideGeocode([{ ...good, precision: "place" }], "NY").status, "ambiguous", "a city centroid is not a pin");
  assert.equal(G.decideGeocode([{ ...good, accuracy: 0.5 }], "NY").status, "ambiguous");
  assert.equal(G.decideGeocode([good, { ...good, lat: 40.9 }], "NY").status, "ambiguous", "two strong matches far apart");
  assert.equal(G.decideGeocode([{ ...good, state: "NJ" }], "NY").status, "ambiguous", "wrong state");
  assert.equal(G.decideGeocode([{ ...good, lat: 0, lng: 0 }], "NY").status, "failed");
});

test("timezone: provider zone wins; single-zone states derive; split states stay unknown", () => {
  assert.equal(G.timezoneFor("America/Chicago", "NY"), "America/Chicago");
  assert.equal(G.timezoneFor(null, "ny"), "America/New_York");
  assert.equal(G.timezoneFor(null, "FL"), null);
  assert.equal(G.timezoneFor(null, "TN"), null);
});

test("changed address: same normalization as SQL; the trigger clears a stale pin and re-queues", () => {
  assert.equal(G.normalizedAddressKey({ address: " 200  Fifth Ave ", city: "New York", state: "NY" }), "200 fifth ave, new york, ny");
  assert.notEqual(G.normalizedAddressKey({ address: "200 Fifth Ave", city: "New York", state: "NY" }), G.normalizedAddressKey({ address: "201 Fifth Ave", city: "New York", state: "NY" }));
  assert.match(MIGRATION, /elsif addr_changed then[\s\S]*new\.latitude := null;[\s\S]*new\.longitude := null;[\s\S]*new\.geocode_status := 'pending';/);
  assert.match(MIGRATION, /-- Typed by hand \(Admin Location form\): a manual correction\.\s*new\.geocode_status := 'manual';/);
  assert.match(MIGRATION, /if new\.geocode_status is distinct from old\.geocode_status then\s*return new;/, "the geocoder's explicit write is authoritative");
});

test("migration: additive, idempotent, no policy/grant change, no backfill, no PostGIS", () => {
  assert.doesNotMatch(MIGRATION, /\b(drop table|drop column|delete from|truncate|create policy|alter policy|grant |revoke |create extension|update public\.)/i);
  assert.match(MIGRATION, /create index if not exists locations_coordinates_idx on public\.locations \(latitude, longitude\) where latitude is not null;/);
  assert.match(MIGRATION, /create index if not exists event_occurrences_location_id_idx/);
  assert.match(MIGRATION, /locations_coordinate_pair_check check \(\(latitude is null\) = \(longitude is null\)\)/);
  for (const col of ["timezone", "geocode_status", "geocode_source", "geocoded_at", "geocode_attempts", "geocode_error", "geocode_address"]) assert.match(MIGRATION, new RegExp(`alter table public\\.locations add column if not exists ${col}\\b`));
  assert.doesNotMatch(MIGRATION, /alter table public\.(events|appearances|event_occurrences) add column if not exists (latitude|longitude)/, "no copied coordinates");
});

test("structured attributes: SQL vocabularies mirror the app's", () => {
  const list = (name) => MIGRATION.match(new RegExp(`${name} <@ array\\[([^\\]]+)\\]`))[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(list("benefits"), [...A.EVENT_BENEFITS]);
  assert.deepEqual(list("audience"), [...A.EVENT_AUDIENCES]);
  assert.deepEqual(list("entry_modes"), [...A.ENTRY_MODES]);
  assert.deepEqual(MIGRATION.match(/geocode_status in \(([^)]+)\)\);\n/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1)), [...G.GEOCODE_STATUSES]);
});

test("non-discoverable Locations stay non-discoverable even with coordinates", () => {
  const hidden = loc("H", { discoverable: false, slug: null });
  assert.equal(match(item({ kind: "place", location: hidden }), { entities: ["place"] }), false);
  assert.equal(match(item({ kind: "place", location: loc("V") }), { entities: ["place"] }), true);
  const src = read("src/lib/discovery/map-server.ts");
  assert.match(src, /slug: discoverable \? \(\(r\.slug as string\) \?\? null\) : null/, "never linked");
  assert.match(src, /applyLocationDiscoveryFilter\(applyGeo\(pq, geo, ""\)\)/, "Place results use the canonical eligibility filter in SQL");
  assert.match(src, /if \(!loc \|\| !loc\.discoverable \|\| !loc\.slug\) continue;/);
});

test("viewport filtering: inside / outside the bounds", () => {
  const bbox = [-74.01, 40.71, -73.99, 40.73];
  assert.equal(match(item({ start_at: at("2026-10-17T19:00:00Z") }), { bbox }), true);
  assert.equal(match(item({ start_at: at("2026-10-17T19:00:00Z"), location: loc("far", { lng: -73.9 }) }), { bbox }), false);
  assert.deepEqual(M.bboxAround(40.7, -74, 1).map((n) => Math.round(n * 1000) / 1000), [-74.019, 40.686, -73.981, 40.714]);
});

test("privacy: hidden-location Events never reach the map; only geography through the Location", () => {
  const src = read("src/lib/discovery/map-server.ts");
  assert.match(src, /fetchHiddenEventIds\(supabase/);
  assert.match(src, /occRows = occRows\.filter\(\(r\) => !hidden\.has\(r\.event_id as string\)\)/);
  assert.doesNotMatch(src, /event:events!inner\([^)]*latitude/, "never an Event's own copied coordinates");
  assert.match(src, /location:locations!inner\(\$\{LOCATION_COLS\}\)/);
});

// ================================================================ time

const occ = (startIso, endIso, o = {}) => item({ start_at: startIso && at(startIso), end_at: endIso && at(endIso), ...o });

test("Happening Now: before / during / after (end removes it from live results)", () => {
  const q = { when: "now" };
  const i = occ("2026-10-17T17:00:00Z", "2026-10-17T20:00:00Z");
  assert.equal(M.matchesMapItem(i, q, { now: new Date("2026-10-17T16:59:00Z") }), false);
  assert.equal(M.matchesMapItem(i, q, { now: new Date("2026-10-17T17:00:00Z") }), true, "starts_at <= now");
  assert.equal(M.matchesMapItem(i, q, { now: new Date("2026-10-17T19:59:00Z") }), true);
  assert.equal(M.matchesMapItem(i, q, { now: new Date("2026-10-17T20:00:00Z") }), false, "ends_at > now is required");
  assert.equal(M.matchesMapItem(i, {}, { now: new Date("2026-10-17T20:00:01Z") }), false, "ended: out of every active window");
  assert.equal(match(occ("2026-10-17T17:00:00Z", null), q), false, "no real end → never live");
});

test("Up Next: not started, starting within the next few hours", () => {
  assert.equal(match(occ("2026-10-17T19:00:00Z", "2026-10-17T21:00:00Z"), { when: "upnext" }), true);
  assert.equal(match(occ("2026-10-17T23:30:00Z", null), { when: "upnext" }), false);
  assert.equal(match(occ("2026-10-17T17:00:00Z", "2026-10-17T21:00:00Z"), { when: "upnext" }), false, "already live");
});

test("timezone correctness: Today is the occurrence's own local day", () => {
  // 01:00 Oct 18 in New York = 22:00 Oct 17 in Los Angeles.
  const now = new Date("2026-10-18T05:00:00Z");
  const la = occ("2026-10-18T05:30:00Z", "2026-10-18T06:30:00Z", { timezone: "America/Los_Angeles", occurrence_date: "2026-10-17" });
  const ny = occ("2026-10-18T13:00:00Z", "2026-10-18T15:00:00Z", { occurrence_date: "2026-10-18" });
  assert.equal(M.matchesMapItem(la, { when: "today" }, { now }), true, "still Oct 17 in LA");
  assert.equal(M.matchesMapItem(ny, { when: "today" }, { now }), true, "already Oct 18 in NY");
  assert.equal(M.matchesMapItem(la, { when: "tomorrow" }, { now }), false);
  // DST: Nov 1 2026 New York falls back.
  assert.equal(new Date(T.zonedInstant("2026-10-31", 12 * 60, "America/New_York")).toISOString(), "2026-10-31T16:00:00.000Z");
  assert.equal(new Date(T.zonedInstant("2026-11-01", 12 * 60, "America/New_York")).toISOString(), "2026-11-01T17:00:00.000Z");
});

test("Today / Tomorrow / weekend boundaries / next week / months", () => {
  assert.deepEqual(T.namedWindowDates("today", NOW), { from: "2026-10-17", to: "2026-10-17" });
  assert.deepEqual(T.namedWindowDates("tomorrow", NOW), { from: "2026-10-18", to: "2026-10-18" });
  assert.deepEqual(T.namedWindowDates("weekend", NOW), { from: "2026-10-17", to: "2026-10-18" }, "Saturday: never back to Friday");
  assert.deepEqual(T.namedWindowDates("weekend", new Date("2026-10-15T16:00:00Z")), { from: "2026-10-16", to: "2026-10-18" }, "Thursday → Fri–Sun");
  assert.deepEqual(T.namedWindowDates("weekend", new Date("2026-10-18T16:00:00Z")), { from: "2026-10-18", to: "2026-10-18" }, "Sunday → Sunday");
  assert.deepEqual(T.namedWindowDates("week", NOW), { from: "2026-10-17", to: "2026-10-18" });
  assert.deepEqual(T.namedWindowDates("next_week", NOW), { from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(T.namedWindowDates("next_week", new Date("2026-10-19T16:00:00Z")), { from: "2026-10-26", to: "2026-11-01" }, "on a Monday: the following Monday");
  assert.deepEqual(T.namedWindowDates("month", NOW), { from: "2026-10-17", to: "2026-10-31" });
  assert.deepEqual(T.namedWindowDates("next_month", NOW), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(T.namedWindowDates("next_month", new Date("2026-12-10T16:00:00Z")), { from: "2027-01-01", to: "2027-01-31" });
});

test("date, date range, month, year — and precedence", () => {
  const nov = occ("2026-11-14T15:00:00Z", "2026-11-14T20:00:00Z", { occurrence_date: "2026-11-14" });
  assert.equal(match(nov, { date: "2026-11-14" }), true);
  assert.equal(match(nov, { date: "2026-11-15" }), false);
  assert.equal(match(nov, { from: "2026-11-10", to: "2026-11-20" }), true);
  assert.equal(match(nov, { from: "2026-11-15", to: "2026-11-20" }), false);
  assert.equal(match(nov, { month: "2026-11" }), true);
  assert.equal(match(nov, { month: "2026-12" }), false);
  assert.equal(match(nov, { year: "2026" }), true);
  assert.equal(match(nov, { date: "2026-11-14", when: "today" }), true, "a specific date beats a named window");
  assert.equal(match(occ(null, null, { occurrence_date: "2026-11-14" }), { month: "2026-11" }), true, "date-only dates match by calendar date");
});

test("time of day: real overlap with the local band; late night runs past midnight; no time → no match", () => {
  const sat = { date: "2026-10-17" };
  assert.equal(match(occ("2026-10-17T19:00:00Z", "2026-10-17T21:00:00Z"), { ...sat, tod: "afternoon" }), true, "3–5 PM");
  assert.equal(match(occ("2026-10-17T19:00:00Z", "2026-10-17T21:00:00Z"), { ...sat, tod: "morning" }), false);
  assert.equal(match(occ("2026-10-18T03:00:00Z", "2026-10-18T05:00:00Z"), { ...sat, tod: "late_night" }), true, "11 PM–1 AM belongs to Saturday late night");
  assert.equal(match(occ(null, null, { occurrence_date: "2026-10-17" }), { ...sat, tod: "evening" }), false);
  assert.equal(match(occ("2026-10-17T20:00:00Z", "2026-10-17T22:00:00Z"), { ...sat, tfrom: "15:00", tto: "18:00" }), true, "custom 3–6 PM");
  assert.equal(match(occ("2026-10-17T23:30:00Z", "2026-10-18T01:00:00Z"), { ...sat, tfrom: "15:00", tto: "18:00" }), false);
});

test("recurring: the Sunday market is live during each Sunday, gone after, next Sunday stays upcoming; one card", () => {
  const sunday = (d) => occ(`${d}T14:00:00Z`, `${d}T19:00:00Z`, { id: `m-${d}`, eventId: "market", occurrence_date: d });
  const dates = ["2026-10-18", "2026-10-25", "2026-11-01"].map(sunday);
  const during = new Date("2026-10-18T16:00:00Z");
  const after = new Date("2026-10-18T19:30:00Z");
  assert.deepEqual(dates.filter((i) => M.matchesMapItem(i, { when: "now" }, { now: during })).map((i) => i.id), ["m-2026-10-18"]);
  assert.deepEqual(dates.filter((i) => M.matchesMapItem(i, { when: "now" }, { now: after })).map((i) => i.id), []);
  assert.deepEqual(dates.filter((i) => M.matchesMapItem(i, {}, { now: after })).map((i) => i.id), ["m-2026-10-25", "m-2026-11-01"]);
  const ranked = dates.map((i) => M.rankMapItem(i, { now: during })).sort(M.compareRankedMap);
  const { items } = M.diversify(ranked, {});
  assert.equal(items.length, 1);
  assert.equal(items[0].item.id, "m-2026-10-18", "the live date leads");
  assert.equal(items[0].item.moreDates, 2);
  assert.equal(ranked[0].item.moreDates, undefined, "inputs are not mutated");
});

test("status: cancelled dates leave active discovery; labels come from real state", () => {
  assert.equal(match(occ("2026-10-17T19:00:00Z", "2026-10-17T21:00:00Z", { status: "cancelled" }), {}), false);
  const live = occ("2026-10-17T16:00:00Z", "2026-10-17T20:00:00Z");
  assert.deepEqual(M.mapStatus(live, NOW), { badge: "LIVE", text: "Ends 4 PM", tone: "live", live: true });
  assert.equal(M.mapStatus(occ("2026-10-17T16:00:00Z", "2026-10-17T18:15:00Z"), NOW).text, "Ends in 15 min");
  assert.equal(M.mapStatus(occ("2026-10-17T18:20:00Z", null), NOW).text, "Starts in 20 min");
  assert.equal(M.mapStatus(occ("2026-10-17T20:00:00Z", null), NOW).text, "Starts 4 PM");
  assert.equal(M.mapStatus(occ("2026-10-17T19:00:00Z", null, { status: "cancelled" }), NOW).text, "Cancelled");
});

test("Open Now: only from real hours for today; unknown is never Closed", () => {
  const hours = { sat: { open: "10:00", close: "18:00" } };
  assert.equal(M.openNowAt(hours, NOW, "America/New_York"), true);
  assert.equal(M.openNowAt(hours, new Date("2026-10-17T23:30:00Z"), "America/New_York"), false);
  assert.equal(M.openNowAt({ mon: { open: "10:00", close: "18:00" } }, NOW), null);
  assert.equal(M.openNowAt(null, NOW), null);
  const p = item({ kind: "place", location: loc("P", { hours: { sat: {} } }) });
  assert.equal(match(p, { entities: ["place"], open: "now" }), false, "unknown hours never qualify as Open Now");
});

// ================================================================ filters

test("category / format Any vs All", () => {
  const i = item({ start_at: at("2026-10-17T19:00:00Z"), categories: ["food-drink"], formats: ["pop-up"] });
  assert.equal(match(i, { categories: ["food-drink", "beauty-wellness"] }), true, "any (default)");
  assert.equal(match(i, { categories: ["food-drink", "beauty-wellness"], catMode: "all" }), false);
  assert.equal(match(i, { categories: ["food-drink"], formats: ["pop-up"], catMode: "all" }), true);
});

test("Brand: canonical Business; Nike OR Adidas; All requires both", () => {
  const nike = { id: "b1", slug: "nike", name: "Nike", logo: null };
  const adidas = { id: "b2", slug: "adidas", name: "Adidas", logo: null };
  const i = item({ start_at: at("2026-10-17T19:00:00Z"), brands: [nike] });
  assert.equal(match(i, { brands: ["nike", "adidas"] }), true);
  assert.equal(match(i, { brands: ["nike", "adidas"], brandMode: "all" }), false);
  assert.equal(match(item({ start_at: at("2026-10-17T19:00:00Z"), brands: [nike, adidas] }), { brands: ["nike", "adidas"], brandMode: "all" }), true);
  assert.equal(match(i, { brands: ["lego"] }), false);
});

test("Free (admission) is not Free Food; Free Food AND Free Drinks; Any of these", () => {
  const s = at("2026-10-17T19:00:00Z");
  const freeEntry = item({ start_at: s, is_free: true });
  const freeFood = item({ start_at: s, benefits: ["free_food"] });
  const foodDrinks = item({ start_at: s, benefits: ["free_food", "free_drinks"] });
  assert.equal(match(freeEntry, { free: true }), true);
  assert.equal(match(freeEntry, { benefits: ["free_food"] }), false, "free admission ≠ free food");
  assert.equal(match(freeFood, { free: true }), false, "free food ≠ free admission");
  assert.equal(match(item({ start_at: s, benefits: ["free_admission"] }), { free: true }), true);
  assert.equal(match(freeFood, { benefits: ["free_food", "free_drinks"] }), false, "AND by default");
  assert.equal(match(foodDrinks, { benefits: ["free_food", "free_drinks"] }), true);
  assert.equal(match(freeFood, { benefits: ["free_food", "free_drinks"], benefitMode: "any" }), true);
  assert.equal(match(item({ start_at: s, is_free: false }), { paid: true }), true);
  assert.equal(match(item({ start_at: s }), { paid: true }), false, "unknown cost is not Paid");
});

test("audience: explicit only; family accepts the existing family signals", () => {
  const s = at("2026-10-17T19:00:00Z");
  assert.equal(match(item({ start_at: s, family_friendly: true }), { family: true }), true);
  assert.equal(match(item({ start_at: s, categories: ["family-kids"] }), { audience: ["family"] }), true);
  assert.equal(match(item({ start_at: s, audience: ["21_plus"] }), { audience: ["21_plus"] }), true);
  assert.equal(match(item({ start_at: s }), { audience: ["21_plus"] }), false, "never inferred");
  assert.equal(match(item({ start_at: s, rsvp: true }), { entry: ["rsvp"] }), true, "existing RSVP counts as RSVP entry");
});

test("geography + time + what combine with AND", () => {
  const q = { bbox: [-74.01, 40.71, -73.99, 40.73], date: "2026-10-17", tod: "afternoon", free: true, categories: ["food-drink"] };
  const ok = item({ start_at: at("2026-10-17T19:00:00Z"), end_at: at("2026-10-17T20:00:00Z"), is_free: true, categories: ["food-drink"] });
  assert.equal(match(ok, q), true);
  assert.equal(match({ ...ok, location: loc("x", { lat: 41 }) }, q), false);
  assert.equal(match({ ...ok, is_free: false }, q), false);
  assert.equal(match({ ...ok, start_at: at("2026-10-17T13:00:00Z"), end_at: at("2026-10-17T14:00:00Z") }, q), false);
});

// ================================================================ query / URL / natural language

test("serialization: every new dimension round-trips through a shareable URL", () => {
  const q = {
    when: "weekend", tod: "afternoon", bbox: [-74.0123, 40.7111, -73.9888, 40.7333], brands: ["lavazza", "nike"], brandMode: "all",
    benefits: ["free_food", "free_drinks"], benefitMode: "any", audience: ["family"], entry: ["walk_in"], paid: true, open: "now",
    categories: ["food-drink"], catMode: "all", area: "soho", market: "nyc", month: "2026-11", year: "2026", from: "2026-11-01", to: "2026-11-05",
    date: "2026-11-02", tfrom: "15:00", tto: "18:00", place: "eataly-flatiron", near: true, radius: 10, offset: 24,
  };
  const back = Q.paramsToQuery(Q.queryToParams(q));
  assert.deepEqual(back, q);
  assert.match(Q.mapHref({ area: "soho", free: true }, "feed"), /^\/map\?area=soho&free=1&view=feed$/);
  assert.equal(Q.queryKey({ brands: ["a", "b"], free: true }), Q.queryKey({ free: true, brands: ["b", "a"] }), "order-independent identity");
  assert.doesNotMatch(Q.queryToParams({ brands: ["lavazza"] }).toString(), /[0-9a-f]{8}-[0-9a-f]{4}/, "slugs, not database ids");
});

test("invalid parameters are dropped, never errors", () => {
  const q = Q.paramsToQuery(new URLSearchParams("bbox=10,10,5,5&month=2026-13&tod=brunch&benefit=free_lunch&benefit=swag&when=someday&tfrom=25:00&brand=Not A Slug&free=yes&q=coffee"));
  assert.deepEqual(q, { text: "coffee" }, "a bad link degrades to a broader search");
  assert.equal(q.bbox, undefined);
  assert.equal(q.month, undefined);
  assert.equal(q.tod, undefined);
  assert.equal(q.when, undefined);
  assert.equal(q.free, undefined);
});

const VOCAB = {
  topics: [{ slug: "pop-ups", name: "Pop-Ups", aliases: ["popups"] }],
  taxonomy: [{ slug: "pop-up", name: "Pop-Up", kind: "event_format" }, { slug: "beauty-wellness", name: "Beauty", kind: "event" }],
  areas: [{ slug: "soho", name: "SoHo", market: "nyc" }, { slug: "manhattan", name: "Manhattan", market: "nyc" }],
  markets: [{ slug: "nyc", name: "New York City" }],
  brands: [{ slug: "lavazza", name: "Lavazza" }, { slug: "nike", name: "Nike" }, { slug: "lego", name: "LEGO" }],
};
const parse = (t) => P.parseSearch(t, VOCAB, { now: NOW }).query;

test("natural language → the SAME structured query (deterministic examples)", () => {
  assert.deepEqual(parse("Free things to do in SoHo Saturday"), { free: true, area: "soho", market: "nyc", date: "2026-10-17" });
  assert.deepEqual(parse("Free food and drink giveaways tomorrow"), { benefits: ["free_food", "free_drinks", "giveaways"], when: "tomorrow" });
  assert.deepEqual(parse("Things to do with kids this weekend"), { family: true, when: "weekend" });
  assert.deepEqual(parse("Coffee pop-ups in Manhattan today"), { topics: ["pop-ups"], area: "manhattan", market: "nyc", when: "today" }, "the Pop-Ups Topic (its own stored query) outranks the same-spelled Format");
  assert.deepEqual(parse("Lavazza events this month"), { brands: ["lavazza"], when: "month" });
  assert.deepEqual(parse("Beauty freebies near me"), { categories: ["beauty-wellness"], benefits: ["free_samples", "free_products", "giveaways", "swag"], benefitMode: "any" });
  assert.deepEqual(parse("Nike events in NYC in November"), { brands: ["nike"], market: "nyc", month: "2026-11" });
  assert.deepEqual(parse("LEGO family events this weekend"), { brands: ["lego"], family: true, when: "weekend" });
  assert.deepEqual(parse("Free coffee samples in SoHo tomorrow afternoon"), { free: true, benefits: ["free_samples"], area: "soho", market: "nyc", when: "tomorrow", tod: "afternoon" });
  assert.equal(P.parseSearch("Beauty freebies near me", VOCAB, { now: NOW }).nearMe, true, "Near Me is surfaced, never guessed");
  assert.deepEqual(P.parseSearch("Coffee pop-ups in Manhattan today", VOCAB, { now: NOW }).phrases, ["coffee"], "unknown words stay text, never invented taxonomy");
});

test("interpretation is visible and editable as chips", () => {
  const p = P.parseSearch("Free coffee samples in SoHo tomorrow", VOCAB, { now: NOW });
  const q = { ...p.query, text: p.phrases.join(" ") };
  const chips = CH.queryChips(q, { areas: { soho: "SoHo" } });
  assert.deepEqual(chips.map((c) => c.label).sort(), ["Coffee", "Free", "Samples", "SoHo", "Tomorrow"].sort());
  const free = chips.find((c) => c.label === "Free");
  assert.equal(free.without.free, undefined, "removing a chip removes exactly that filter");
  assert.equal(free.without.area, "soho");
  assert.deepEqual(CH.queryChips({ brands: ["lavazza"] }, { brands: { lavazza: "Lavazza" } })[0].label, "Lavazza", "the canonical entity name");
});

// ================================================================ map: markers, clusters, ranking, diversity, empty state

test("Location is the anchor: five things at one place = one marker; counts sum to the total", () => {
  const eataly = loc("eataly", { name: "Eataly Flatiron" });
  const lavazza = { id: "lv", slug: "lavazza", name: "Lavazza", logo: "https://x.supabase.co/storage/v1/object/public/l.png" };
  const items = [
    item({ id: "a", start_at: at("2026-10-17T16:00:00Z"), end_at: at("2026-10-17T20:00:00Z"), brands: [lavazza], location: eataly }),
    item({ id: "b", start_at: at("2026-10-17T22:00:00Z"), location: eataly }),
    item({ id: "c", kind: "appearance", start_at: at("2026-10-18T15:00:00Z"), end_at: at("2026-10-18T16:00:00Z"), location: eataly }),
    item({ id: "d", start_at: at("2026-10-17T22:00:00Z"), location: loc("other", { lng: -73.98 }) }),
  ];
  const ranked = items.map((i) => M.rankMapItem(i, { now: NOW })).sort(M.compareRankedMap);
  const f = M.mapFeatures(ranked, {}, NOW);
  assert.equal(f.length, 2);
  const e = f.find((x) => x.locationId === "eataly");
  assert.equal(e.count, 3);
  assert.equal(e.label, "Lavazza", "identity, not taxonomy");
  assert.equal(e.live, true);
  assert.equal(e.status, "Ends 4 PM");
  assert.equal(f.reduce((s, x) => s + x.count, 0), ranked.length, "cluster sums = qualifying results");
  const ev = M.mapFeatures(ranked, { entities: ["event"] }, NOW);
  assert.equal(ev.length, 4, "Events lens: one marker per Event");
});

test("clusters are native layers summing qualifying counts; no per-result DOM markers", () => {
  const canvas = read("src/components/map/DiscoveryMapCanvas.tsx");
  assert.match(canvas, /cluster: true,/);
  assert.match(canvas, /clusterProperties: \{ total: \["\+", \["get", "count"\]\]/);
  assert.match(canvas, /getClusterExpansionZoom/, "tap a cluster → zoom into it");
  assert.equal((canvas.match(/new lib\.Marker\(/g) ?? []).length, 1, "only the selected result gets a DOM marker");
  assert.match(canvas, /"LIVE"/, "live is a word, not only a color");
});

test("ranking: transparent reasons from real signals only", () => {
  const brand = { id: "b1", slug: "nike", name: "Nike", logo: null };
  const r = M.rankMapItem(item({ start_at: at("2026-10-17T19:00:00Z"), brands: [brand], eventId: "e9" }), { now: NOW, personal: { followedIds: new Set(["b1"]), savedIds: new Set(["e9"]) }, matchLabels: ["Coffee", "Free"] });
  assert.deepEqual(r.reasons, ["From a brand you follow", "Saved by you", "Matches Coffee + Free"]);
  const anon = M.rankMapItem(item({ start_at: at("2026-10-17T19:00:00Z") }), { now: NOW });
  assert.deepEqual(anon.reasons, []);
  const live = M.rankMapItem(occ("2026-10-17T17:00:00Z", "2026-10-17T21:00:00Z"), { now: NOW });
  assert.ok(live.score > anon.score, "Happening Now ranks first");
});

test("diversity: one Brand can't dominate mixed discovery; explicit Brand search is never capped", () => {
  const lv = { id: "lv", slug: "lavazza", name: "Lavazza", logo: null };
  const many = Array.from({ length: 6 }, (_, k) => item({ id: `lv${k}`, eventId: `ev${k}`, brands: [lv], featured: true, start_at: at("2026-10-17T19:00:00Z"), location: loc(`p${k}`) }));
  const others = [item({ id: "o1", start_at: at("2026-10-17T20:00:00Z") }), item({ id: "o2", start_at: at("2026-10-17T21:00:00Z") })];
  const ranked = [...many, ...others].map((i) => M.rankMapItem(i, { now: NOW })).sort(M.compareRankedMap);
  const mixed = M.diversify(ranked, {});
  assert.deepEqual(mixed.items.slice(0, 4).map((r) => r.item.id), ["lv0", "lv1", "o1", "o2"]);
  assert.equal(mixed.items.length, 8, "nothing is dropped");
  assert.deepEqual(mixed.overflow.map((o) => [o.brand.slug, o.total]), [["lavazza", 6]]);
  const explicit = M.diversify(ranked, { brands: ["lavazza"] });
  assert.deepEqual(explicit.items.slice(0, 6).map((r) => r.item.id), ["lv0", "lv1", "lv2", "lv3", "lv4", "lv5"]);
  assert.deepEqual(explicit.overflow, []);
});

test("empty state: explicit, one-dimension relaxations — never silently applied", () => {
  const q = { benefits: ["free_food", "giveaways"], free: true, area: "soho", market: "nyc", when: "today", categories: ["food-drink"] };
  const labels = M.relaxationCandidates(q, { taxonomy: { "food-drink": "Food & Drink" } }).map((r) => r.label);
  for (const l of ["Nearby Neighborhoods", "Tomorrow", "Any Date", "Remove Free", "Remove Free Food", "Remove Giveaways", "Remove Food & Drink"]) assert.ok(labels.includes(l), l);
  const tomorrow = M.relaxationCandidates(q).find((r) => r.label === "Tomorrow").query;
  assert.equal(tomorrow.when, "tomorrow");
  assert.equal(tomorrow.free, true, "only that one dimension changes");
  const server = read("src/lib/discovery/map-server.ts");
  assert.match(server, /if \(total === 0 && mapReady\)/, "computed only for an empty result");
  assert.match(server, /\.filter\(\(r\) => r\.count > 0\)/, "only relaxations that return something");
});

test("server: viewport/time/eligibility in the database; bounded; minimal payloads; lazy detail", () => {
  const s = read("src/lib/discovery/map-server.ts");
  assert.match(s, /export const MAX_CANDIDATES = 1500;/);
  assert.match(s, /\.limit\(MAX_CANDIDATES\)/);
  assert.match(s, /gte\(`\$\{prefix\}longitude`, g\.bbox\[0\]\)/);
  assert.match(s, /\.eq\("status", "scheduled"\)/);
  assert.match(s, /\.eq\("event\.is_demo", false\)/);
  assert.match(s, /focusLocation \? items\.filter\(\(r\) => r\.item\.location\.id === opts\.focusLocation\)/);
  const route = read("src/app/api/discovery/map/route.ts");
  assert.match(route, /"Cache-Control": personal \? "private, no-store" : "public, s-maxage=30, stale-while-revalidate=60"/);
  for (const f of ["src/lib/discovery/map-server.ts", "src/lib/discovery/map-core.ts", "src/app/api/discovery/map/route.ts", "src/app/(public)/map/page.tsx"]) assert.doesNotMatch(read(f), /lib\/geo\/geocode/, `${f}: no geocoding during requests`);
});

// ================================================================ MapExplorer in jsdom (sync, Search This Area, privacy)

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://findmi.test/map", pretendToBeVisual: true });
const saved = {};
for (const k of ["window", "document", "navigator", "HTMLElement", "Node", "CSS"]) saved[k] = globalThis[k];
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.CSS = { escape: (s) => s };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.HTMLElement.prototype.scrollTo = () => {};
after(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete globalThis[k];
  dom.window.close();
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { default: MapExplorer } = await import("../src/components/map/MapExplorer.tsx");

const card = (key, featureId, o = {}) => ({ key, kind: "event", title: `Title ${key}`, href: `/event/${key}`, image: null, logo: null, brand: null, brandCount: 0, place: { id: "L", name: "Eataly", href: null, city: "New York" }, when: "Sat, Oct 17", status: { badge: null, text: "Starts 3 PM", tone: "today", live: false }, distanceKm: null, perks: [], free: false, entry: [], reason: null, moreDates: 0, featureId, lng: -74, lat: 40.72, save: null, ...o });
const feature = (id, keys) => ({ id, lng: -74, lat: 40.72, count: keys.length, label: "Eataly", place: "Eataly", status: "Starts 3 PM", live: false, tone: "today", logo: null, locationId: id.slice(4), keys });
const DATA = {
  query: {}, total: 2, features: [feature("loc:A", ["occ:1"]), feature("loc:B", ["occ:2"])], results: [card("occ:1", "loc:A"), card("occ:2", "loc:B")],
  nextOffset: null, overflow: [], chips: [], relaxations: [], truncated: false, mapReady: true, generatedAt: NOW.toISOString(),
};

async function mount(props = {}) {
  const calls = [];
  const geo = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => DATA };
  };
  Object.defineProperty(dom.window.navigator, "geolocation", { value: { getCurrentPosition: (ok) => { geo.push(1); ok({ coords: { latitude: 40.723456, longitude: -74.003456 } }); } }, configurable: true });
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const root = createRoot(host);
  const bbox = [-74.02, 40.70, -73.96, 40.77];
  await act(async () => root.render(React.createElement(MapExplorer, { initialQuery: { bbox }, initialView: "map", initialData: DATA, defaultBbox: bbox, options: { categories: [], formats: [] }, ...props })));
  await act(async () => new Promise((r) => setTimeout(r, 200)));
  return { host, root, calls, geo };
}
const settle = () => act(async () => new Promise((r) => setTimeout(r, 250)));

test("signed-out, no location permission: renders results, never asks for location by itself", async () => {
  const { host, calls, geo, root } = await mount();
  assert.equal(geo.length, 0, "no automatic geolocation request");
  assert.equal(calls.length, 0, "server-rendered first result set — no refetch on mount");
  assert.ok(host.textContent.includes("Title occ:1"));
  assert.ok(host.textContent.includes("2 Results"));
  root.unmount();
});

test("moving the map never fetches; Search This Area applies the viewport query once", async () => {
  const { host, calls, root } = await mount();
  await act(async () => globalThis.__canvas.onViewportChange([-73.99, 40.74, -73.95, 40.78], true));
  await settle();
  assert.equal(calls.length, 0, "panning alone sends nothing");
  const btn = [...host.querySelectorAll("button")].find((b) => b.textContent.includes("Search This Area"));
  assert.ok(btn, "Search This Area appears");
  await act(async () => btn.click());
  await settle();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /bbox=-73\.99%2C40\.74%2C-73\.95%2C40\.78/);
  root.unmount();
});

test("marker → result and result → marker share one selection", async () => {
  const { host, root } = await mount();
  await act(async () => globalThis.__canvas.onSelect("loc:B"));
  await settle();
  assert.equal(globalThis.__canvas.selectedId, "loc:B");
  assert.ok(host.querySelector('[data-result-key="occ:2"][aria-current="true"]'), "the marker's result is highlighted");
  assert.ok(host.textContent.includes("View Event"), "the selected preview offers the canonical page");
  const select = host.querySelector('[data-result-key="occ:1"] button[aria-pressed]');
  await act(async () => select.click());
  await settle();
  assert.equal(globalThis.__canvas.selectedId, "loc:A", "tapping a result selects its marker");
  assert.deepEqual([globalThis.__canvas.focus.lng, globalThis.__canvas.focus.lat], [-74, 40.72], "and pans to it");
  root.unmount();
});

test("filters change map + results together (one query, one request)", async () => {
  const { host, calls, root } = await mount();
  const free = [...host.querySelectorAll("button")].find((b) => b.textContent === "Free");
  await act(async () => free.click());
  await settle();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /free=1/);
  assert.match(window.location.search, /free=1/, "the URL is the shareable query");
  root.unmount();
});

test("Near Me: only after a tap; coarsened; the position never enters the URL", async () => {
  const { host, calls, geo, root } = await mount();
  const near = [...host.querySelectorAll("button")].find((b) => b.textContent.includes("Near Me"));
  await act(async () => near.click());
  await settle();
  assert.equal(geo.length, 1);
  assert.deepEqual(globalThis.__canvas.userPosition, { lat: 40.723, lng: -74.003 }, "~100 m precision, held in memory");
  assert.match(window.location.search, /near=1/);
  assert.doesNotMatch(window.location.search, /bbox=/, "the viewer's area is not in a shareable link");
  assert.equal(calls.length, 1);
  root.unmount();
  const src = read("src/components/map/MapExplorer.tsx") + read("src/components/map/DiscoveryMapCanvas.tsx");
  assert.doesNotMatch(src, /localStorage|sessionStorage|document\.cookie/, "no precise-location persistence");
});

// ================================================================ batch geocoder (fake client + fake provider)

const GEO = await import("../src/lib/geo/geocode.ts");

function fakeAdmin(rows, { mutateBeforeWrite } = {}) {
  const writes = [];
  const q = (table) => {
    const st = { op: "select", filters: [], patch: null, head: false, limit: Infinity };
    const run = () => {
      let out = rows.filter((r) => st.filters.every((f) => f(r)));
      if (st.op === "update") {
        mutateBeforeWrite?.(rows, writes);
        out = rows.filter((r) => st.filters.every((f) => f(r)));
        for (const r of out) Object.assign(r, st.patch);
        writes.push({ patch: st.patch, matched: out.length });
        return { data: out.map((r) => ({ id: r.id })), error: null };
      }
      out = out.slice(0, st.limit);
      return st.head ? { count: out.length, error: null } : { data: out.map((r) => ({ ...r })), error: null };
    };
    const api = {
      select(_c, o) { if (o?.head) st.head = true; return api; },
      update(p) { st.op = "update"; st.patch = p; return api; },
      eq(c, v) { st.filters.push((r) => r[c] === v); return api; },
      is(c, v) { st.filters.push((r) => (r[c] ?? null) === v); return api; },
      in(c, v) { st.filters.push((r) => v.includes(r[c])); return api; },
      lt(c, v) { st.filters.push((r) => r[c] < v); return api; },
      order() { return api; },
      limit(n) { st.limit = n; return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    assert.equal(table, "locations");
    return api;
  };
  return { client: { from: q }, writes };
}
const row = (id, o = {}) => ({ id, name: id, address: "200 Fifth Ave", city: "New York", state: "NY", postal_code: "10010", geocode_status: "pending", geocode_attempts: 0, timezone: null, archived_at: null, trashed_at: null, latitude: null, longitude: null, ...o });
const provider = (answers) => ({ source: "census", geocode: async (text) => { if (answers[text] instanceof Error) throw answers[text]; return answers[text] ?? []; } });

test("batch geocoder: bounded, resolves precise answers, records incomplete / ambiguous / failed honestly", async () => {
  const rows = [row("ok"), row("noaddr", { address: null }), row("vague", { address: "1 Vague St" }), row("down", { address: "9 Down St" }), row("done", { geocode_status: "resolved" })];
  const { client } = fakeAdmin(rows);
  const answers = {
    "200 Fifth Ave, New York, NY 10010": [{ lat: 40.742, lng: -73.9897, accuracy: 0.9, precision: "interpolated", state: "NY" }],
    "1 Vague St, New York, NY 10010": [{ lat: 40.7, lng: -74, accuracy: 0.9, precision: "place", state: "NY" }],
    "9 Down St, New York, NY 10010": new Error("Census geocoder 503"),
  };
  const s = await GEO.runGeocodeBatch(client, { limit: 10, provider: provider(answers), pauseMs: 0 });
  assert.deepEqual({ processed: s.processed, resolved: s.resolved, incomplete: s.incomplete, ambiguous: s.ambiguous, failed: s.failed }, { processed: 4, resolved: 1, incomplete: 1, ambiguous: 1, failed: 1 });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual([by.ok.latitude, by.ok.longitude, by.ok.geocode_status, by.ok.geocode_source, by.ok.timezone], [40.742, -73.9897, "resolved", "census", "America/New_York"]);
  assert.equal(by.noaddr.geocode_status, "incomplete");
  assert.equal(by.vague.latitude, null, "an approximate match is never stored as a pin");
  assert.equal(by.down.geocode_status, "failed");
  assert.equal(by.down.geocode_attempts, 1, "retried later, up to the cap");
  assert.equal(by.done.geocode_attempts, 0, "placed Locations are not re-sent");
  assert.equal(s.remaining, 1, "the failed one stays queued");
});

test("batch geocoder: an address edited mid-batch never receives the stale pin", async () => {
  const rows = [row("moving")];
  const { client, writes } = fakeAdmin(rows, { mutateBeforeWrite: (rs, w) => { if (w.length === 0) rs[0].address = "1 New Address"; } });
  const s = await GEO.runGeocodeBatch(client, { provider: provider({ "200 Fifth Ave, New York, NY 10010": [{ lat: 40.742, lng: -73.9897, accuracy: 1, precision: "rooftop", state: "NY" }] }), pauseMs: 0 });
  assert.equal(writes[0].matched, 0);
  assert.equal(s.skipped, 1);
  assert.equal(rows[0].latitude, null);
});

test("batch size is capped", async () => {
  const rows = Array.from({ length: 40 }, (_, i) => row(`r${i}`, { address: null }));
  const { client } = fakeAdmin(rows);
  const s = await GEO.runGeocodeBatch(client, { limit: 500, provider: provider({}), pauseMs: 0 });
  assert.equal(s.processed, 25);
});
