// Map Everywhere — geography as a shared presentation mode. The REAL pure
// model (lib/geo-results.ts), the REAL server projections
// (lib/geo-results-server.ts → the archives' own data functions) over an
// in-memory PostgREST, the REAL /api/geo route, and the REAL
// ArchiveGeoShell / ContextMap in jsdom (canvas stubbed as in the /map
// tests; next/navigation recorded).
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
  "next/server": "export const NextResponse = { json: (body, init) => ({ json: async () => body, status: init?.status ?? 200, init }) };",
  "next/navigation": "export const useRouter = () => globalThis.__router; export const usePathname = () => globalThis.__path ?? '/events'; export const useSearchParams = () => new URLSearchParams(globalThis.__search ?? ''); export const notFound = () => { throw new Error('404'); }; export const redirect = () => { throw new Error('redirect'); };",
  "@/lib/supabase": "export const getSupabase = () => globalThis.__db;",
  "@/lib/supabase/server": "export async function getServerSupabase(){ return null; }",
  "@/lib/admin/supabase-admin": "export const getAdminSupabase = () => null;",
  "@/components/SupabaseImage": "export default function SupabaseImage(){ return null; }",
};
const FILE_STUBS = { "next/dynamic": "tests/fixtures/map/dynamic.mjs", "next/link": "tests/fixtures/map/link.mjs" };
registerHooks({
  resolve(specifier, context, next) {
    if (STUBS[specifier] !== undefined) return js(STUBS[specifier]);
    if (specifier === "react" && context.parentURL?.includes("/src/lib/")) return js("export const cache = (fn) => fn;");
    if (FILE_STUBS[specifier]) return { url: pathToFileURL(resolvePath(ROOT, FILE_STUBS[specifier])).href, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const f = withExt(resolvePath(ROOT, "src", specifier.slice(2)));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.includes("/src/")) {
      const f = withExt(resolvePath(fileURLToPath(new URL(".", context.parentURL)), specifier));
      // Relative imports of the stubbed clients (data.ts uses "./supabase").
      const stub = f && Object.keys(STUBS).find((k) => k.startsWith("@/") && f === withExt(resolvePath(ROOT, "src", k.slice(2))));
      if (stub) return js(STUBS[stub]);
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
const G = await import("../src/lib/geo-results.ts");
const EF = await import("../src/lib/event-filter.ts");

// ---------------------------------------------------------------- fixture (synthetic, production-shaped)

const H = 3600e3;
const D = 24 * H;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const IMG = "https://drcbrzwchlirfspjgtik.supabase.co/storage/v1/object/public/findmi-media/x.jpg";
const L = (n, name, lat, lng, extra = {}) => ({ id: `loc-${n}`, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), address: `${n} Example St`, city: "New York", state: "NY", latitude: lat, longitude: lng, is_demo: false, logo_url: IMG, cover_image_url: IMG, market_id: null, market_area_id: null, category_id: null, archived_at: null, trashed_at: null, ...extra });
const EATALY = L(1, "Eataly Chiosco", 40.7409, -73.989);
const STUDIO = L(2, "Spring Studios", 40.7215, -74.008);
const PIER = L(3, "Seaport Pier 17", 40.7056, -74.0018);
const UNPLACED = L(4, "Unplaced Studio", null, null);
const HIDDEN_VENUE = L(5, "Private Loft", 40.73, -73.99);
const ev = (id, name, extra = {}) => ({ id, slug: id, name, cover_image_url: IMG, is_demo: false, publication_status: "live", is_free: true, rsvp_enabled: false, tickets_enabled: false, host_business_id: null, is_featured: false, created_at: iso(NOW - 9 * D), start_at: null, end_at: null, location_visibility: "public", timezone: "America/New_York", ...extra });
const occ = (id, e, l, start, hours) => ({ id, event_id: e, location_id: l.id, start_at: iso(start), end_at: iso(start + hours * H), occurrence_date: iso(start).slice(0, 10), timezone: "America/New_York", status: "scheduled", created_at: iso(NOW - 9 * D) });
const TABLES = {
  locations: [EATALY, STUDIO, PIER, UNPLACED, HIDDEN_VENUE],
  businesses: [
    { id: "b-kith", slug: "kith", name: "Kith", logo_url: IMG, is_demo: false, publication_status: "live" },
    { id: "b-aesop", slug: "aesop", name: "Aesop", logo_url: IMG, is_demo: false, publication_status: "live" },
    { id: "b-lavazza", slug: "lavazza", name: "Lavazza", logo_url: IMG, is_demo: false, publication_status: "live" },
  ],
  business_locations: [
    { business_id: "b-kith", location_id: STUDIO.id },
    { business_id: "b-kith", location_id: PIER.id },
    { business_id: "b-aesop", location_id: STUDIO.id },
  ],
  business_location_availability: [],
  business_location_availability_products: [],
  appearances: [],
  events: [ev("tabli", "Lavazza Tabli Sampling"), ev("art-walk", "Fall Art Walk"), ev("open-house", "Studio Open House"), ev("supper", "Secret Supper", { location_visibility: "hidden" })],
  event_occurrences: [
    occ("o1", "tabli", EATALY, NOW + 2 * D, 8),
    occ("o2", "tabli", EATALY, NOW + 3 * D, 8),
    occ("o3", "tabli", EATALY, NOW + 9 * D, 8),
    occ("o4", "art-walk", STUDIO, NOW - H, 4),
    occ("o5", "open-house", UNPLACED, NOW + 5 * D, 3),
    occ("o6", "supper", HIDDEN_VENUE, NOW + 2 * D, 3),
  ],
  event_categories: [],
  event_formats: [],
  event_businesses: [],
  event_occurrence_businesses: [],
  event_products: [{ event_id: "tabli", product_id: "p-capsules" }],
  product_fulfillment_options: [],
  categories: [],
  markets: [],
  market_areas: [],
};
globalThis.__db = fakeDb(TABLES);
const S = await import("../src/lib/geo-results-server.ts");
const R = await import("../src/app/api/geo/[surface]/route.ts");
const geoApi = async (surface, qs = "") => (await R.GET({ nextUrl: { searchParams: new URLSearchParams(qs) } }, { params: Promise.resolve({ surface }) })).json();

// ---------------------------------------------------------------- the shared model (pure)

const result = (key, place, o = {}) => ({ key, kind: "brand", title: key, subtitle: null, href: "/x", image: null, logo: null, status: null, live: false, place, ...o });
const P = (id, lat = 40.72, lng = -74) => ({ id, name: `Place ${id}`, lat, lng, href: null, address: null });

test("one marker per canonical Location: same-place results fold, identity kept when one thing is there, never jittered", () => {
  const f = G.geoFeatures([result("br:kith@s", P("s")), result("br:aesop@s", P("s")), result("br:kith@p", P("p", 40.7, -74.01))]);
  assert.equal(f.length, 2);
  const studio = f.find((x) => x.locationId === "s");
  assert.equal(studio.count, 2);
  assert.equal(studio.label, "Place s", "two different Brands → the Location names the marker");
  assert.deepEqual([studio.lat, studio.lng], [40.72, -74], "the Location's own coordinate — no jitter");
  assert.equal(f.find((x) => x.locationId === "p").label, "br:kith@p", "one Brand there → its identity");
  const live = G.geoFeatures([result("ev:a", P("x"), { live: true, status: "LIVE" })])[0];
  assert.equal(live.live, true);
  assert.equal(live.tone, "live");
});

test("only real coordinates are mappable; URL bounds and view modes parse defensively", () => {
  assert.equal(G.geoPlace({ id: "a", name: "A", latitude: null, longitude: null }), null);
  assert.equal(G.geoPlace({ id: "a", name: "A", latitude: 0, longitude: 0 }), null, "0,0 is not a place");
  assert.equal(G.geoPlace({ id: "a", name: "A", slug: "a", latitude: 40.7, longitude: -74 }).href, "/location/a");
  assert.deepEqual(G.parseBboxParam("-74.01,40.7,-73.99,40.73"), [-74.01, 40.7, -73.99, 40.73]);
  for (const bad of ["", "1,2,3", "-73.9,40.7,-74,40.8", "a,b,c,d", "-200,0,10,10"]) assert.equal(G.parseBboxParam(bad), null, bad);
  assert.equal(G.parseViewMode("split"), "split");
  assert.equal(G.parseViewMode("grid"), "list");
});

test("the Event filter contract carries view + Search This Area bounds through every archive link", () => {
  const f = EF.parseEventFilter({ when: "week", bbox: "-74.01,40.7,-73.99,40.73", view: "map", category: "food-drink" });
  assert.equal(f.view, "map");
  assert.equal(f.bbox, "-74.01,40.7,-73.99,40.73");
  const p = EF.eventFilterToSearchParams({ ...f, when: "today" });
  assert.equal(p.get("view"), "map", "a time tab keeps the Map");
  assert.equal(p.get("bbox"), f.bbox, "and the searched area");
  assert.deepEqual(EF.eventDiscoveryParams(f).bbox, [-74.01, 40.7, -73.99, 40.73]);
  assert.equal(EF.parseEventFilter({ view: "list" }).view, undefined, "List is never written");
  assert.equal(EF.parseEventFilter({ bbox: "nonsense" }).bbox, undefined);
});

// ---------------------------------------------------------------- server: same result set, geographic subset

test("Events: Event → its date → Location; a multi-date Event is one marker; hidden venues and unplaced Locations stay in the List only", async () => {
  const d = await geoApi("events");
  const keys = d.results.map((r) => r.key).sort();
  assert.deepEqual(keys, ["ev:art-walk", "ev:tabli"]);
  assert.equal(d.total, 4, "the whole result set (incl. the unplaced and the hidden-venue Event) is counted");
  const tabli = d.results.find((r) => r.key === "ev:tabli");
  assert.equal(tabli.place.id, EATALY.id);
  assert.match(tabli.href, /\/event\/tabli\?occurrence=o1/, "the date the lens chose");
  const art = d.results.find((r) => r.key === "ev:art-walk");
  assert.equal(art.live, true);
  assert.equal(art.status, "LIVE");
  assert.ok(!JSON.stringify(d).includes("Private Loft"), "a withheld venue never reaches a map");
});

test("Events: the Map reads the List's own filters; Search This Area narrows both", async () => {
  const now = await geoApi("events", "when=live");
  assert.deepEqual(now.results.map((r) => r.key), ["ev:art-walk"], "Happening Now applies to the Map too");
  const area = await geoApi("events", "bbox=-74.012,40.715,-74.0,40.73");
  assert.deepEqual(area.results.map((r) => r.key), ["ev:art-walk"]);
  assert.equal(area.total, 1, "inside the area the List has exactly that one");
  const { getEventsDiscovery } = await import("../src/lib/data.ts");
  const list = await getEventsDiscovery({ ...EF.eventDiscoveryParams(EF.parseEventFilter({ bbox: "-74.012,40.715,-74.0,40.73" })), limit: 25 });
  assert.deepEqual(list.map((e) => e.id), ["art-walk"], "the List page reads the same bounds");
});

test("Brands: presence from real relationships only — multi-location Brand, shared Location, no headquarters point", async () => {
  const presence = await S.brandPresence(["b-kith", "b-aesop", "b-lavazza"]);
  const kith = presence.filter((p) => p.businessId === "b-kith").map((p) => p.place.id).sort();
  assert.deepEqual(kith, [STUDIO.id, PIER.id].sort());
  assert.equal(presence.filter((p) => p.businessId === "b-lavazza").length, 0, "no operated / available / Pop-Up place → no point");
  const brands = TABLES.businesses;
  const features = G.geoFeatures(S.brandResults(brands, presence));
  const studio = features.find((f) => f.locationId === STUDIO.id);
  assert.equal(studio.count, 2, "Kith + Aesop at Spring Studios: one marker");
  assert.equal(features.length, 2);
  const inArea = await S.brandsInBbox(brands, [-74.012, 40.715, -74.0, 40.73]);
  assert.deepEqual(inArea.map((b) => b.id), ["b-kith", "b-aesop"]);
});

test("Products: only this Product's own relationships map (an Event featuring it), never every Location of its Brand", async () => {
  const places = await S.productPlaces("p-capsules");
  assert.deepEqual([...new Set(places.map((p) => p.place.id))], [EATALY.id]);
  assert.equal(places[0].kind, "event");
  assert.deepEqual(await S.productPlaces("p-other"), []);
});

test("Opportunities: a listing maps only through a real linked Location; Market-wide / remote listings get no pin", async () => {
  assert.equal(await S.opportunityPlace(null, "Nationwide Sampling"), null);
  assert.equal(await S.opportunityPlace("no-such-place", "x"), null);
  const p = await S.opportunityPlace("seaport-pier-17", "Vendor Spot");
  assert.equal(p.place.id, PIER.id);
  assert.equal(p.title, "Vendor Spot");
});

test("People stay List-only: no geo surface exists and the people model carries no coordinates", () => {
  assert.doesNotMatch(read("src/app/api/geo/[surface]/route.ts"), /people|person/i);
  assert.doesNotMatch(read("src/app/(public)/people/page.tsx"), /ArchiveGeoShell|ContextMap/);
});

// ---------------------------------------------------------------- client: the shell and the context map

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://findmi.test/events", pretendToBeVisual: true });
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
after(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete globalThis[k];
  dom.window.close();
});
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { default: ArchiveGeoShell } = await import("../src/components/map/ArchiveGeoShell.tsx");
const { default: ContextMap } = await import("../src/components/map/ContextMap.tsx");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => act(async () => wait(50));

async function mountShell(search, props = {}) {
  globalThis.__search = search;
  globalThis.__path = "/events";
  const pushes = [];
  globalThis.__router = { push: (href) => pushes.push(href) };
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const u = new URL(String(url), "https://findmi.test");
    return { ok: true, json: async () => geoApi(u.pathname.split("/").pop(), u.searchParams.toString()) };
  };
  delete globalThis.__canvas;
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const root = createRoot(host);
  const sp = new URLSearchParams(search);
  const list = React.createElement("div", { "data-geo-grid": "" }, ["ev:tabli", "ev:art-walk", "ev:open-house"].map((k) => React.createElement("a", { key: k, href: "#", "data-geo-key": k }, k)));
  await act(async () => root.render(React.createElement(ArchiveGeoShell, { surface: "events", initialView: G.parseViewMode(sp.get("view")), bbox: G.parseBboxParam(sp.get("bbox")), noun: ["Event", "Events"], title: "Events", controls: null, ...props }, list)));
  await settle();
  return { host, root, pushes, calls };
}
const btn = (host, label) => [...host.querySelectorAll("button, a")].find((b) => b.textContent.trim() === label || b.getAttribute("aria-label") === label);

test("List is the light default: no map, no geo request; choosing Map pushes ?view=map (Back returns) and draws the same set", async () => {
  const a = await mountShell("q=walk&when=week");
  assert.equal(globalThis.__canvas, undefined, "MapLibre is never mounted for the List");
  assert.equal(a.calls.length, 0);
  assert.equal(btn(a.host, "List").getAttribute("aria-pressed"), "true");
  await act(async () => btn(a.host, "Map").click());
  assert.equal(a.pushes.at(-1), "/events?q=walk&when=week&view=map", "a pushed navigation that keeps every filter");
  await settle();
  assert.equal(a.calls.length, 1);
  assert.match(a.calls[0], /^\/api\/geo\/events\?q=walk&when=week$/, "presentation is never part of the query");
  a.root.unmount();

  const b = await mountShell("view=map");
  await settle();
  assert.ok(globalThis.__canvas, "the map renders in Map mode");
  assert.deepEqual(globalThis.__canvas.features.map((f) => f.locationId).sort(), [EATALY.id, STUDIO.id].sort());
  assert.match(b.host.textContent, /2 Events on the map/);
  assert.match(b.host.textContent, /2 without locations/, "partial geography is stated, not hidden");
  b.root.unmount();
});

test("marker → its results; Split: list hover ↔ marker; Search This Area only after a real move, writing bounds into the URL", async () => {
  const a = await mountShell("view=split");
  await settle();
  const studio = `loc:${STUDIO.id}`;
  await act(async () => globalThis.__canvas.onSelect(studio));
  await settle();
  assert.ok(a.host.querySelector('[data-geo-key="ev:art-walk"]').hasAttribute("data-geo-selected"), "marker → List item highlighted");
  assert.match(a.host.textContent, /Fall Art Walk/, "and its card is offered (mobile Split = Map)");
  await act(async () => a.host.querySelector('[data-geo-key="ev:tabli"]').dispatchEvent(new dom.window.MouseEvent("pointerover", { bubbles: true })));
  assert.equal(globalThis.__canvas.selectedId, `loc:${EATALY.id}`, "List item → its marker");
  const n = a.calls.length;
  // The very first drag counts (the map's first view is the results' extent).
  await act(async () => globalThis.__canvas.onViewportChange([-74.1, 40.6, -74.06, 40.65], true));
  assert.ok(btn(a.host, "Search This Area"), "first real move offers Search This Area");
  await act(async () => globalThis.__canvas.onViewportChange([-74.02, 40.7, -73.98, 40.75], false));
  await act(async () => globalThis.__canvas.onViewportChange([-74.0199, 40.7001, -73.9799, 40.7501], true));
  assert.equal(btn(a.host, "Search This Area"), undefined, "a nudge does nothing");
  await act(async () => globalThis.__canvas.onViewportChange([-74.06, 40.69, -74.02, 40.74], true));
  assert.equal(a.calls.length, n, "panning never queries");
  await act(async () => btn(a.host, "Search This Area").click());
  assert.equal(a.pushes.at(-1), "/events?view=split&bbox=-74.06%2C40.69%2C-74.02%2C40.74");
  a.root.unmount();
});

test("a searched area shows a removable Map Area chip; zero mappable results give a clear way back to the List", async () => {
  const a = await mountShell("view=map&bbox=-74.06,40.69,-74.05,40.7");
  await settle();
  const chip = btn(a.host, "Remove Map Area");
  assert.equal(chip.getAttribute("href"), "/events?view=map");
  assert.equal(globalThis.__canvas, undefined, "no blank map for nothing");
  assert.ok(btn(a.host, "Show List"));
  a.root.unmount();
});

test("context map: text first, MapLibre only when the section nears the viewport; several places are selectable and listed", async () => {
  let fire = null;
  globalThis.IntersectionObserver = class {
    constructor(cb) {
      fire = () => cb([{ isIntersecting: true }]);
    }
    observe() {}
    disconnect() {}
  };
  delete globalThis.__canvas;
  const results = (await S.brandPresence(["b-kith"])).map((p) => ({ key: `br:b-kith@${p.place.id}`, kind: "brand", title: p.place.name, subtitle: p.relation, href: p.place.href ?? "/business/kith", image: null, logo: null, status: p.relation, live: false, place: p.place }));
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(ContextMap, { results, label: "Map of Kith", tall: true })));
  assert.equal(globalThis.__canvas, undefined, "not started below the fold");
  assert.match(host.textContent, /Spring Studios[\s\S]*Seaport Pier 17/, "places are plain text from the start");
  assert.match(host.querySelector("a").getAttribute("href"), /^\/map\?bbox=/, "View On Map opens the full Map there");
  await act(async () => fire());
  await settle();
  assert.equal(globalThis.__canvas.cooperativeGestures, true, "one finger keeps scrolling the page");
  await act(async () => globalThis.__canvas.onSelect(`loc:${PIER.id}`));
  assert.ok(host.querySelector(`[data-geo-card="br:b-kith@${PIER.id}"]`));
  root.unmount();
  delete globalThis.IntersectionObserver;

  const single = G.placeResult({ ...EATALY }, { linkable: true });
  const host2 = document.createElement("div");
  document.body.appendChild(host2);
  const root2 = createRoot(host2);
  await act(async () => root2.render(React.createElement(ContextMap, { results: [single], label: "Map of Eataly" })));
  assert.equal(host2.querySelector("a").getAttribute("href"), "/map?place=eataly-chiosco", "one Location → that Place on the full Map");
  root2.unmount();
  assert.equal(G.placeResult({ ...UNPLACED }), null, "no coordinates → no map section at all");
});

test("detail pages and archives use the one shared renderer and one switch — no per-entity map systems", () => {
  for (const f of ["src/components/map/ArchiveGeoShell.tsx", "src/components/map/ContextMap.tsx"]) assert.match(read(f), /import\("\.\/DiscoveryMapCanvas"\)/, f);
  for (const f of ["src/app/(public)/events/page.tsx", "src/app/(public)/locations/page.tsx", "src/app/(public)/businesses/page.tsx", "src/app/(public)/find/page.tsx"]) assert.match(read(f), /<ArchiveGeoShell\s+surface=/, f);
  for (const f of ["src/components/event/EventLocationFeature.tsx", "src/app/(public)/location/[slug]/LocationPublicView.tsx", "src/app/(public)/business/[slug]/BusinessPublicView.tsx", "src/app/(public)/product/[slug]/page.tsx"]) assert.match(read(f), /<ContextMap /, f);
  assert.doesNotMatch(read("src/components/map/MapExplorer.tsx"), /ArchiveGeoShell|ContextMap/, "/map is untouched");
});
