// Map P0 corrections (phone QA on the b9b9ad1 Preview): Near Me allowed by
// Permissions-Policy (never on /embed) with locating / failure / near-you
// empty states; "Starting Soon" (the Map's four-hour window, distinct
// from /events' "Up Next"); availability for named time shortcuts;
// authoritative chronological order in Happening with no Brand cap; logo
// marker images MapLibre accepts plus a Place fallback mark; the selected
// label kept inside the usable map area; no repeated secondary line.
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
const M = await import("../src/lib/discovery/map-core.ts");
const MI = await import("../src/components/map/marker-images.ts");
const { nearMeError } = await import("../src/components/map/MapExplorer.tsx");

const BBOX = [-74.02, 40.7, -73.96, 40.77];
const HAPPENING = ["event", "appearance"];

// ---------------------------------------------------------------- Near Me: policy

test("Permissions-Policy: Findmi's own pages allow geolocation for themselves; /embed keeps it off", async () => {
  const config = (await import("../next.config.mjs")).default;
  const blocks = await config.headers();
  const policy = (source) => blocks.find((b) => b.source === source).headers.find((h) => h.key === "Permissions-Policy").value;
  const site = policy("/((?!embed/|embed$).*)");
  const embed = policy("/embed/:path*");
  assert.match(site, /(^|, )geolocation=\(self\)(,|$)/, "the Map's Near Me can ask");
  assert.doesNotMatch(site, /geolocation=\(\)/);
  assert.match(embed, /(^|, )geolocation=\(\)(,|$)/, "framed widgets never can");
  for (const off of ["camera=()", "microphone=()", "payment=()", "usb=()"]) {
    assert.ok(site.includes(off) && embed.includes(off), `${off} unchanged`);
  }
});

// ---------------------------------------------------------------- Near Me: states

const card = (key, featureId, o = {}) => ({ key, kind: "event", title: `Title ${key}`, href: `/event/${key}`, image: null, logo: null, brand: null, brandCount: 0, place: { id: featureId.slice(4), name: "Eataly", href: null, city: "New York" }, when: "Fri, Oct 30", status: { badge: null, text: "Starts 9 AM", tone: "later", live: false }, distanceKm: null, perks: [], free: false, entry: [], reason: null, moreDates: 0, featureId, lng: -74, lat: 40.72, save: null, ...o });
const feature = (id, keys) => ({ id, lng: -74, lat: 40.72, count: keys.length, label: "Eataly", place: "Eataly", status: "Starts 9 AM", live: false, tone: "later", logo: null, locationId: id.slice(4), keys });
const data = (o = {}) => ({ query: {}, total: 1, features: [feature("loc:A", ["occ:1"])], results: [card("occ:1", "loc:A")], nextOffset: null, overflow: [], chips: [], relaxations: [], truncated: false, mapReady: true, generatedAt: "2026-10-29T16:00:00.000Z", ...o });
const settle = () => act(async () => new Promise((r) => setTimeout(r, 250)));

async function mount(initialQuery = { bbox: BBOX }, initialData = data(), { responder = () => initialData, geolocation } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => responder(String(url)) };
  };
  if (geolocation) Object.defineProperty(dom.window.navigator, "geolocation", { value: geolocation, configurable: true });
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
const rail = (host) => host.querySelector('[role="radiogroup"][aria-label="Explore"]').parentElement;
const nearChip = (host) => buttons(rail(host)).find((b) => /Near Me|Locating/.test(b.textContent));

test("Near Me: a visible Locating… state while the browser answers; a second tap doesn't ask twice", async () => {
  const pending = [];
  const geolocation = { getCurrentPosition: (ok, no, opts) => pending.push({ ok, no, opts }) };
  const { host, root, calls } = await mount(undefined, undefined, { geolocation });
  await act(async () => nearChip(host).click());
  assert.equal(nearChip(host).textContent.trim(), "Locating…");
  assert.equal(nearChip(host).getAttribute("aria-busy"), "true");
  assert.match(host.textContent, /Finding your location/, "announced to assistive tech");
  await act(async () => nearChip(host).click());
  assert.equal(pending.length, 1, "no duplicate request while one is pending");
  assert.equal(pending[0].opts.enableHighAccuracy, false, "coarse is enough");
  await act(async () => pending[0].ok({ coords: { latitude: 40.723456, longitude: -74.003456 } }));
  await settle();
  assert.equal(nearChip(host).textContent.trim(), "Near Me");
  assert.equal(nearChip(host).getAttribute("aria-pressed"), "true");
  assert.match(calls.at(-1), /near=1/);
  assert.match(calls.at(-1), /bbox=-74\.03/, "the ~100 m-rounded position shapes a viewport…");
  assert.doesNotMatch(window.location.search, /bbox|40\.72|74\.00/, "…which never enters the URL");
  root.unmount();
});

test("Near Me failures are told apart — policy, permission, unavailable, timeout — never silent", async () => {
  assert.match(nearMeError({ code: 1, message: "Geolocation has been disabled in this document by permissions policy." }), /isn’t enabled on this page/);
  assert.match(nearMeError({ code: 1, message: "User denied Geolocation" }), /location access is off for Findmi/);
  assert.match(nearMeError({ code: 2 }), /device couldn’t find it/);
  assert.match(nearMeError({ code: 3 }), /in time\. Try Near Me again/);
  assert.match(nearMeError(undefined), /couldn’t get your location/);
  for (const e of [{ code: 1 }, { code: 2 }, { code: 3 }]) assert.match(nearMeError(e), /^We couldn’t get your location/);
  let fail;
  const geolocation = { getCurrentPosition: (_ok, no) => (fail = no) };
  const { host, root } = await mount(undefined, undefined, { geolocation });
  await act(async () => nearChip(host).click());
  await act(async () => fail({ code: 3, message: "Timeout expired" }));
  await settle();
  assert.match(host.textContent, /We couldn’t get your location in time/);
  assert.equal(nearChip(host).textContent.trim(), "Near Me", "the chip is ready to try again");
  assert.ok(host.querySelector('[data-result-key="occ:1"]'), "results stay");
  root.unmount();
});

test("Near Me found you but nothing is within the radius: a near-you empty state that keeps Wider Area", async () => {
  const empty = data({ total: 0, results: [], features: [], relaxations: [{ label: "Wider Area", count: 4, href: "/map?near=1" }] });
  const a = await mount({ bbox: BBOX, near: true }, empty);
  assert.match(a.host.textContent, /Nothing near you right now\./);
  assert.match(a.host.textContent, /within 1\.5 mi of you/);
  assert.doesNotMatch(a.host.textContent, /Nothing matches all of these filters/, "not a filter conflict");
  assert.ok(buttons(a.host).some((b) => b.textContent.includes("Wider Area")));
  a.root.unmount();
  const b = await mount({ bbox: BBOX, near: true, entities: HAPPENING, when: "today" }, empty);
  assert.match(b.host.textContent, /Nothing near you matches these filters\./);
  b.root.unmount();
  const c = await mount({ bbox: BBOX, entities: HAPPENING, when: "today" }, empty);
  assert.match(c.host.textContent, /Nothing matches all of these filters\./, "without Near Me the message is unchanged");
  c.root.unmount();
});

// ---------------------------------------------------------------- Starting Soon

test("Starting Soon is the Map's four-hour window (when=upnext); /events keeps its own chronological “Up Next”", async () => {
  assert.equal(F.MAP_WHEN_LABELS.upnext, "Starting Soon");
  const T = await import("../src/lib/discovery/time.ts");
  assert.equal(T.UP_NEXT_HOURS, 4, "the window itself is unchanged");
  const EF = await import("../src/lib/event-filter.ts");
  assert.equal(EF.EVENT_TIME_LABELS.next, "Up Next", "/events is not changed");
  assert.equal(EF.EVENT_WINDOW_BY_TIME_KEY.next, "anytime");
  const { host, root, calls } = await mount();
  assert.equal(btn(rail(host), "Up Next"), undefined, "no ambiguous “Up Next” on the Map");
  await act(async () => btn(rail(host), "Starting Soon").click());
  await settle();
  assert.match(calls.at(-1), /when=upnext/, "shared links keep working");
  root.unmount();
  const s = await sheet({ entities: HAPPENING });
  assert.ok(btn(s.host, "Starting Soon"));
  assert.equal(btn(s.host, "Up Next"), undefined);
  s.root.unmount();
});

// ---------------------------------------------------------------- time availability

const NOW = new Date("2026-10-29T16:00:00.000Z"); // Thu 12:00 PM New York
const location = (id, o = {}) => ({ id, name: id, slug: id, discoverable: true, lat: 40.72, lng: -74, city: "New York", state: "NY", area: null, logo: null, cover: null, hours: null, timezone: "America/New_York", ...o });
const item = (key, start, end, o = {}) => ({
  key, kind: "event", id: key, eventId: key, title: key, href: `/event/${key}`, image: null, brands: [], location: location(`L-${key}`), status: "scheduled",
  start_at: start, end_at: end, occurrence_date: start.slice(0, 10), timezone: "America/New_York",
  categories: [], formats: [], is_free: null, family_friendly: null, benefits: [], audience: [], entry: [], rsvp: false, tickets: false, featured: false, created_at: null, haystack: ` ${key} `, ...o,
});

test("time availability: each named shortcut is offered only when something qualifies, other constraints applied", () => {
  const live = item("live", "2026-10-29T15:00:00Z", "2026-10-29T18:00:00Z");
  const soon = item("soon", "2026-10-29T18:00:00Z", "2026-10-29T20:00:00Z");
  const fri = item("fri", "2026-10-30T13:00:00Z", "2026-10-30T22:00:00Z");
  const ctx = { now: NOW };
  const all = F.mapFacets([], { entities: HAPPENING }, ctx, [live, soon, fri]).when;
  for (const w of ["now", "upnext", "today", "tomorrow", "week"]) assert.ok(all.includes(w), w);
  assert.ok(!all.includes("next_month"));
  assert.deepEqual(F.mapFacets([], { entities: HAPPENING }, ctx, [fri]).when.filter((w) => ["now", "upnext", "today"].includes(w)), [], "nothing today → no Happening Now / Starting Soon / Today");
  assert.deepEqual(F.mapFacets([], { entities: HAPPENING, text: "zzz" }, ctx, [live, soon, fri]).when, [], "the typed search applies");
  assert.deepEqual(F.mapFacets([], { entities: HAPPENING, when: "tomorrow" }, ctx, [live, soon, fri]).when, all, "the current window is replaced, not stacked");
  assert.equal(F.mapFacets([], { entities: ["place"] }, ctx, [live]).when, undefined, "Places carry no time");
  assert.equal(F.mapFacets([], { entities: HAPPENING }, ctx).when, undefined, "unknown → everything offered");
  assert.ok(F.hasDateWindow({ when: "today" }) && F.hasDateWindow({ month: "2026-11" }) && !F.hasDateWindow({ tod: "evening" }));
  assert.deepEqual(F.withoutDateWindow({ when: "today", tod: "evening", date: "2026-10-30" }), { tod: "evening" }, "time of day stays");
});

test("server: time availability uses candidates without the date window (one extra bounded load only when one is set)", () => {
  const src = read("src/lib/discovery/map-server.ts");
  assert.match(src, /const untimed = mapLens\(executed\) === "place" \? null : hasDateWindow\(executed\) \? \(await loadMapItems\(withoutDateWindow\(executed\), now\)\)\.items : candidates;/);
});

const NO_FACETS = { categories: [], formats: [], benefits: [], audience: [], entry: [], free: false, paid: false, open: false };

test("rail: inactive time shortcuts with nothing to show are hidden; an active one stays; the lens never hides", async () => {
  const { host, root } = await mount({ bbox: BBOX }, data({ facets: { ...NO_FACETS, when: ["weekend"] } }));
  assert.ok(btn(rail(host), "This Weekend"));
  for (const label of ["Happening Now", "Starting Soon", "Today"]) assert.equal(btn(rail(host), label), undefined, label);
  for (const label of ["All", "Happening", "Places", "Near Me"]) assert.ok(btn(rail(host), label), label);
  root.unmount();
  const on = await mount({ bbox: BBOX, entities: HAPPENING, when: "today" }, data({ total: 0, results: [], features: [], facets: { ...NO_FACETS, when: [] } }));
  const today = btn(rail(on.host), "Today");
  assert.ok(today, "an applied time filter stays visible at zero");
  assert.equal(today.getAttribute("aria-pressed"), "true");
  await act(async () => today.click());
  await settle();
  assert.doesNotMatch(on.calls.at(-1), /when=/, "…and removable");
  on.root.unmount();
});

async function sheet(initial, { facets } = {}) {
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(MapFilterSheet, { initial, options: { categories: [], formats: [] }, facets, onApply: () => {}, onClose: () => {}, count: async () => ({ total: 3, facets }) })));
  await act(async () => new Promise((r) => setTimeout(r, 450)));
  return { host, root };
}

test("sheet: named time shortcuts follow availability; the active one stays; custom date controls are always there", async () => {
  const s = await sheet({ entities: HAPPENING, when: "next_month" }, { facets: { ...NO_FACETS, when: ["tomorrow"] } });
  assert.ok(btn(s.host, "Tomorrow"));
  assert.equal(btn(s.host, "Next Month").getAttribute("aria-pressed"), "true", "active stays");
  for (const label of ["Happening Now", "Starting Soon", "Today", "This Weekend", "This Week"]) assert.equal(btn(s.host, label), undefined, label);
  for (const label of ["Choose Date", "Date Range", "Browse Month", "Browse Year"]) assert.ok(btn(s.host, label), label);
  s.root.unmount();
});

// ---------------------------------------------------------------- Happening order

const brand = (id) => ({ id, slug: id, name: id, logo: null });
const at = (lat, lng) => location(`${lat},${lng}`, { lat, lng });
const rank = (items, center = [-73.99, 40.735]) => items.map((i) => M.rankMapItem(i, { now: NOW, center }));
const keys = (r) => r.items.map((x) => x.item.key);

test("Happening: live first, then by start — proximity, image and Featured only break ties (production QA case)", () => {
  // Real Fri Oct 30 data that ranked 5 PM, 10 AM, 12 PM, 9 AM, 10 AM.
  const now = new Date("2026-10-29T23:05:00Z");
  const fri = [
    item("good-organics-5pm", "2026-10-30T21:00:00Z", "2026-10-31T00:00:00Z", { location: at(40.729607, -74.001835), featured: true, image: "x" }),
    item("salt-stone-10am", "2026-10-30T14:00:00Z", "2026-10-30T23:00:00Z", { location: at(40.723717, -73.9945), featured: true, image: "x" }),
    item("alpyn-12pm", "2026-10-30T16:00:00Z", "2026-10-30T22:00:00Z", { location: at(40.723961, -73.998229), featured: true, image: "x" }),
    item("lavazza-9am", "2026-10-30T13:00:00Z", "2026-10-31T01:00:00Z", { location: at(40.740896, -73.989443), image: "x" }),
    item("olly-10am", "2026-10-30T14:00:00Z", "2026-10-30T22:00:00Z", { location: at(40.754128, -74.002813), featured: true, image: "x" }),
    item("tamagotchi-nov22", "2026-11-22T14:00:00Z", "2026-11-22T23:30:00Z", { location: at(40.759223, -73.984619) }),
  ];
  const ranked = fri.map((i) => M.rankMapItem(i, { now, center: [-73.99, 40.735] }));
  const score = M.orderMapResults(ranked, {}, now, false);
  assert.equal(keys(score)[0], "good-organics-5pm", "the All lens still ranks (unchanged)");
  const happening = M.orderMapResults(ranked, { entities: HAPPENING }, now, true);
  assert.deepEqual(keys(happening), ["lavazza-9am", "salt-stone-10am", "olly-10am", "alpyn-12pm", "good-organics-5pm", "tamagotchi-nov22"], "10 AM tie: score decides (Salt & Stone 26 > OLLY 24 for this viewport)");
});

test("Happening Now: ending soonest first. Today: live first, then upcoming by start. Weekend: Fri → Sat → Sun", () => {
  const endsLate = item("ends-6pm", "2026-10-29T14:00:00Z", "2026-10-29T22:00:00Z", { location: at(40.735, -73.99), featured: true, image: "x" });
  const endsSoon = item("ends-1pm", "2026-10-29T15:00:00Z", "2026-10-29T17:00:00Z", { location: at(40.76, -73.95) });
  const later = item("today-5pm", "2026-10-29T21:00:00Z", "2026-10-29T23:00:00Z", { location: at(40.735, -73.99), featured: true, image: "x" });
  const sooner = item("today-2pm", "2026-10-29T18:00:00Z", "2026-10-29T20:00:00Z", { location: at(40.76, -73.95) });
  assert.deepEqual(keys(M.orderMapResults(rank([endsLate, endsSoon]), { when: "now" }, NOW, true)), ["ends-1pm", "ends-6pm"]);
  assert.deepEqual(keys(M.orderMapResults(rank([later, sooner, endsLate]), { when: "today" }, NOW, true)), ["ends-6pm", "today-2pm", "today-5pm"]);
  assert.deepEqual(keys(M.orderMapResults(rank([later, sooner]), { when: "upnext" }, NOW, true)), ["today-2pm", "today-5pm"], "Starting Soon: by start");
  const sun = item("sun-10am", "2026-11-01T15:00:00Z", "2026-11-01T18:00:00Z", { location: at(40.735, -73.99), featured: true, image: "x" });
  const sat = item("sat-2pm", "2026-10-31T18:00:00Z", "2026-10-31T20:00:00Z", { location: at(40.75, -73.97) });
  const fri = item("fri-6pm", "2026-10-30T22:00:00Z", "2026-10-30T23:59:00Z", { location: at(40.76, -73.95) });
  const ranked = rank([sun, sat, fri]);
  assert.equal(keys(M.orderMapResults(ranked, { when: "weekend" }, NOW, false))[0], "sun-10am", "score alone would lead with a nearby Sunday");
  assert.deepEqual(keys(M.orderMapResults(ranked, { when: "weekend" }, NOW, true)), ["fri-6pm", "sat-2pm", "sun-10am"]);
});

test("Happening: no per-Brand cap — one Brand's dates stay in time order; All keeps Brand diversity", () => {
  const lv = brand("lavazza");
  const mk = (key, start, b, o = {}) => item(key, start, start.replace(/T\d\d/, "T23"), { brands: b ? [b] : [], eventId: key, ...o });
  const items = [
    mk("lv-1", "2026-10-30T13:00:00Z", lv), mk("lv-2", "2026-10-30T14:00:00Z", lv), mk("lv-3", "2026-10-30T15:00:00Z", lv),
    mk("other-4", "2026-10-30T16:00:00Z", brand("olly")),
  ];
  const ranked = rank(items);
  const happening = M.orderMapResults(ranked, { entities: HAPPENING }, NOW, true);
  assert.deepEqual(keys(happening), ["lv-1", "lv-2", "lv-3", "other-4"]);
  assert.deepEqual(happening.overflow, [], "no “View All Lavazza” overflow in Happening");
  const all = M.orderMapResults(ranked, {}, NOW, false);
  assert.equal(keys(all).indexOf("lv-3") > keys(all).indexOf("other-4"), true, "All: a third Lavazza result moves after another Brand");
  assert.equal(all.overflow[0].brand.slug, "lavazza");
});

test("Happening: several dates of one Event at one Location fold under the earliest (or live) one", () => {
  const loc = at(40.74, -73.99);
  const d1 = item("occ-sat", "2026-10-31T14:00:00Z", "2026-10-31T20:00:00Z", { eventId: "market", location: loc, image: "x", featured: true });
  const d2 = item("occ-fri", "2026-10-30T14:00:00Z", "2026-10-30T20:00:00Z", { eventId: "market", location: loc });
  const r = M.orderMapResults(rank([d1, d2]), { entities: HAPPENING }, NOW, true);
  assert.deepEqual(keys(r), ["occ-fri"]);
  assert.equal(r.items[0].item.moreDates, 1);
});

test("server: the Happening lens orders chronologically; every other lens keeps score + diversity", () => {
  const src = read("src/lib/discovery/map-server.ts");
  assert.match(src, /orderMapResults\(ranked, executed, now, mapLens\(executed\) === "happening"\)/);
  assert.doesNotMatch(src, /\.sort\(compareRankedMap\)/);
});

// ---------------------------------------------------------------- markers

test("logo marker images: placeholder, logo and fallback share one size (MapLibre's updateImage requires it)", () => {
  const p = MI.logoPlaceholder();
  assert.equal(p.width, MI.LOGO_IMAGE_SIZE);
  assert.equal(p.height, MI.LOGO_IMAGE_SIZE);
  assert.equal(p.data.length, MI.LOGO_IMAGE_SIZE * MI.LOGO_IMAGE_SIZE * 4);
  assert.ok(p.data.every((v) => v === 0), "transparent while loading");
  const canvas = read("src/components/map/DiscoveryMapCanvas.tsx");
  assert.match(canvas, /map\.addImage\(id, logoPlaceholder\(\), \{ pixelRatio: 2 \}\);/);
  assert.doesNotMatch(canvas, /width: 1, height: 1/, "the 1×1 placeholder MapLibre rejected is gone");
  assert.match(canvas, /const image = data \?\? placeFallbackImage\(\);/, "a logo that can't be drawn becomes the Findmi Place mark");
  assert.match(canvas, /const size = LOGO_IMAGE_SIZE;/, "logos are drawn at the registered size");
  assert.match(canvas, /"icon-size": \["interpolate", \["linear"\], \["zoom"\], 12\.5, 0\.42, 16, 0\.62\]/, "marker size unchanged (compact)");
  assert.equal(MI.placeFallbackImage(), null, "no canvas (jsdom) → no image, never a throw");
});

test("selected label: the secondary line is omitted when it would only repeat the name", () => {
  assert.equal(MI.secondaryLine({ label: "Shopify New York", status: "", place: "Shopify New York", live: false }), null);
  assert.equal(MI.secondaryLine({ label: "Shopify New York", status: null, place: "shopify new york ", live: false }), null);
  assert.equal(MI.secondaryLine({ label: "Babylist Soho", status: "Retail Store", place: "Babylist Soho", live: false }), "Retail Store");
  assert.equal(MI.secondaryLine({ label: "Lavazza", status: "", place: "Eataly Chiosco", live: false }), "Eataly Chiosco");
  assert.equal(MI.secondaryLine({ label: "Lavazza", status: "Ends 9 PM", place: "Eataly", live: true }), "● LIVE · Ends 9 PM");
  assert.match(read("src/components/map/DiscoveryMapCanvas.tsx"), /const second = secondaryLine\(f\);\n\s+if \(second\) \{/);
});

test("selected label: pan just enough to keep it inside the usable map (edges, top controls, sheet, map controls)", () => {
  const safe = { left: 28, top: 140, right: 384, bottom: 560 };
  const box = (left, top, width = 230, height = 44) => ({ left, top, right: left + width, bottom: top + height });
  assert.deepEqual(MI.labelShift(box(100, 300), safe), [0, 0], "fits → no pan");
  assert.deepEqual(MI.labelShift(box(188, 300), safe), [34, 0], "past the right edge → content moves left");
  assert.deepEqual(MI.labelShift(box(10, 300), safe), [-18, 0], "past the left edge");
  assert.deepEqual(MI.labelShift(box(100, 540), safe), [0, 24], "under the results sheet → up");
  assert.deepEqual(MI.labelShift(box(100, 120), safe), [0, -20], "under the top controls → down");
  assert.deepEqual(MI.labelShift(box(0, 300, 500), safe), [-28, 0], "wider than the area: its start stays readable");
  const zoom = { left: 350, top: 380, right: 384, bottom: 450 };
  assert.deepEqual(MI.labelShift(box(140, 400), safe, [zoom]), [28, 0], "clear of the zoom buttons");
  assert.deepEqual(MI.labelShift(box(140, 200), safe, [zoom]), [0, 0], "controls elsewhere don't matter");
});

test("selected label: focusing a selection centers its whole label, then checks it once the camera settles", () => {
  const canvas = read("src/components/map/DiscoveryMapCanvas.tsx");
  assert.match(canvas, /offset: \[width \? -\(width \/ 2 - SELECTED_ANCHOR_OFFSET\) : 0, 0\]/);
  assert.match(canvas, /if \(map\.isMoving\(\)\) \{/, "never interrupts a camera move");
  assert.match(canvas, /requestAnimationFrame\(keepSelectedVisible\);/, "marker taps without a pan are checked too (archive maps)");
  assert.match(canvas, /\.maplibregl-ctrl-group, \.maplibregl-ctrl-attrib-button/);
  assert.doesNotMatch(canvas, /N Here/, "no identical-coordinate tray in this pass");
});
