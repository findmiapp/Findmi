// Map V1 consumer UX completion. The REAL pure sheet model
// (components/map/sheet.ts) and the REAL MapExplorer / MapFilterSheet in
// jsdom (canvas stubbed as in discovery-engine-map.test.mjs; fetch and
// geolocation are recorded fakes). Heights in jsdom are 0, so content
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

const S = await import("../src/components/map/sheet.ts");

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


// ---------------------------------------------------------------- the sheet model (Android-like 412 x 915 viewport)

// Map column ≈ 915 - 56 (header) = 859; top controls ≈ 128.
const base = { column: 859, head: 64, topReserve: 136 };

test("Peek is the handle + count + first result — never a reserved block of empty space", () => {
  const h = S.sheetHeights({ ...base, peekBody: 112, contentBody: 2400 });
  assert.equal(h.peek, 64 + 112, "exactly header + first card");
  const none = S.sheetHeights({ ...base, peekBody: 0, contentBody: 0 });
  assert.equal(none.peek, 64, "no results → only the header row");
  assert.deepEqual([none.browse, none.expanded], [64, 64], "and nothing to expand into");
});

test("Selected grows to the preview's natural height, capped so the map stays visible", () => {
  assert.equal(S.sheetHeights({ ...base, peekBody: 300, contentBody: 2400 }).peek, 364);
  assert.equal(S.sheetHeights({ ...base, peekBody: 900, contentBody: 2400 }).peek, Math.round(859 * S.PEEK_CAP), "a long preview scrolls inside the cap");
});

test("Browse and Expanded are content-driven: little content → the sheet stops at the content", () => {
  const few = S.sheetHeights({ ...base, peekBody: 112, contentBody: 260 });
  assert.equal(few.browse, 64 + 260, "two short results don't open a half-screen of white");
  assert.equal(few.expanded, few.browse);
  const many = S.sheetHeights({ ...base, peekBody: 112, contentBody: 4000 });
  assert.equal(many.browse, Math.round(859 * S.BROWSE_CAP));
  assert.equal(many.expanded, 859 - 136, "search + quick controls stay visible above Expanded — the route back to the map");
});

test("viewport height changes (browser chrome) re-derive every snap height", () => {
  const tall = S.sheetHeights({ ...base, peekBody: 112, contentBody: 4000 });
  const short = S.sheetHeights({ ...base, column: 700, peekBody: 112, contentBody: 4000 });
  assert.ok(short.browse < tall.browse && short.expanded < tall.expanded);
  assert.equal(short.peek, tall.peek, "Peek is content, not a percentage");
});

test("drag: a flick moves one state; a slow drag settles on the nearest; equal states collapse", () => {
  const h = { peek: 176, browse: 481, expanded: 723 };
  assert.equal(S.snapAfterDrag("peek", h, 260, -120), "browse");
  assert.equal(S.snapAfterDrag("browse", h, 600, -60), "expanded");
  assert.equal(S.snapAfterDrag("expanded", h, 560, 140), "browse");
  assert.equal(S.snapAfterDrag("browse", h, 200, 300), "peek");
  assert.equal(S.snapAfterDrag("browse", h, 470, -20), "browse", "a small wobble stays put");
  const flat = { peek: 176, browse: 324, expanded: 324 };
  assert.equal(S.snapAfterDrag("browse", flat, 330, -200), "browse", "no phantom Expanded when content is short");
  assert.equal(S.nextOnTap("peek", h), "browse");
  assert.equal(S.nextOnTap("browse", h), "expanded");
  assert.equal(S.nextOnTap("expanded", h), "peek");
  assert.equal(S.nextOnTap("browse", flat), "peek");
});

test("Search This Area: never for a nudge; yes for a real pan or zoom", () => {
  const q = [-74.02, 40.7, -73.96, 40.77];
  assert.equal(S.movedMeaningfully(q, [-74.019, 40.701, -73.959, 40.771]), false, "tiny movement");
  assert.equal(S.movedMeaningfully(q, [-74.04, 40.7, -73.98, 40.77]), true, "pan of ~30%");
  assert.equal(S.movedMeaningfully(q, [-74.005, 40.717, -73.975, 40.752]), true, "zoomed in 2×");
  assert.equal(S.movedMeaningfully(null, q), false, "nothing queried yet");
});

test("drag lives on the sheet header only; the list scrolls — they never fight", () => {
  const src = read("src/components/map/MapExplorer.tsx");
  assert.match(src, /ref=\{headRef\}[\s\S]{0,200}onPointerDown=\{onSheetDown\}[\s\S]{0,120}onPointerMove=\{onSheetMove\}/);
  assert.match(src, /touch-none select-none/);
  assert.doesNotMatch(src.slice(src.indexOf("ref={listRef}"), src.indexOf("ref={listRef}") + 400), /onPointer/);
  assert.match(src, /sheet === "peek" && !selectedFeature \? "overflow-hidden" : "overflow-y-auto"/, "Peek doesn't scroll a one-card window");
  assert.doesNotMatch(src, /h-\[52%\]|h-\[15\.5rem\]|h-\[6\.75rem\]/, "no fixed arbitrary sheet heights remain");
});

const card = (key, featureId, o = {}) => ({ key, kind: "event", title: `Title ${key}`, href: `/event/${key}`, image: null, logo: null, brand: { name: "Lavazza", slug: "lavazza" }, brandCount: 1, place: { id: "L", name: "Eataly Chiosco", href: "/location/eataly", city: "New York" }, when: "Sat, Oct 25 · 9:00 AM – 9:00 PM", status: { badge: null, text: "Starts 3 PM", tone: "today", live: false }, distanceKm: null, perks: [], free: false, entry: [], reason: null, moreDates: 0, featureId, lng: -74, lat: 40.72, save: null, ...o });
const feature = (id, keys) => ({ id, lng: -74, lat: 40.72, count: keys.length, label: "Lavazza", place: "Eataly Chiosco", status: "Ends 9 PM", live: true, tone: "live", logo: null, locationId: id.slice(4), keys });
const LIVE = { badge: "LIVE", text: "Ends 9 PM", tone: "live", live: true };
const DATA = {
  query: {}, total: 3, features: [feature("loc:A", ["occ:1", "occ:3"]), feature("loc:B", ["occ:2"])],
  results: [card("occ:1", "loc:A", { status: LIVE }), card("occ:2", "loc:B"), card("occ:3", "loc:A")],
  nextOffset: null, overflow: [], chips: [], relaxations: [], truncated: false, mapReady: true, generatedAt: "2026-10-25T18:00:00.000Z",
};
const settle = () => act(async () => new Promise((r) => setTimeout(r, 250)));

async function mount(props = {}, responder = () => DATA) {
  const calls = [];
  const geo = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const body = responder(String(url));
    return { ok: true, json: async () => body };
  };
  Object.defineProperty(dom.window.navigator, "geolocation", { value: { getCurrentPosition: (_ok, no) => { geo.push(1); no?.({ code: 1 }); } }, configurable: true });
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const root = createRoot(host);
  const bbox = [-74.02, 40.7, -73.96, 40.77];
  await act(async () => root.render(React.createElement(MapExplorer, { initialQuery: { bbox }, initialView: "map", initialData: DATA, defaultBbox: bbox, options: { categories: [], formats: [] }, ...props })));
  await settle();
  return { host, root, calls, geo };
}
const sheet = (host) => host.querySelector('section[aria-label="Results"]');
const btn = (host, text) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text || b.getAttribute("aria-label") === text);

test("Peek shows the first result; List / Map switch the sheet without changing the result set", async () => {
  const { host, root, calls } = await mount();
  const s = sheet(host);
  assert.ok(s.textContent.includes("3 Results"));
  assert.ok(s.querySelector('[data-result-key="occ:1"]'), "first useful result is in the sheet");
  await act(async () => btn(s, "List").click());
  assert.equal(s.querySelector("[aria-expanded]").getAttribute("aria-expanded"), "true");
  await act(async () => btn(s, "Map").click());
  assert.equal(s.querySelector("[aria-expanded]").getAttribute("aria-expanded"), "false");
  assert.equal(calls.length, 0, "switching views never re-queries");
  root.unmount();
});

test("marker → preview (live first, Happening Here) → close returns to Peek; another marker replaces it", async () => {
  const { host, root } = await mount();
  await act(async () => btn(sheet(host), "List").click());
  await act(async () => globalThis.__canvas.onSelect("loc:A"));
  await settle();
  const s = sheet(host);
  assert.equal(globalThis.__canvas.selectedId, "loc:A");
  assert.equal(s.querySelector("[aria-expanded]").getAttribute("aria-expanded"), "false", "selection settles on the content-sized Peek");
  assert.ok(s.textContent.includes("View Event"), "the preview leads to the canonical page — no modal");
  assert.match(s.textContent, /Live· Ends 9 PM/, "● LIVE · Ends 9 PM");
  assert.ok(s.textContent.includes("Coming Up Here"), "other activity at the same Location is grouped, not stacked");
  await act(async () => globalThis.__canvas.onSelect("loc:B"));
  await settle();
  assert.equal(globalThis.__canvas.selectedId, "loc:B");
  assert.ok(!sheet(host).textContent.includes("Coming Up Here"), "empty sections aren't rendered");
  await act(async () => btn(sheet(host), "Close preview").click());
  await settle();
  assert.equal(globalThis.__canvas.selectedId, null);
  assert.ok(!sheet(host).textContent.includes("View Event"));
  root.unmount();
});

test("a preview whose detail comes back empty doesn't leave a blank placeholder", async () => {
  const data = { ...DATA, results: [card("occ:2", "loc:B")] };
  const { host, root } = await mount({ initialData: data }, (u) => (u.includes("focus=") ? { ...DATA, results: [] } : u.includes("/preview") ? {} : data));
  await act(async () => globalThis.__canvas.onSelect("loc:A"));
  await settle();
  assert.equal(sheet(host).querySelectorAll(".animate-pulse").length, 0);
  root.unmount();
});

test("Search This Area after an Area query: nudges are ignored, a real move offers it, tapping queries the viewport once", async () => {
  const { host, root, calls } = await mount({ initialQuery: { area: "soho", market: "nyc" } });
  // The map fits itself to the Area's results (programmatic).
  await act(async () => globalThis.__canvas.onViewportChange([-74.01, 40.715, -73.99, 40.73], false));
  await act(async () => globalThis.__canvas.onViewportChange([-74.0099, 40.7151, -73.9899, 40.7301], true));
  assert.equal(btn(host, "Search This Area"), undefined, "a nudge doesn't prompt");
  await act(async () => globalThis.__canvas.onViewportChange([-73.99, 40.73, -73.97, 40.745], true));
  assert.ok(btn(host, "Search This Area"));
  const before = calls.length;
  await act(async () => btn(host, "Search This Area").click());
  await settle();
  assert.equal(calls.length, before + 1);
  assert.match(calls.at(-1), /bbox=-73\.99%2C40\.73%2C-73\.97%2C40\.745/);
  assert.doesNotMatch(calls.at(-1), /area=soho/, "the viewport replaces the Area");
  assert.equal(btn(host, "Search This Area"), undefined, "prompt resets until the map moves again");
  root.unmount();
});

test("quick temporal lenses change the actual query", async () => {
  const { host, root, calls } = await mount();
  // On the Map the four-hour window reads "Starting Soon" (URL: when=upnext).
  for (const [label, when] of [["Happening Now", "now"], ["Starting Soon", "upnext"], ["Today", "today"], ["This Weekend", "weekend"]]) {
    const b = [...host.querySelectorAll("button")].find((x) => x.textContent.trim() === label);
    await act(async () => b.click());
    await settle();
    assert.match(calls.at(-1), new RegExp(`when=${when}`), label);
  }
  root.unmount();
});

test("Near Me declined: no automatic prompt, a clear notice, the map stays usable", async () => {
  const { host, root, geo } = await mount();
  assert.equal(geo.length, 0);
  await act(async () => [...host.querySelectorAll("button")].find((x) => x.textContent.includes("Near Me")).click());
  await settle();
  assert.equal(geo.length, 1);
  assert.match(host.textContent, /couldn’t get your location/);
  assert.ok(sheet(host).querySelector('[data-result-key="occ:1"]'), "results still there");
  root.unmount();
});

test("filter CTA: shows the count; zero is a disabled, explained state — not a button that looks like an error", async () => {
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const root = createRoot(host);
  let n = 12;
  const applied = [];
  // Free is a Happening refinement (under All the sheet shows only the lens).
  await act(async () => root.render(React.createElement(MapFilterSheet, { initial: { entities: ["event", "appearance"] }, options: { categories: [], formats: [] }, onApply: (q) => applied.push(q), onClose: () => {}, count: async () => ({ total: n }) })));
  await act(async () => new Promise((r) => setTimeout(r, 450)));
  const cta = () => [...host.querySelectorAll("button")].at(-1);
  assert.equal(cta().textContent.trim(), "Show 12 Results");
  assert.equal(cta().disabled, false);
  n = 0;
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Free").click());
  await act(async () => new Promise((r) => setTimeout(r, 450)));
  assert.equal(cta().disabled, true);
  assert.match(host.textContent, /Nothing matches all of these\. Remove a filter to see results\./);
  n = 4;
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Free").click());
  await act(async () => new Promise((r) => setTimeout(r, 450)));
  assert.equal(cta().textContent.trim(), "Show 4 Results");
  await act(async () => cta().click());
  assert.equal(applied.length, 1);
  root.unmount();
});
