// Map Discovery P0 — lenses (All · Happening · Places), contextual
// refinements, availability-driven options, one definition of applied
// refinements (badge / chips / Clear), legacy single-kind links, and
// selected-Location reachability ("Show All N Here", list pick leads the
// preview). Pure lib/discovery/map-filters plus the REAL MapExplorer /
// MapFilterSheet in jsdom (canvas stubbed; fetch recorded).
// sizing is proven on the pure model and verified visually in Playwright.
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
      return { format: "module", source: transform(read(fileURLToPath(url)), { transforms: ["typescript", "jsx"], jsxRuntime: "automatic", production: true }).code, shortCircuit: true };
    }
    return next(url, context);
  },
});

const F = await import("../src/lib/discovery/map-filters.ts");
const Q = await import("../src/lib/discovery/query.ts");

// ---------------------------------------------------------------- MapExplorer in jsdom

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
const { default: MapFilterSheet } = await import("../src/components/map/MapFilterSheet.tsx");


// ---------------------------------------------------------------- lenses (pure)

const BBOX = [-74.02, 40.7, -73.96, 40.77];
const HAPPENING = ["event", "appearance"];

test("lens of a query: All by default; an implicit Happening refinement reads as Happening; Places; legacy single kinds are Happening", () => {
  assert.equal(F.mapLens({}), "all");
  assert.equal(F.mapLens({ text: "coffee", brands: ["lavazza"] }), "all", "search and Brands are coherent across every type");
  assert.equal(F.mapLens({ when: "today" }), "happening");
  assert.equal(F.mapLens({ entities: ["place"] }), "place");
  assert.equal(F.mapLens({ open: "now" }), "place");
  assert.equal(F.mapLens({ entities: ["event"] }), "happening");
  assert.equal(F.mapLens({ entities: ["appearance"] }), "happening");
  assert.deepEqual(F.MAP_LENSES.map((l) => l.label), ["All", "Happening", "Places"], "no Brands placeholder until the Brands lens exists");
});

test("normalize: the visible lens is what runs — implicit Happening becomes explicit (same results); Places never carries time; All never narrows invisibly", () => {
  assert.deepEqual(F.normalizeMapLens({ bbox: BBOX, when: "today" }), { query: { bbox: BBOX, when: "today", entities: HAPPENING }, sameResults: true });
  assert.deepEqual(F.normalizeMapLens({ bbox: BBOX }), { query: { bbox: BBOX }, sameResults: true });
  assert.deepEqual(F.normalizeMapLens({ entities: ["place"], when: "today", free: true }).query, { entities: ["place"] });
  assert.deepEqual(F.normalizeMapLens({ entities: HAPPENING, open: "now" }).query, { entities: HAPPENING }, "Open Now would pull Places into Happening");
  assert.deepEqual(F.normalizeMapLens({ entities: ["event", "place"] }).query, {}, "a mixed list (never produced by the UI) is All");
  const legacy = F.normalizeMapLens({ entities: ["event"], when: "today" });
  assert.deepEqual(legacy, { query: { entities: ["event"], when: "today" }, sameResults: true }, "legacy Events-only links are kept as they are");
});

test("legacy Event-only / Pop-Up-only URLs still round-trip and show as a removable narrowing of Happening", () => {
  for (const [url, label, noun] of [["type=event", "Events Only", "Event"], ["type=appearance", "Pop-Ups Only", "Pop-Up"]]) {
    const q = Q.paramsToQuery(new URLSearchParams(url));
    const n = F.normalizeMapLens(q).query;
    assert.equal(Q.queryToParams(n).toString(), url, `${url} keeps its URL`);
    assert.equal(F.mapLens(n), "happening");
    assert.equal(F.happeningNarrowing(n).label, label);
    assert.equal(F.lensNoun(n), noun);
    const chip = F.mapRefinements(n).find((c) => c.key === "lens");
    assert.equal(chip.label, label);
    assert.equal(Q.queryToParams(chip.without).toString(), "type=event&type=appearance", "removing it widens to Happening");
  }
  assert.equal(F.happeningNarrowing({ entities: HAPPENING }), null);
});

test("switching lens drops refinements that don't apply to it, keeps geography, search and Brands", () => {
  const q = { bbox: BBOX, text: "coffee", brands: ["lavazza"], entities: HAPPENING, when: "today", free: true, categories: ["food-drink"], topics: ["pop-ups"] };
  assert.deepEqual(F.withLens(q, "place"), { bbox: BBOX, text: "coffee", brands: ["lavazza"], topics: ["pop-ups"], entities: ["place"] });
  assert.deepEqual(F.withLens({ ...q, entities: ["place"], open: "now" }, "all"), { bbox: BBOX, text: "coffee", brands: ["lavazza"], topics: ["pop-ups"] });
  assert.deepEqual(F.withLens({ entities: ["place"], open: "now" }, "happening"), { entities: HAPPENING });
});

test("ONE definition of applied refinements: geography and the typed search aren't refinements; quick ones are", () => {
  const keys = (q) => F.mapRefinements(q).map((c) => c.key);
  assert.deepEqual(keys({ bbox: BBOX, near: true, area: "soho", text: "baby" }), []);
  assert.deepEqual(keys({ entities: HAPPENING, when: "today", free: true, categories: ["arts"], tto: "18:00" }).sort(), ["cat:arts", "free", "time", "when"].sort());
  assert.deepEqual(keys({ entities: ["event"], paid: true }), ["lens", "paid"]);
  assert.ok(F.isUneditableRefinement("topic:pop-ups") && F.isUneditableRefinement("family") && F.isUneditableRefinement("lens"));
  assert.ok(!F.isUneditableRefinement("when") && !F.isUneditableRefinement("cat:arts"));
});

test("Clear removes refinements and keeps the lens, geography, search and the search's Brands", () => {
  assert.deepEqual(F.clearedRefinements({ bbox: BBOX, entities: ["place"], open: "now" }), { bbox: BBOX, entities: ["place"] }, "Places + Open Now → Places");
  assert.deepEqual(F.clearedRefinements({ bbox: BBOX, entities: HAPPENING, when: "today", categories: ["arts"] }), { bbox: BBOX, entities: HAPPENING }, "Happening + Today + category → Happening");
  assert.deepEqual(F.clearedRefinements({ bbox: BBOX, topics: ["pop-ups"], text: "baby", brands: ["babylist"] }), { bbox: BBOX, text: "baby", brands: ["babylist"] }, "All + refinements → All");
  assert.deepEqual(F.clearedRefinements({ entities: ["event"], when: "today" }), { entities: HAPPENING }, "a legacy narrowing is a refinement; the lens is Happening");
});

// ---------------------------------------------------------------- availability (pure)

const NOW = new Date("2026-10-28T16:00:00.000Z"); // Wed 12:00 New York
const location = (id, o = {}) => ({ id, name: id, slug: id, discoverable: true, lat: 40.72, lng: -74, city: "New York", state: "NY", area: null, logo: null, cover: null, hours: null, timezone: "America/New_York", ...o });
const item = (key, o = {}) => ({
  key, kind: "event", id: key, eventId: key, title: key, href: `/event/${key}`, image: null, brands: [], location: location(`L-${key}`), status: "scheduled",
  start_at: "2026-10-29T20:00:00.000Z", end_at: "2026-10-29T23:00:00.000Z", occurrence_date: "2026-10-29", timezone: "America/New_York",
  categories: [], formats: [], is_free: null, family_friendly: null, benefits: [], audience: [], entry: [], rsvp: false, tickets: false, featured: false, created_at: null, haystack: ` ${key} `, ...o,
});
const OPEN_HOURS = { wed: { closed: false, open: "09:00", close: "18:00" } };
const ITEMS = [
  item("food", { categories: ["food-drink"], formats: ["pop-up"], is_free: true, benefits: ["free_food"], audience: ["kids"], rsvp: true }),
  item("art", { categories: ["arts-culture"], is_free: false, entry: ["walk_in"] }),
  item("shop", { kind: "place", eventId: null, start_at: null, end_at: null, occurrence_date: null, location: location("shop", { hours: OPEN_HOURS }) }),
];

test("availability: only values the candidates can satisfy; each dimension ignores its own selection, honors the others", () => {
  const f = F.mapFacets(ITEMS, { entities: HAPPENING }, { now: NOW });
  assert.deepEqual(f.categories.sort(), ["arts-culture", "food-drink"]);
  assert.deepEqual(f.formats, ["pop-up"]);
  assert.deepEqual(f.benefits, ["free_food"]);
  assert.deepEqual(f.audience.sort(), ["family", "kids"], "Kids also satisfies Family, exactly as matching treats it (isFamily)");
  assert.deepEqual(f.entry.sort(), ["rsvp", "walk_in"], "RSVP from the Event's own RSVP flag, exactly as matching treats it");
  assert.equal(f.free, true);
  assert.equal(f.paid, true);
  const arts = F.mapFacets(ITEMS, { entities: HAPPENING, categories: ["arts-culture"] }, { now: NOW });
  assert.deepEqual(arts.categories.sort(), ["arts-culture", "food-drink"], "choosing one category never hides the others");
  assert.equal(arts.free, false, "…but cost reflects the chosen category");
  assert.equal(arts.paid, true);
  const free = F.mapFacets(ITEMS, { entities: HAPPENING, free: true }, { now: NOW });
  assert.equal(free.paid, true, "choosing Free never hides Paid");
});

test("availability: no data → nothing offered (Free, perks, audience, entry hide themselves); Open Now only from real hours", () => {
  const bare = [item("a"), item("b")];
  const f = F.mapFacets(bare, { entities: HAPPENING }, { now: NOW });
  assert.deepEqual([f.categories, f.formats, f.benefits, f.audience, f.entry], [[], [], [], [], []]);
  assert.equal(f.free, false);
  assert.equal(f.paid, false);
  assert.equal(F.mapFacets(ITEMS, { entities: ["place"] }, { now: NOW }).open, true);
  assert.equal(F.mapFacets([item("p", { kind: "place", location: location("p") })], { entities: ["place"] }, { now: NOW }).open, false, "unknown hours never count as open");
});

test("server: availability rides on both full and count-only responses; relaxation counts skip it", () => {
  const src = read("src/lib/discovery/map-server.ts");
  assert.match(src, /if \(opts\.facets !== false\) \{/);
  assert.match(src, /facets = mapFacets\(candidates, executed, \{ now, placeIds \}, untimed\);/);
  assert.match(src, /relaxations: \[\], truncated, mapReady, facets,/, "count-only (the filter sheet's draft count) carries it");
  assert.match(src, /countOnly: true, facets: false/);
});

// ---------------------------------------------------------------- MapExplorer

const card = (key, featureId, o = {}) => ({ key, kind: "event", title: `Title ${key}`, href: `/event/${key}`, image: null, logo: null, brand: null, brandCount: 0, place: { id: featureId.slice(4), name: "Hamilton Park", href: null, city: "Jersey City" }, when: "Thu, Oct 29", status: { badge: null, text: "Starts 4 PM", tone: "later", live: false }, distanceKm: null, perks: [], free: false, entry: [], reason: null, moreDates: 0, featureId, lng: -74, lat: 40.72, save: null, ...o });
const feature = (id, keys) => ({ id, lng: -74, lat: 40.72, count: keys.length, label: "Hamilton Park", place: "Hamilton Park", status: "Starts 4 PM", live: false, tone: "later", logo: null, locationId: id.slice(4), keys });
const SIX = ["app:1", "app:2", "app:3", "app:4", "app:5", "app:6"];
const NO_FACETS = { categories: [], formats: [], benefits: [], audience: [], entry: [], free: false, paid: false, open: false };
const data = (o = {}) => ({
  query: {}, total: 7, features: [feature("loc:A", SIX), feature("loc:B", ["occ:9"])], results: [...SIX.map((k) => card(k, "loc:A")), card("occ:9", "loc:B")],
  nextOffset: null, overflow: [], chips: [], relaxations: [], truncated: false, mapReady: true, generatedAt: NOW.toISOString(), ...o,
});
const settle = () => act(async () => new Promise((r) => setTimeout(r, 250)));

async function mount(initialQuery = { bbox: BBOX }, initialData = data(), responder = () => initialData) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => responder(String(url)) };
  };
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(MapExplorer, { initialQuery, initialView: "map", initialData, defaultBbox: BBOX, options: { categories: [], formats: [] } })));
  await settle();
  return { host, root, calls };
}
const buttons = (el) => [...el.querySelectorAll("button")];
const btn = (el, text) => buttons(el).find((b) => b.textContent.trim() === text || b.getAttribute("aria-label") === text);
const rail = (host) => host.querySelector('[role="radiogroup"][aria-label="Explore"]');
const lensOn = (host) => [...rail(host).querySelectorAll('[role="radio"]')].find((b) => b.getAttribute("aria-checked") === "true")?.textContent;
const params = (calls) => new URL(calls.at(-1), "https://findmi.test").searchParams;
const resultsSheet = (host) => host.querySelector('section[aria-label="Results"]');

test("the lens leads the existing chip rail: All · Happening · Places, then quick filters for that lens", async () => {
  const { host, root } = await mount();
  const row = rail(host).parentElement;
  assert.equal(row.firstElementChild, rail(host), "the lens is first in the rail — no extra row over the map");
  assert.deepEqual([...rail(host).querySelectorAll('[role="radio"]')].map((b) => b.textContent), ["All", "Happening", "Places"]);
  assert.equal(lensOn(host), "All");
  for (const label of ["Happening Now", "Starting Soon", "Today", "This Weekend", "Free", "Near Me"]) assert.ok(btn(row, label), label);
  assert.equal(btn(row, "Open Now"), undefined, "Open Now is a Places refinement");
  root.unmount();
});

test("All + a time shortcut visibly switches to Happening; turning it off returns to All", async () => {
  const { host, root, calls } = await mount();
  const scrolled = [];
  const was = dom.window.HTMLElement.prototype.scrollTo;
  dom.window.HTMLElement.prototype.scrollTo = function (o) {
    if (this.hasAttribute("data-map-rail")) scrolled.push(o?.left);
  };
  await act(async () => btn(host, "Today").click());
  await settle();
  dom.window.HTMLElement.prototype.scrollTo = was;
  assert.equal(lensOn(host), "Happening", "never All on screen while the results are Happening-only");
  assert.ok(scrolled.includes(0), "the rail returns to its start so the new lens is in view on a phone");
  assert.deepEqual(params(calls).getAll("type"), HAPPENING);
  assert.equal(params(calls).get("when"), "today");
  await act(async () => btn(host, "Today").click());
  await settle();
  assert.equal(lensOn(host), "All");
  assert.deepEqual(params(calls).getAll("type"), []);
  assert.equal(params(calls).get("when"), null);
  root.unmount();
});

test("Happening chosen explicitly stays Happening when its time filter is turned off; Free switches All → Happening too", async () => {
  const { host, root, calls } = await mount();
  await act(async () => btn(rail(host), "Happening").click());
  await settle();
  await act(async () => btn(host, "Today").click());
  await settle();
  await act(async () => btn(host, "Today").click());
  await settle();
  assert.equal(lensOn(host), "Happening");
  assert.deepEqual(params(calls).getAll("type"), HAPPENING);
  await act(async () => btn(rail(host), "All").click());
  await settle();
  await act(async () => btn(host, "Free").click());
  await settle();
  assert.equal(lensOn(host), "Happening");
  assert.equal(params(calls).get("free"), "1");
  root.unmount();
});

test("Places: no time filters and no Free — Open Now instead; leaving All never sneaks time in", async () => {
  const { host, root, calls } = await mount({ bbox: BBOX, entities: HAPPENING, when: "today" });
  await act(async () => btn(rail(host), "Places").click());
  await settle();
  assert.equal(lensOn(host), "Places");
  assert.deepEqual(params(calls).getAll("type"), ["place"]);
  assert.equal(params(calls).get("when"), null, "time is dropped, not left to do nothing");
  for (const label of ["Happening Now", "Starting Soon", "Today", "This Weekend", "Free"]) assert.equal(btn(rail(host).parentElement, label), undefined, label);
  assert.ok(btn(host, "Open Now"));
  assert.ok(btn(host, "Near Me"));
  await act(async () => btn(host, "Open Now").click());
  await settle();
  assert.equal(params(calls).get("open"), "now");
  root.unmount();
});

test("unavailable quick filters hide; an applied one stays visible and removable even at zero", async () => {
  const none = await mount({ bbox: BBOX }, data({ facets: NO_FACETS }));
  assert.equal(btn(none.host, "Free"), undefined, "nothing free here → no Free");
  none.root.unmount();
  const on = await mount({ bbox: BBOX, entities: HAPPENING, free: true }, data({ total: 0, results: [], features: [], facets: NO_FACETS }));
  const free = btn(on.host, "Free");
  assert.ok(free, "applied Free stays");
  assert.equal(free.getAttribute("aria-pressed"), "true");
  await act(async () => free.click());
  await settle();
  assert.equal(params(on.calls).get("free"), null);
  on.root.unmount();
  const places = await mount({ bbox: BBOX, entities: ["place"] }, data({ facets: NO_FACETS }));
  assert.equal(btn(places.host, "Open Now"), undefined, "no Location with real hours open now → no Open Now");
  places.root.unmount();
});

test("badge, chip rail and refinements agree: quick ones counted, geography/search not; legacy narrowing is a removable chip", async () => {
  const q = { bbox: BBOX, entities: HAPPENING, when: "today", free: true, categories: ["arts-culture"], text: "walk" };
  const chips = [{ key: "when", label: "Today", href: "/map?when=today" }, { key: "free", label: "Free", href: "/map" }, { key: "cat:arts-culture", label: "Arts & Culture", href: "/map?when=today&free=1" }, { key: "text", label: "Walk", href: "/map" }];
  const { host, root } = await mount(q, data({ chips }));
  assert.ok(btn(host, "Filters, 3 on"), "Today + Free + Arts & Culture");
  const row = rail(host).parentElement;
  assert.ok(btn(row, "Remove Arts & Culture"), "a refinement no quick filter shows is a chip");
  assert.equal(btn(row, "Remove Walk"), undefined, "the typed search is already in the field");
  assert.equal(btn(row, "Remove Today"), undefined, "Today is already the active quick filter");
  root.unmount();
  const legacy = await mount({ bbox: BBOX, entities: ["event"] });
  assert.equal(lensOn(legacy.host), "Happening");
  assert.ok(resultsSheet(legacy.host).textContent.includes("7 Events"));
  assert.ok(btn(legacy.host, "Filters, 1 on"));
  await act(async () => btn(legacy.host, "Remove Events Only").click());
  await settle();
  assert.deepEqual(params(legacy.calls).getAll("type"), HAPPENING);
  legacy.root.unmount();
});

const previewKeys = (host) => {
  const s = resultsSheet(host);
  const marker = [...s.querySelectorAll("p")].find((p) => p.textContent.startsWith("Hamilton Park"))?.parentElement?.parentElement;
  return marker ? [...marker.querySelectorAll("[data-result-key]")].map((e) => e.getAttribute("data-result-key")) : [];
};
const listKeys = (host) => [...resultsSheet(host).querySelectorAll("ul[role=list] [data-result-key]")].map((e) => e.getAttribute("data-result-key"));

test("Case 1: every result at the selected Location is reachable — Show All N Here; none vanish from both preview and list", async () => {
  const { host, root } = await mount({ bbox: BBOX }, data(), (u) => (u.includes("/preview") ? {} : data()));
  await act(async () => globalThis.__canvas.onSelect("loc:A"));
  await settle();
  assert.deepEqual(previewKeys(host), SIX.slice(0, 4), "primary + 3 at first (compact Peek)");
  assert.deepEqual(listKeys(host), ["occ:9"], "the marker's results live in the preview, not twice");
  await act(async () => btn(resultsSheet(host), "Show All 6 Here").click());
  assert.deepEqual(previewKeys(host), SIX, "results 5+ are reachable");
  assert.equal(btn(resultsSheet(host), "Show All 6 Here"), undefined);
  await act(async () => globalThis.__canvas.onSelect("loc:B"));
  await settle();
  await act(async () => globalThis.__canvas.onSelect("loc:A"));
  await settle();
  assert.ok(btn(resultsSheet(host), "Show All 6 Here"), "a new selection starts compact again");
  root.unmount();
});

test("Case 1: a result picked from the list leads its marker's preview instead of disappearing", async () => {
  const { host, root } = await mount({ bbox: BBOX }, data(), (u) => (u.includes("/preview") ? {} : data()));
  const pick = resultsSheet(host).querySelector('ul[role=list] [data-result-key="app:6"] button[aria-pressed]');
  await act(async () => pick.click());
  await settle();
  assert.equal(globalThis.__canvas.selectedId, "loc:A");
  assert.equal(previewKeys(host)[0], "app:6", "the picked result leads");
  assert.ok(!listKeys(host).includes("app:6"));
  root.unmount();
});

// ---------------------------------------------------------------- MapFilterSheet

async function sheet(initial, { facets, options = { categories: [], formats: [] }, labels } = {}) {
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const root = createRoot(host);
  const applied = [];
  await act(async () => root.render(React.createElement(MapFilterSheet, { initial, options, facets, labels, onApply: (q) => applied.push(q), onClose: () => {}, count: async () => ({ total: 5, facets }) })));
  await act(async () => new Promise((r) => setTimeout(r, 450)));
  const headings = () => [...host.querySelectorAll("h3")].map((h) => h.textContent);
  return { host, root, applied, headings, cta: () => buttons(host).at(-1) };
}

test("sheet under All: the lens selector and one hint — no entity-specific sections", async () => {
  const s = await sheet({ bbox: BBOX });
  assert.deepEqual(s.headings(), ["Show"]);
  assert.ok(s.host.textContent.includes("Choose what you want to explore to see more filters."));
  assert.deepEqual(["All", "Happening", "Places"].map((l) => btn(s.host, l)?.getAttribute("aria-pressed")), ["true", "false", "false"]);
  await act(async () => btn(s.host, "Happening").click());
  assert.ok(s.headings().includes("When"));
  assert.ok(!s.host.textContent.includes("Choose what you want to explore"));
  s.root.unmount();
});

test("sheet under Happening: only available options; empty sections disappear; chosen values always stay", async () => {
  const options = { categories: [{ slug: "arts-culture", name: "Arts & Culture", children: [] }, { slug: "food-drink", name: "Food & Drink", children: [] }, { slug: "community-causes", name: "Community & Causes", children: [] }], formats: [{ slug: "pop-up", name: "Pop-Up" }] };
  const facets = { ...NO_FACETS, categories: ["arts-culture"] };
  const s = await sheet({ bbox: BBOX, entities: HAPPENING }, { facets, options });
  assert.deepEqual(s.headings(), ["Show", "When", "What"], "no Cost & Perks / Who & How without data");
  assert.ok(btn(s.host, "Arts & Culture"));
  assert.equal(btn(s.host, "Food & Drink"), undefined);
  assert.equal(btn(s.host, "Community & Causes"), undefined, "empty duplicate categories hide themselves (no data change)");
  assert.equal(btn(s.host, "More Types"), undefined);
  s.root.unmount();
  const chosen = await sheet({ bbox: BBOX, entities: HAPPENING, free: true, categories: ["food-drink"], audience: ["kids"] }, { facets, options });
  assert.deepEqual(chosen.headings(), ["Show", "When", "What", "Cost & Perks", "Who & How"]);
  assert.equal(btn(chosen.host, "Free").getAttribute("aria-pressed"), "true", "applied Free stays removable");
  assert.equal(btn(chosen.host, "Paid"), undefined);
  assert.ok(btn(chosen.host, "Food & Drink"));
  assert.ok(btn(chosen.host, "Kids"));
  chosen.root.unmount();
});

test("sheet: no facets → every option (other callers unchanged); Places shows Open Now only when available or on", async () => {
  const s = await sheet({ entities: HAPPENING });
  assert.deepEqual(s.headings(), ["Show", "When", "Cost & Perks", "Who & How"]);
  s.root.unmount();
  const p = await sheet({ entities: ["place"] }, { facets: NO_FACETS });
  assert.equal(btn(p.host, "Open Now"), undefined);
  assert.deepEqual(p.headings(), ["Show"]);
  p.root.unmount();
  const on = await sheet({ entities: ["place"], open: "now" }, { facets: NO_FACETS });
  assert.ok(btn(on.host, "Open Now"));
  on.root.unmount();
});

test("sheet Clear keeps the lens (Places + Open Now → Places; Happening + Today + category → Happening)", async () => {
  const p = await sheet({ bbox: BBOX, entities: ["place"], open: "now" });
  await act(async () => btn(p.host, "Clear").click());
  await act(async () => new Promise((r) => setTimeout(r, 450)));
  await act(async () => p.cta().click());
  assert.deepEqual(p.applied.at(-1), { bbox: BBOX, entities: ["place"] });
  p.root.unmount();
  const h = await sheet({ bbox: BBOX, entities: HAPPENING, when: "today", categories: ["arts-culture"], text: "walk" });
  await act(async () => btn(h.host, "Clear").click());
  await act(async () => new Promise((r) => setTimeout(r, 450)));
  await act(async () => h.cta().click());
  assert.deepEqual(h.applied.at(-1), { bbox: BBOX, entities: HAPPENING, text: "walk" });
  h.root.unmount();
});

test("sheet: refinements it has no control for are shown as Also Applied — never narrowing invisibly", async () => {
  const s = await sheet({ bbox: BBOX, entities: ["event"], topics: ["pop-ups"] }, { labels: { "topic:pop-ups": "Pop-Ups" } });
  assert.ok(s.headings().includes("Also Applied"));
  await act(async () => btn(s.host, "Remove Pop-Ups").click());
  await act(async () => btn(s.host, "Remove Events Only").click());
  assert.ok(!s.headings().includes("Also Applied"));
  await act(async () => new Promise((r) => setTimeout(r, 450)));
  await act(async () => s.cta().click());
  assert.deepEqual(s.applied.at(-1), { bbox: BBOX, entities: HAPPENING });
  s.root.unmount();
});

test("sheet: a parent and its own child aren't two values — no Any / All toggle for them", async () => {
  const options = { categories: [{ slug: "arts-culture", name: "Arts & Culture", children: [{ slug: "galleries", name: "Galleries" }] }, { slug: "food-drink", name: "Food & Drink", children: [] }], formats: [] };
  const s = await sheet({ entities: HAPPENING, categories: ["arts-culture", "galleries"] }, { options });
  assert.equal(btn(s.host, "All Of These"), undefined);
  await act(async () => btn(s.host, "Food & Drink").click());
  assert.ok(btn(s.host, "All Of These"), "two genuinely different categories do get it");
  s.root.unmount();
});
