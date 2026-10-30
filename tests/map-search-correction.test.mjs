// Map search correction. Free text is relevance over an item's canonical
// searchable text (names + real category / Brand / taxonomy relationships),
// kept separate from geography, time and structured filters; a search's
// derived filters never outlive it; Clear removes the text completely; the
// latest intent owns the rendered results.
//
// Server: the REAL route + Discovery Engine over an in-memory PostgREST
// (tests/fixtures/map/fake-db.mjs) seeded with the production shape of the
// Babylist SoHo / Lavazza Tabli / coffee rows. Client: the REAL MapExplorer
// in jsdom, its fetches answered by that same route.
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
const read = (f) => readFileSync(f, "utf8");
const isFile = (f) => existsSync(f) && statSync(f).isFile();
const withExt = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(isFile);
const js = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
const STUBS = {
  "server-only": "export{}",
  "next/server": "export const NextResponse = { json: (body, init) => ({ json: async () => body, init }) };",
  "@/lib/supabase": "export const getSupabase = () => globalThis.__db;",
  "@/lib/supabase/server": "export async function getServerSupabase(){ throw new Error('no session in tests'); }",
  "@/lib/privacy/consent-server": "export async function getAccountPrivacy(){ return {}; }",
  "@/lib/data": "export async function getAreaScopeIds(_s, id){ return [id]; } export const getEventsDiscovery = async () => []; export const getFindMiHereFeed = async () => []; export const getLocations = async () => []; export const searchBusinesses = async () => [];",
  "@/components/SupabaseImage": "export default function SupabaseImage(){ return null; }",
  "@/components/EventSaveButton": "export default function EventSaveButton(){ return null; }",
  "@/components/LocationSaveButton": "export default function LocationSaveButton(){ return null; }",
  "@/components/SaveButton": "export default function SaveButton(){ return null; }",
};
const FILE_STUBS = { "next/dynamic": "tests/fixtures/map/dynamic.mjs", "next/link": "tests/fixtures/map/link.mjs" };
registerHooks({
  resolve(specifier, context, next) {
    if (STUBS[specifier] !== undefined) return js(STUBS[specifier]);
    // Server modules use React's request `cache` (a react-server export).
    if (specifier === "react" && context.parentURL?.includes("/src/lib/discovery/")) return js("export const cache = (fn) => fn;");
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
      return { format: "module", source: transform(read(fileURLToPath(url)), { transforms: ["typescript", "jsx"], jsxRuntime: "automatic", production: true }).code, shortCircuit: true };
    }
    return next(url, context);
  },
});

const { fakeDb } = await import("./fixtures/map/fake-db.mjs");
const M = await import("../src/lib/discovery/map-core.ts");
const P = await import("../src/lib/discovery/parse.ts");
const SS = await import("../src/lib/discovery/search-state.ts");

// ---------------------------------------------------------------- fixture (production shape, read-only copies)

const H = 3600e3;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
// An occurrence's calendar date is its own LOCAL date (New York), never the
// UTC one — they differ every evening from 8 PM ET.
const nyDate = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const IMG = "https://drcbrzwchlirfspjgtik.supabase.co/storage/v1/object/public/findmi-media/x.jpg";
const NYC = "6d9a915c-0636-4e4f-a04b-3348cd0313ee";
const SOHO = "0e580f5b-8ef7-4ad7-9ae7-e4faf896f436";
const loc = (id, name, lat, lng, extra = {}) => ({ id, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), latitude: lat, longitude: lng, city: "New York", state: "NY", is_demo: false, logo_url: IMG, cover_image_url: IMG, market_area_id: null, market_id: NYC, hours: null, parent_location_id: null, category_id: null, ...extra });
const BABYLIST_SOHO = loc("b70ecb01-835a-4a04-bcf8-f717ed3bef14", "Babylist Soho", 40.721477, -74.000315, { market_area_id: SOHO, category_id: "cat-retail" });
const EATALY = loc("0848822e-2445-4062-8c5d-739779924029", "Eataly Chiosco", 40.740896, -73.989, { category_id: "cat-cafe" });
const CORGI = loc("660d3744-0000-4000-8000-000000000001", "Corgi Cafe NYC", 40.7296, -73.991, { category_id: "cat-cafe" });
const GALLERY = loc("aaaa0000-0000-4000-8000-000000000001", "Spring Studios", 40.7215, -74.008, { category_id: "cat-venue" });
const TABLI = { id: "0b99102d-a8af-4ea9-adda-34b37e4c52d1", slug: "lavazza-tabli", name: "Lavazza Tabli Sampling NYC Pop-Up x Eataly Flatiron at Madison Square Park", cover_image_url: IMG, is_demo: false, is_free: true, family_friendly: null, rsvp_enabled: false, rsvp_url: null, tickets_enabled: false, tickets_url: null, host_business_id: "biz-lavazza", is_featured: false, created_at: iso(NOW - 30 * 24 * H), start_at: null, end_at: null, venue_name: "Eataly Flatiron", organizer_name: null, benefits: [], audience: [], entry_modes: [] };
const TABLE = {
  locations: [BABYLIST_SOHO, EATALY, CORGI, GALLERY],
  businesses: [
    { id: "biz-babylist", slug: "babylist", name: "Babylist", logo_url: null, cover_image_url: null, is_demo: false, publication_status: "live" },
    { id: "biz-lavazza", slug: "lavazza", name: "Lavazza", logo_url: null, cover_image_url: null, is_demo: false, publication_status: "live" },
  ],
  business_locations: [{ location_id: BABYLIST_SOHO.id, business_id: "biz-babylist" }],
  business_location_availability: [],
  business_categories: [{ business_id: "biz-lavazza", category_id: "cat-coffee-brand" }, { business_id: "biz-babylist", category_id: "cat-kids-brand" }],
  categories: [
    { id: "cat-food", name: "Food & Drink", slug: "food-drink", kind: "event", parent_id: null },
    { id: "cat-coffee-tea", name: "Coffee & Tea", slug: "coffee-tea", kind: "event", parent_id: "cat-food" },
    { id: "cat-popup", name: "Pop-Up", slug: "pop-up", kind: "event_format", parent_id: null },
    { id: "cat-cafe", name: "Café / Coffee Shop", slug: "cafe-coffee-shop", kind: "location", parent_id: null },
    { id: "cat-retail", name: "Retail Store", slug: "retail-store", kind: "location", parent_id: null },
    { id: "cat-venue", name: "Event Venue", slug: "event-venue", kind: "location", parent_id: null },
    { id: "cat-coffee-brand", name: "Coffee, Tea & Beverages", slug: "coffee", kind: "business", parent_id: null },
    { id: "cat-kids-brand", name: "Kids & Baby", slug: "kids-baby", kind: "business", parent_id: null },
  ],
  events: [TABLI, { ...TABLI, id: "ev-gallery", slug: "fall-art-walk", name: "Fall Art Walk", host_business_id: null, venue_name: null }],
  // Tabli: one date two days out — eligible "anytime", not Happening Now.
  event_occurrences: [
    { id: "occ-tabli", event_id: TABLI.id, location_id: EATALY.id, start_at: iso(NOW + 48 * H), end_at: iso(NOW + 60 * H), occurrence_date: nyDate(NOW + 48 * H), timezone: "America/New_York", status: "scheduled", created_at: TABLI.created_at },
    { id: "occ-art", event_id: "ev-gallery", location_id: GALLERY.id, start_at: iso(NOW - H), end_at: iso(NOW + 3 * H), occurrence_date: nyDate(NOW), timezone: "America/New_York", status: "scheduled", created_at: TABLI.created_at },
  ],
  event_categories: [],
  event_formats: [],
  event_businesses: [{ event_id: TABLI.id, business_id: "biz-lavazza", participation_scope: "event", display_order: 0, status: "approved" }],
  event_occurrence_businesses: [],
  appearances: [],
  discovery_topics: [
    { id: "t-now", slug: "happening-now", name: "Happening Now", description: null, image_url: null, aliases: ["now", "right now", "live"], query: { when: "now" }, sort_order: 10, is_active: true },
    { id: "t-popups", slug: "pop-ups", name: "Pop-Ups", description: null, image_url: null, aliases: ["pop up", "pop ups", "popup", "popups"], query: { formats: ["pop-up"] }, sort_order: 110, is_active: true },
    { id: "t-food", slug: "food-drink", name: "Food + Drink", description: null, image_url: null, aliases: ["food", "drink", "food and drink", "coffee", "restaurant"], query: { categories: ["food-drink"] }, sort_order: 210, is_active: true },
    { id: "t-family", slug: "family-friendly", name: "Family Friendly", description: null, image_url: null, aliases: ["family", "kids", "for kids"], query: { family: true }, sort_order: 330, is_active: true },
  ],
  markets: [{ id: NYC, slug: "nyc", name: "New York City", display_name: null, active: true, consumer_visible: true }],
  market_areas: [{ id: SOHO, market_id: NYC, name: "SoHo", slug: "soho", display_name: "SoHo", aliases: null, active: true, consumer_visible: false, sort_order: 101, parent_area_id: null, level: "neighborhood" }],
  census_geographies: [],
  census_geography_links: [],
};
globalThis.__db = fakeDb(TABLE);

const BBOX = [-74.025, 40.7, -73.955, 40.77];
const R = await import("../src/app/api/discovery/map/route.ts");
const { queryToParams } = await import("../src/lib/discovery/query.ts");
const api = async (url) => (await R.GET({ nextUrl: { searchParams: new URL(url, "https://findmi.test").searchParams } })).json();
const search = (nl, q = { bbox: BBOX }) => api(`/api/discovery/map?${queryToParams(q)}&nl=${encodeURIComponent(nl)}`);
const titles = (d) => d.results.map((c) => c.title).sort();

// ---------------------------------------------------------------- literal matching (pure predicate)

const place = (name, hay) => ({ key: `place:${name}`, kind: "place", id: name, eventId: null, title: name, href: "/location/x", image: null, brands: [], location: { id: name, name, slug: "x", discoverable: true, lat: 40.72, lng: -74, city: "New York", state: "NY", area: "soho", logo: null, cover: null, hours: null, timezone: null }, status: "scheduled", start_at: null, end_at: null, categories: [], formats: [], is_free: null, family_friendly: null, benefits: [], audience: [], entry: [], rsvp: false, tickets: false, featured: false, created_at: null, haystack: hay });

test("literal text: word-prefix, case-, accent- and whitespace-insensitive", () => {
  const hay = M.haystackOf("Babylist Soho", "New York", "Babylist", "Retail Store", "Kids & Baby");
  for (const t of ["baby", "babylist", "BABY", "  Baby  ", "Babylist   SoHo", "soho", "bab"]) assert.equal(M.matchesText(hay, t), true, t);
  assert.equal(M.matchesText(hay, "list"), false, "partial matching is intentional: a typed word must begin a word, not sit inside one");
  assert.equal(M.matchesText(hay, "baby tabli"), false, "every typed word must match");
  assert.equal(M.matchesText(M.haystackOf("Café / Coffee Shop"), "cafe"), true, "accents fold");
  const now = new Date();
  assert.equal(M.matchesMapItem(place("Babylist Soho", hay), { text: "baby" }, { now }), true);
  assert.equal(M.matchesMapItem(place("Babylist Soho", hay), { text: "babylist" }, { now }), true);
});

test("taxonomy terms come from canonical Topic → Category / Format links only", () => {
  const names = new Map([["food-drink", "Food & Drink"], ["coffee-tea", "Coffee & Tea"], ["pop-up", "Pop-Up"]]);
  const topics = TABLE.discovery_topics.map((t) => ({ ...t }));
  const terms = M.taxonomyTerms(["coffee-tea", "food-drink"], [], names, topics);
  assert.ok(terms.includes("Coffee & Tea") && terms.includes("coffee"), "a Food & Drink Event answers the Food + Drink Topic's own aliases");
  assert.deepEqual(M.taxonomyTerms([], [], names, topics), [], "an uncategorized item gains nothing — no inference");
  assert.equal(M.isTaxonomyTopic(topics[0]), false, "Happening Now is time, not subject");
  assert.equal(M.isTaxonomyTopic(topics[3]), false, "Family Friendly is an eligibility flag");
  assert.equal(M.isTaxonomyTopic(topics[2]), true);
});

// ---------------------------------------------------------------- server: the real route

test('"baby", "babylist", "BABY  " find Babylist SoHo; "soho" finds it through SoHo', async () => {
  for (const nl of ["baby", "babylist", "BABY  ", "Babylist SoHo"]) assert.ok(titles(await search(nl)).includes("Babylist Soho"), nl);
  const soho = await search("soho");
  assert.deepEqual(titles(soho), ["Babylist Soho"]);
  assert.match(soho.interpretation.params, /area=soho/, "a typed place is geography");
  const baby = await search("baby");
  assert.match(baby.interpretation.params, /q=baby/);
  assert.match(baby.interpretation.params, /bbox=/, "text keeps the viewport it was typed in");
});

test('"tabli" finds Lavazza Tabli when time permits; an explicit Happening Now excludes it while it is not live', async () => {
  assert.ok(titles(await search("tabli")).some((t) => t.startsWith("Lavazza Tabli")));
  const now = await search("tabli", { bbox: BBOX, when: "now" });
  assert.equal(now.total, 0, "the explicit time lens stays in force");
  assert.match(now.interpretation.params, /when=now/);
  assert.ok((await search("art", { bbox: BBOX, when: "now" })).total === 1, "while a live Event still answers Happening Now");
});

test('"coffee" reaches Places and Events through real Location / Brand categories (not an Event-only filter)', async () => {
  const d = await search("coffee");
  const t = titles(d);
  assert.ok(t.includes("Eataly Chiosco") && t.includes("Corgi Cafe NYC"), "Location category Café / Coffee Shop");
  assert.ok(t.some((x) => x.startsWith("Lavazza Tabli")), "the Event's Brand Lavazza is Coffee, Tea & Beverages");
  assert.ok(!t.includes("Babylist Soho") && !t.includes("Spring Studios") && !t.includes("Fall Art Walk"), "nothing without a real coffee relationship");
  assert.doesNotMatch(d.interpretation.params, /topic=|cat=/, "subject words are relevance on the Map, not a hidden Event-taxonomy filter");
  assert.match(d.interpretation.params, /q=coffee/);
  const kept = await search("coffee", { bbox: BBOX, topics: ["food-drink"] });
  assert.match(kept.interpretation.params, /topic=food-drink/, "a Topic the viewer chose explicitly is never dropped");
});

test("text never broadens or replaces explicit geography; only a typed place does", async () => {
  const inSoho = await search("tabli", { area: "soho", market: "nyc" });
  assert.equal(inSoho.total, 0, "Tabli is not in SoHo — the active Area holds");
  assert.match(inSoho.interpretation.params, /area=soho/);
  const both = await search("baby", { area: "soho", market: "nyc", bbox: BBOX });
  assert.match(both.interpretation.params, /bbox=/, "an Area the viewer already had doesn't throw away their viewport");
});

// ---------------------------------------------------------------- search state (pure)

test("a search's derived filters are its own; Clear and the next search remove them, explicit filters stay", () => {
  const base = { bbox: BBOX, when: "today", topics: ["pop-ups"] };
  const next = { ...base, brands: ["babylist"], free: true, text: "baby" };
  const derived = SS.derivedFrom(next, base);
  assert.deepEqual(derived, { brands: ["babylist"], free: true });
  assert.deepEqual(SS.clearedQuery(next, derived), base, "Clear: no text, no derived Brand / Free; time, Topic and bbox untouched");
  assert.deepEqual(SS.clearedQuery({ bbox: BBOX, when: "today", topics: ["pop-ups"], brands: ["babylist"], text: "baby" }, derived), base, "a derived filter the viewer already removed is simply gone");
  const parsed = P.parseSearch("coffee", { topics: TABLE.discovery_topics.map((t) => ({ slug: t.slug, name: t.name, aliases: t.aliases })), taxonomy: [], areas: [], markets: [] }, { now: new Date() });
  const asText = SS.subjectWordsAsText(parsed.query, parsed.recognized, {}, TABLE.discovery_topics, M.isTaxonomyTopic);
  assert.deepEqual(asText, { text: "coffee" });
});

// ---------------------------------------------------------------- client: the real MapExplorer

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => act(async () => wait(300));

/** Mount with the real route behind fetch. `delay(url)` holds a response
 * back (ms) — and late responses still resolve: abort is not relied on. */
async function mount(delay = () => 0) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const body = await api(u);
    await wait(delay(u));
    return { ok: true, json: async () => body };
  };
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const root = createRoot(host);
  const initialData = await api(`/api/discovery/map?${queryToParams({ bbox: BBOX })}`);
  await act(async () => root.render(React.createElement(MapExplorer, { initialQuery: { bbox: BBOX }, initialView: "map", initialData, defaultBbox: BBOX, options: { categories: [], formats: [] } })));
  await settle();
  return { host, root, calls };
}
const btn = (host, label) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === label || b.getAttribute("aria-label") === label);
const shown = (host) => [...host.querySelectorAll('section[aria-label="Results"] [data-result-key]')].map((e) => e.querySelector("button span, a")?.textContent ?? "");
const countLine = (host) => host.querySelector('section[aria-label="Results"]').textContent.match(/(\d+) Results?/)?.[1];
const input = (host) => host.querySelector('input[type="search"]');
async function type(host, value) {
  const el = input(host);
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function submit(host, value) {
  await type(host, value);
  await act(async () => host.querySelector('form[role="search"]').dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  await settle();
}
const last = (calls) => new URL(calls.at(-1), "https://findmi.test").searchParams;

test('regression: "baby" → re-submit → Happening on/off still shows Babylist SoHo (no stale skipped fetch)', async () => {
  const { host, root, calls } = await mount();
  await submit(host, "baby");
  assert.deepEqual(shown(host), ["Babylist Soho"]);
  await submit(host, "baby");
  // The always-visible lens is the toggle: a time shortcut with nothing
  // live for "baby" is (correctly) not offered at all (Map P0 availability).
  assert.equal(btn(host, "Happening Now"), undefined, "nothing live matches “baby” → no Happening Now shortcut");
  await act(async () => btn(host, "Happening").click());
  await settle();
  assert.equal(countLine(host), "0", "Babylist is a Place: the Happening lens legitimately excludes it");
  const before = calls.length;
  await act(async () => btn(host, "All").click());
  await settle();
  assert.equal(calls.length, before + 1, "returning to the earlier query re-fetches instead of keeping the lens's results");
  assert.deepEqual(shown(host), ["Babylist Soho"]);
  assert.equal(countLine(host), "1");
  root.unmount();
});

test("Clear removes the text completely and returns every otherwise-eligible result, keeping bbox and the time lens", async () => {
  const { host, root, calls } = await mount();
  await act(async () => btn(host, "Today").click());
  await settle();
  await submit(host, "baby");
  assert.equal(last(calls).get("when"), "today", "the explicit time lens rides along");
  await act(async () => btn(host, "Clear search").click());
  await settle();
  const p = last(calls);
  assert.equal(p.get("q"), null, "no stale q");
  assert.equal(p.get("nl"), null);
  assert.equal(p.get("when"), "today");
  assert.equal(p.get("bbox"), BBOX.join(","));
  assert.equal(input(host).value, "");
  assert.doesNotMatch(window.location.search, /q=/);
  root.unmount();
});

test("emptying the field (keyboard clear / backspace) clears the search; Clear after a Brand search drops the derived Brand", async () => {
  const { host, root, calls } = await mount();
  await submit(host, "babylist");
  assert.match(window.location.search, /brand=babylist/);
  await submit(host, "baby");
  assert.equal(last(calls).get("brand"), null, "the previous search's Brand doesn't ride into this one");
  await type(host, "");
  await settle();
  assert.equal(last(calls).get("q"), null);
  assert.equal(shown(host).length, initialCount, "back to the full otherwise-eligible set");
  root.unmount();
});
const initialCount = (await api(`/api/discovery/map?${queryToParams({ bbox: BBOX })}`)).results.length;

test("text never moves the queried bounds; Search This Area does, and Clear keeps them", async () => {
  const { host, root, calls } = await mount();
  const area = [-74.01, 40.715, -73.99, 40.73];
  await act(async () => globalThis.__canvas.onViewportChange([-74.0249, 40.7001, -73.9551, 40.7699], false));
  const n = calls.length;
  await act(async () => globalThis.__canvas.onViewportChange(area, true));
  assert.equal(calls.length, n, "panning never queries");
  await act(async () => btn(host, "Search This Area").click());
  await settle();
  assert.equal(last(calls).get("bbox"), area.join(","));
  await submit(host, "baby");
  assert.equal(last(calls).get("bbox"), area.join(","), "the search runs inside the searched area");
  assert.deepEqual(shown(host), ["Babylist Soho"]);
  await act(async () => btn(host, "Clear search").click());
  await settle();
  assert.equal(last(calls).get("bbox"), area.join(","));
  assert.equal(globalThis.__canvas.fit, null, "no search ever re-fitted the map");
  root.unmount();
});

test("races: a slow older search can't overwrite a newer one; type → clear ends cleared", async () => {
  const slow = (u) => (u.includes("nl=tabli") ? 400 : 0);
  const a = await mount(slow);
  await type(a.host, "tabli");
  await act(async () => a.host.querySelector('form[role="search"]').dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  await submit(a.host, "baby");
  await act(async () => wait(600));
  assert.deepEqual(shown(a.host), ["Babylist Soho"], "B stays rendered after A's late response");
  assert.equal(input(a.host).value, "baby");
  a.root.unmount();

  const b = await mount(slow);
  await type(b.host, "tabli");
  await act(async () => b.host.querySelector('form[role="search"]').dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => btn(b.host, "Clear search").click());
  await act(async () => wait(700));
  assert.equal(shown(b.host).length, initialCount, "the cleared set, not the late tabli results");
  assert.doesNotMatch(window.location.search, /q=/);
  b.root.unmount();
});

test("explicit structured filters stay through searches; requests stay bounded", async () => {
  const { host, root, calls } = await mount();
  await act(async () => btn(host, "Free").click());
  await settle();
  await submit(host, "tabli");
  assert.equal(last(calls).get("free"), "1");
  await submit(host, "coffee");
  assert.equal(last(calls).get("free"), "1", "Free (explicit) survives a new search");
  const n = calls.length;
  await type(host, "c");
  await type(host, "co");
  await type(host, "cof");
  await settle();
  assert.equal(calls.length, n, "typing alone never queries — one request per submitted search");
  root.unmount();
});
