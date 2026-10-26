// Archive Discovery UX — List is a content browsing surface, Map is a
// geographic browsing surface. The REAL ArchiveGeoShell (phone Map screen,
// /map's Peek / Browse / Expanded sheet model, List ↔ Map continuity), the
// REAL RefineSheet, the REAL marker promotion, and the archive pages'
// compact control structure — over the same in-memory PostgREST + real
// /api/geo route as tests/map-everywhere.test.mjs.
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

// ---------------------------------------------------------------- jsdom

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
dom.window.HTMLElement.prototype.scrollIntoView = function () {
  globalThis.__scrolledTo = this.getAttribute("data-geo-key");
};
after(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete globalThis[k];
  dom.window.close();
});
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { default: ArchiveGeoShell } = await import("../src/components/map/ArchiveGeoShell.tsx");
const { default: RefineSheet, RefineSection } = await import("../src/components/discover/RefineSheet.tsx");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => act(async () => wait(60));
const btn = (host, label) => [...host.querySelectorAll("button, a")].find((b) => b.textContent.trim() === label || b.getAttribute("aria-label") === label);

async function mountShell(search) {
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
  const list = React.createElement("div", { "data-geo-grid": "" }, ["ev:family-bash", "ev:art-walk", "ev:design-talk", "ev:tabli", "ev:open-house"].map((k) => React.createElement("a", { key: k, href: "#", "data-geo-key": k }, k)));
  const render = (view) =>
    act(async () =>
      root.render(
        React.createElement(
          ArchiveGeoShell,
          { surface: "events", initialView: view, bbox: null, noun: ["Event", "Events"], title: "Events", controls: React.createElement("form", { "data-controls": "" }, "search + refine"), lenses: React.createElement("nav", { "aria-label": "When" }, "lenses") },
          list
        )
      )
    );
  await render(G.parseViewMode(new URLSearchParams(search).get("view")));
  await settle();
  return { host, root, pushes, calls, render };
}
const sheet = (host) => host.querySelector('section[aria-label="Events on the map"]');
const sheetHead = (host) => sheet(host).querySelector('[role="button"]');

test("List: heading carries the Map action; no map, no geo request, page scroll untouched", async () => {
  const a = await mountShell("");
  assert.equal(a.host.querySelector("h1").textContent, "Events");
  const action = btn(a.host, "Show Events on a Map");
  assert.ok(action, "contextual Map action beside the title");
  assert.equal(action.textContent.trim(), "Map", "text, not a mystery icon");
  assert.equal(globalThis.__canvas, undefined);
  assert.equal(a.calls.length, 0);
  assert.notEqual(document.body.style.overflow, "hidden");
  await act(async () => action.click());
  assert.equal(a.pushes.at(-1), "/events?view=map", "pushed — Back returns to the List");
  a.root.unmount();
});

test("phone Map is a screen: fixed below the header, page scroll locked (footer unreachable), controls compact above the map", async () => {
  const a = await mountShell("view=map");
  const shell = a.host.querySelector("[data-geo-shell]");
  for (const c of ["max-lg:fixed", "max-lg:top-[calc(3.5rem+var(--admin-bar-h))]", "max-lg:bottom-0", "max-lg:flex-col"]) assert.ok(shell.className.split(" ").includes(c), `fills the dynamic viewport under the Findmi header (${c})`);
  assert.equal(document.body.style.overflow, "hidden", "the archive page under it doesn't scroll");
  assert.ok(shell.querySelector("[data-controls]") && shell.querySelector('nav[aria-label="When"]'), "search / Refine / lenses stay reachable");
  assert.ok(btn(a.host, "Show Events as a List"), "the heading action flips to List");
  a.root.unmount();
  assert.notEqual(document.body.style.overflow, "hidden", "released when leaving the Map");
});

test("sheet Peek: mapped count + partial geography in the sheet, persistent List; a multi-result Location opens its results to browse", async () => {
  const a = await mountShell("view=map");
  await settle();
  const head = sheetHead(a.host);
  assert.match(head.textContent, /4 Events on the map/);
  assert.match(head.textContent, /2 without locations/, "unmappable results are acknowledged, not hidden");
  assert.ok([...sheet(a.host).querySelectorAll("button")].some((b) => b.textContent.trim() === "List"), "persistent List inside the geographic mode");
  const studio = `loc:${STUDIO.id}`;
  assert.equal(globalThis.__canvas.features.find((f) => f.id === studio).count, 3, "one marker for the three Events at Spring Studios");
  assert.ok(globalThis.__canvas.features.some((f) => f.promoted), "the map tells its story before any click");
  await act(async () => globalThis.__canvas.onSelect(studio));
  await settle();
  assert.match(sheetHead(a.host).textContent, /Spring Studios · 3 Events/);
  const cards = [...sheet(a.host).querySelectorAll("[data-geo-card]")].map((c) => c.getAttribute("data-geo-card"));
  assert.deepEqual(cards.sort(), ["ev:art-walk", "ev:design-talk", "ev:family-bash"].sort(), "every result at that place, side by side");
  assert.equal(head.getAttribute("aria-expanded"), "false");
  // Back to every result (Peek strip); tapping one keeps the map in sync.
  // (Peek → Browse → Expanded heights are /map's own sheet model, covered
  // by tests/map-ux-completion.test.mjs — jsdom has no layout.)
  await act(async () => btn(a.host, "Show all results").click());
  assert.match(sheetHead(a.host).textContent, /4 Events on the map/);
  const tabli = [...sheet(a.host).querySelectorAll("[data-geo-card]")].find((c) => c.getAttribute("data-geo-card") === "ev:tabli");
  await act(async () => tabli.querySelector("button").click());
  assert.equal(globalThis.__canvas.selectedId, `loc:${EATALY.id}`, "result → its marker");
  assert.ok(globalThis.__canvas.focus, "and the map pans to it");
  a.root.unmount();
});

test("Map → List keeps context: the place selected on the Map is brought into view in the List", async () => {
  const a = await mountShell("view=map");
  await settle();
  await act(async () => globalThis.__canvas.onSelect(`loc:${EATALY.id}`));
  const listBtn = [...sheet(a.host).querySelectorAll("button")].find((b) => b.textContent.trim() === "List");
  globalThis.__scrolledTo = null;
  await act(async () => listBtn.click());
  assert.equal(a.pushes.at(-1), "/events", "List is the default (never written)");
  await a.render("list");
  await settle();
  assert.equal(globalThis.__scrolledTo, "ev:tabli");
  assert.ok(a.host.querySelector('[data-geo-key="ev:tabli"]').hasAttribute("data-geo-selected"));
  // …and the geo results are kept: going back to the Map needs no new request.
  const n = a.calls.length;
  await a.render("map");
  await settle();
  assert.equal(a.calls.length, n, "same result set, no refetch");
  a.root.unmount();
});

test("Refine: fields stay in the archive form while closed; opening traps focus; Escape / Back close it without touching the archive URL", async () => {
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const root = createRoot(host);
  const before = window.location.href;
  let backs = 0;
  const realBack = window.history.back.bind(window.history);
  window.history.back = () => {
    backs++;
    realBack();
  };
  await act(async () =>
    root.render(
      React.createElement(
        "form",
        { method: "get" },
        React.createElement("input", { name: "q", defaultValue: "art" }),
        React.createElement(
          RefineSheet,
          { noun: "Events", activeCount: 2, resetHref: "/events?q=art" },
          React.createElement(RefineSection, { title: "Category" }, React.createElement("select", { name: "category", defaultValue: "" }, React.createElement("option", { value: "" }, "All")))
        )
      )
    )
  );
  const form = host.querySelector("form");
  assert.ok(new dom.window.FormData(form).has("category"), "closed sheet fields still submit with the search");
  const trigger = btn(host, "Refine, 2 active");
  assert.ok(trigger, "active count is announced");
  await act(async () => trigger.click());
  const dialog = host.querySelector('[role="dialog"]');
  assert.notEqual(dialog.className, "hidden");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.ok(dialog.contains(document.activeElement), "focus moves into the sheet");
  assert.match(dialog.textContent, /Refine Events[\s\S]*Category[\s\S]*Reset[\s\S]*Show Events/);
  assert.equal(btn(host, "Reset").getAttribute("href"), "/events?q=art");
  await act(async () => dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => wait(30));
  assert.equal(backs, 1, "closing pops the sheet's own history entry (so the phone's Back closes it too)");
  assert.equal(host.querySelector('[role="dialog"]').className, "hidden");
  assert.equal(window.location.href, before, "the archive URL never changed");
  assert.equal(document.activeElement, trigger, "focus returns to Refine");
  window.history.back = realBack;
  root.unmount();
});

// ---------------------------------------------------------------- marker hierarchy (pure)

test("a few results are promoted to rich labels — LIVE first, then the archive's own order; one marker per Location, no jitter", () => {
  const P = (id, lat, lng) => ({ id, name: `Place ${id}`, lat, lng, href: null, address: null });
  const r = (key, place, o = {}) => ({ key, kind: "event", title: key, subtitle: null, href: "/x", image: null, logo: null, status: "Sat", live: false, place, ...o });
  const results = [r("ev:a", P("a", 40.71, -74)), r("ev:b", P("b", 40.72, -74)), r("ev:c", P("c", 40.73, -74), { live: true }), r("ev:d", P("a", 40.71, -74))];
  const f = G.geoFeatures(results, { promote: 2 });
  assert.equal(f.length, 3, "two results at Place a → one marker");
  assert.deepEqual(f.filter((x) => x.promoted).map((x) => x.locationId).sort(), ["a", "c"], "LIVE c, then the list's first place a");
  assert.ok(f.find((x) => x.locationId === "c").rank < f.find((x) => x.locationId === "a").rank);
  assert.equal(G.geoFeatures(results).filter((x) => x.promoted).length, 0, "nothing is promoted unless a surface asks (detail maps, /map)");
  const canvas = read("src/components/map/DiscoveryMapCanvas.tsx");
  assert.match(canvas, /id: "fm-promo"[\s\S]*?minzoom: 11[\s\S]*?\["==", \["get", "promoted"\], 1\][\s\S]*?"symbol-sort-key": \["get", "rank"\]/, "promoted labels: identity + status from city zoom, collision-limited by rank");
  assert.match(canvas, /setFilter\("fm-label", \[[^\n]*\["!=", \["get", "promoted"\], 1\]/, "never the same label twice");
  assert.doesNotMatch(read("src/components/map/MapExplorer.tsx"), /promote/, "/map never promotes");
});

// ---------------------------------------------------------------- compact archive controls (structure)

test("every archive: heading + view action, ONE search + Refine row, lenses only where they earn it, chips — no stacked control rows", () => {
  const pages = { events: "src/app/(public)/events/page.tsx", locations: "src/app/(public)/locations/page.tsx", businesses: "src/app/(public)/businesses/page.tsx", find: "src/app/(public)/find/page.tsx" };
  for (const [name, f] of Object.entries(pages)) {
    const src = read(f);
    assert.match(src, /<ArchiveGeoShell\s[\s\S]*?title=[\s\S]*?controls=\{\s*<form method="get" className="flex items-center gap-2">[\s\S]*?<ArchiveSearchField[\s\S]*?<RefineSheet /, `${name}: search + Refine share one row`);
    assert.doesNotMatch(src, /<FilterSheet|<h1 /, `${name}: no separate Filters stack / standalone heading`);
    assert.match(src, /placeholder="Search (Events|Places|Businesses|Brands & Events)"/, `${name}: Title Case search label`);
  }
  assert.match(read(pages.events), /lenses=\{/, "Events keeps its time lenses");
  assert.match(read(pages.find), /lenses=\{/, "Pop-Ups keep their time lenses");
  assert.doesNotMatch(read(pages.locations), /lenses=\{/, "Locations has no permanent lens row");
  const find = read(pages.find);
  assert.doesNotMatch(find, />\s*Filter Results\s*</, "/find: no second submit button");
  assert.doesNotMatch(find, /type="submit"[\s\S]{0,200}>\s*Search\s*</, "/find: no separate SEARCH button");
  for (const f of ["src/components/discover/EventFilters.tsx", "src/components/discover/BusinessFilters.tsx"]) assert.match(read(f), /showSubmit && \(/, `${f}: Refine supplies Apply`);
  assert.match(read("src/components/discover/ArchiveSearchField.tsx"), /className="h-10 w-full rounded-full/, "compact search (normal control height)");
  assert.match(read("src/components/discover/ArchiveSearchField.tsx"), /name=\{name\}/, "still the same named URL field");
});

