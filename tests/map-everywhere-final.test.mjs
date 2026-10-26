// Map Everywhere final corrections — Map-first view precedence, Brands
// Map → List staying the same result set, the shared Location map /
// address block, compliant compact attribution, Brand-detail and
// Event-detail Maps of their OWN datasets. Same harness and fixture as
// tests/archive-discovery-ux.test.mjs.
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

// Three Events at Spring Studios (one place, several results).
TABLES.events.push(ev("design-talk", "Design Talk"), ev("family-bash", "Halloween Family Bash", { is_featured: true, featured_sort_order: 1 }));
TABLES.event_occurrences.push(occ("o7", "design-talk", STUDIO, NOW + D, 2), occ("o8", "family-bash", STUDIO, NOW + 3 * H, 6));
globalThis.__db = fakeDb(TABLES);
const R = await import("../src/app/api/geo/[surface]/route.ts");
const geoApi = async (surface, qs = "") => (await R.GET({ nextUrl: { searchParams: new URLSearchParams(qs) } }, { params: Promise.resolve({ surface }) })).json();


const AP = await import("../src/lib/archive-params.ts");
const S = await import("../src/lib/geo-results-server.ts");

// ---------------------------------------------------------------- jsdom (before any test registers)

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://findmi.test/business/kith", pretendToBeVisual: true });
const saved = {};
for (const k of ["window", "document", "navigator", "HTMLElement", "Node", "CSS"]) saved[k] = globalThis[k];
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.CSS = { escape: (s) => s };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
after(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete globalThis[k];
  dom.window.close();
});
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { default: AppearanceFindMiHere } = await import("../src/components/AppearanceFindMiHere.tsx");

test("Map-first precedence: the URL's explicit view wins (List included); a fresh visit opens geographic (Split = the phone Map screen; Map where no Split)", () => {
  assert.equal(G.resolveView(null), "split");
  assert.equal(G.resolveView(null, false), "map", "/find has no Split");
  for (const v of ["list", "map", "split"]) assert.equal(G.resolveView(v), v);
  assert.equal(G.resolveView("split", false), "map");
  assert.equal(AP.archiveViewParam({}), null);
  assert.equal(AP.archiveViewParam({ view: "list" }), "list");
  assert.equal(AP.archiveView({}), "split");
  assert.equal(AP.archiveView({ view: "list" }), "list");
  const links = EF.eventFilterToSearchParams(EF.parseEventFilter({ view: "list", when: "today" }));
  assert.equal(links.get("view"), "list", "a chosen List rides every archive link / form");
  assert.match(read("src/components/map/ArchiveGeoShell.tsx"), /router\.push\(hrefWith\(\(p\) => p\.set\("view", v\)\)/, "every switch writes an explicit view (pushed → Back / Forward)");
  for (const f of ["src/app/(public)/locations/page.tsx", "src/app/(public)/businesses/page.tsx", "src/app/(public)/find/page.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, /view !== "list"/, `${f}: no presentation default leaks into links`);
    assert.match(src, /viewParam && <input type="hidden" name="view" value=\{viewParam\} \/>/, `${f}: search / Refine keep the view`);
  }
});

test("regression: Brands Map → List stays the SAME flat result set — curation never depends on the presentation", async () => {
  const [list, map, fresh] = await Promise.all([AP.brandArchive({ view: "list" }), AP.brandArchive({ view: "map" }), AP.brandArchive({})]);
  assert.equal(list.isBrowseMode, map.isBrowseMode, "switching view can't change what the page is");
  assert.equal(list.isBrowseMode, fresh.isBrowseMode);
  assert.deepEqual(list.search, map.search, "identical result-set parameters");
  const page = read("src/app/(public)/businesses/page.tsx");
  assert.doesNotMatch(page, /\{isBrowseMode \? \(/, "no List branch that swaps the result set for rails");
  assert.doesNotMatch(page, /if \(!isBrowseMode\) \{/, "the result set is always fetched");
  assert.match(page, /\{isBrowseMode && <h2[^>]*>All Brands<\/h2>\}/, "an unrefined visit shows curation ABOVE the result set");
  assert.doesNotMatch(page, /categoryRails/, "per-category rails no longer stand in for the result set");
  assert.equal((await AP.brandArchive({ q: "kith", view: "list" })).isBrowseMode, false);
});

test("attribution: MapLibre's own compact control, folded by its own ⓘ toggle after the guideline's few seconds — never hidden, /map unchanged", () => {
  const canvas = read("src/components/map/DiscoveryMapCanvas.tsx");
  assert.match(canvas, /attributionControl: \{ compact: true \}/, "the official compact attribution control");
  assert.match(canvas, /ATTRIBUTION_OPEN_MS = 5000/);
  assert.match(canvas, /\.maplibregl-ctrl-attrib\.maplibregl-compact\.maplibregl-compact-show \.maplibregl-ctrl-attrib-button"\);\s*\n\s*if \(open\) open\.click\(\);/, "presses the control's own toggle (as a tap does)");
  assert.match(read("src/components/map/ContextMap.tsx"), /cooperativeGestures autoCollapseAttribution/);
  assert.match(read("src/components/map/ArchiveGeoShell.tsx"), /autoCollapseAttribution\n/);
  assert.doesNotMatch(read("src/components/map/MapExplorer.tsx"), /autoCollapseAttribution/, "/map keeps its approved behavior");
  assert.doesNotMatch(read("src/app/globals.css"), /maplibregl-ctrl-attrib[^{]*\{[^}]*(display:\s*none|visibility:\s*hidden|opacity:\s*0)/, "no CSS hiding");
});

test("Brand detail Map = the SAME upcoming schedule: each date at its own Location; hidden venues / no Location are not drawn", async () => {
  const items = [
    { id: "a1", title: "Kith Pop-Up", start_at: iso(NOW + D), end_at: iso(NOW + D + 2 * H), location_id: PIER.id },
    { id: "a2", title: "Kith x Studio", start_at: iso(NOW - H), end_at: iso(NOW + H), location_id: STUDIO.id, event_id: "art-walk", event_occurrence_id: "o4", event: { slug: "art-walk" } },
    { id: "a3", title: "Online Drop", start_at: iso(NOW + 2 * D), end_at: null, location_id: null },
    { id: "a4", title: "Secret", start_at: iso(NOW + 3 * D), end_at: null, location_id: HIDDEN_VENUE.id, location_hidden: true },
  ];
  const geo = await S.scheduleResults(items, { slug: "kith", name: "Kith" });
  assert.deepEqual(geo.map((g) => g.key), ["app:a1", "app:a2"]);
  assert.equal(geo[1].live, true);
  assert.match(geo[1].href, /\/event\/art-walk\?occurrence=o4/);
  assert.equal(geo[0].title, "Seaport Pier 17", "markers name the place");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const appearances = items.map((a) => ({ ...a, description: null, venue_name: null, address: null, city: null, state: null, external_url: null, event_id: a.event_id ?? null, flyer_image_url: null }));
  const business = { id: "b-kith", name: "Kith", slug: "kith", logo_url: null, cover_image_url: null, shareUrl: "https://findmi.test/business/kith" };
  await act(async () => root.render(React.createElement(AppearanceFindMiHere, { appearances, business, galleryImages: [], geo })));
  const labels = [...host.querySelectorAll('[role="group"][aria-label="View"] button')].map((b) => b.textContent);
  assert.deepEqual(labels, ["Cards", "List", "Map"]);
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Map").click());
  assert.ok(host.querySelector("[data-context-map]"), "the shared contextual map");
  assert.match(host.textContent, /2 of 4 dates on the map · 2 without locations/, "no fake presence; the rest is acknowledged");
  await act(async () => root.render(React.createElement(AppearanceFindMiHere, { appearances, business, galleryImages: [] })));
  assert.deepEqual([...host.querySelectorAll('[role="group"][aria-label="View"] button')].map((b) => b.textContent), ["Cards", "List"], "no geo → no Map option");
  root.unmount();
});

test("Event detail Map only where geography is real complexity: dates at 2+ distinct Locations; each marker is a date at its own Location", () => {
  const loc = (l) => ({ ...l });
  const occ = (id, l, status = "scheduled") => ({ id, status, start_at: iso(NOW + D), end_at: iso(NOW + D + H), location: l ? loc(l) : null });
  const tour = S.occurrenceResults([occ("o1", EATALY), occ("o2", STUDIO), occ("o3", null), occ("o4", PIER, "cancelled")], { slug: "tour", name: "Tour" });
  assert.deepEqual(tour.map((r) => r.key), ["occ:o1", "occ:o2"], "no inherited venue, no cancelled date");
  assert.match(tour[0].href, /\/event\/tour\?occurrence=o1/);
  assert.equal(G.datesMapEligible(tour), true);
  const oneVenue = S.occurrenceResults([occ("o1", EATALY), occ("o2", EATALY)], { slug: "x", name: "X" });
  assert.equal(G.datesMapEligible(oneVenue), false, "one place → the Location block's map already answers where");
  const view = read("src/app/(public)/event/[slug]/EventPublicView.tsx");
  assert.match(view, /const datesGeoAll = locationHidden \? \[\] : occurrenceResults\(datedOccurrences/, "a hidden venue is never mapped");
  assert.match(view, /const datesGeo = datesMapEligible\(datesGeoAll\) \? datesGeoAll : undefined;/);
  assert.match(read("src/components/UpcomingDatesRail.tsx"), /const modes = geo && geo\.length > 0 \? \(\["cards", "list", "map"\] as const\)/);
});
