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
const L = await import("../src/components/map/selected-label.ts");
const R = await import("../src/lib/discovery/map-restore.ts");
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

async function mount(props = {}, responder = () => DATA, entry = null) {
  // Each mount is a fresh visit: no earlier test's URL or history entry
  // (Map Discovery Batch 2 resumes those on Back) — unless a test returns
  // to one (`entry`: the URL + history state Back lands on).
  window.history.replaceState(entry?.state ?? null, "", entry?.url ?? "/map");
  const calls = [];
  const geo = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const body = responder(String(url));
    // A responder may answer with a failed HTTP status.
    if (body && body.__status) return { ok: false, status: body.__status, json: async () => ({}) };
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

test("Peek shows the first result; the one List / Map switch changes the view without changing the result set", async () => {
  const { host, root, calls } = await mount();
  const s = sheet(host);
  assert.ok(s.textContent.includes("3 Results"));
  assert.ok(s.querySelector('[data-result-key="occ:1"]'), "first useful result is in the sheet");
  // Map Discovery Batch 1: no second "List" pill in the sheet — the top
  // bar's List / Map switch is the one view change; the header expands.
  assert.ok(![...s.querySelectorAll("button")].some((b) => ["List", "Map"].includes(b.textContent.trim())), "no duplicate List / Map control in the sheet");
  await act(async () => btn(host, "Show as List").click());
  assert.ok(btn(host, "Show on Map"), "List view; the same control returns to the Map");
  assert.ok(host.querySelector('[data-result-key="occ:1"]'), "same results in the List");
  await act(async () => btn(host, "Show on Map").click());
  assert.equal(calls.length, 0, "switching views never re-queries");
  root.unmount();
});

test("marker → floating preview at the marker (live first); the sheet stays the result list; another marker replaces it; close clears it", async () => {
  const { host, root } = await mount();
  await act(async () => globalThis.__canvas.onSelect("loc:A"));
  await settle();
  const s = sheet(host);
  assert.equal(globalThis.__canvas.selectedId, "loc:A");
  // The floating preview the canvas anchors to the marker: the live result
  // first, its real card data and public destination.
  const p = globalThis.__canvas.preview;
  assert.equal(p.featureId, "loc:A");
  assert.equal(p.href, "/event/occ:1");
  assert.equal(p.title, "Title occ:1");
  assert.equal(p.kind, "Event");
  assert.equal(p.live, true);
  assert.equal(p.status, "Ends 9 PM");
  assert.equal(p.more, 1, "+1 more here");
  // The bottom tray is independent: still every result, the selection
  // highlighted in place (and itself a link), selection settles on Peek.
  assert.equal(s.querySelector("[aria-expanded]").getAttribute("aria-expanded"), "false");
  assert.deepEqual([...s.querySelectorAll("[data-result-key]")].map((x) => x.getAttribute("data-result-key")), ["occ:1", "occ:2", "occ:3"], "the sheet keeps the full list");
  assert.ok(s.querySelector('[data-result-key="occ:1"][aria-current="true"] a[href="/event/occ:1"]'));
  assert.ok(!s.textContent.includes("Coming Up Here"), "no second, in-sheet preview on phones");
  // Desktop panel keeps its richer preview of the place.
  const aside = host.querySelector('aside[aria-label="Results"]');
  assert.ok(aside.textContent.includes("Coming Up Here"), "desktop: other activity at the same Location is grouped");
  await act(async () => globalThis.__canvas.onSelect("loc:B"));
  await settle();
  assert.equal(globalThis.__canvas.selectedId, "loc:B");
  assert.equal(globalThis.__canvas.preview.featureId, "loc:B", "another marker replaces the preview");
  assert.equal(globalThis.__canvas.preview.href, "/event/occ:2");
  await act(async () => globalThis.__canvas.onSelect(null));
  await settle();
  assert.equal(globalThis.__canvas.selectedId, null);
  assert.equal(globalThis.__canvas.preview, null, "closing returns the marker to its compact state");
  assert.ok(!sheet(host).querySelector('[aria-current="true"]'));
  root.unmount();
});

test("floating preview placement: above the pin when it fits, else below; inside the visible map; clear of the controls", () => {
  const view = { w: 390, h: 788 };
  const pad = { top: 140, bottom: 170, left: 28, right: 28 };
  const card = { w: L.previewWidth(390), h: 230 };
  assert.equal(card.w, 270, "~270px on phones");
  for (const w of [360, 390, 412, 1280]) assert.equal(L.previewWidth(w), 270, `${w}px`);
  assert.ok(L.previewWidth(240) <= 240 - 16, "never wider than a narrow map allows");
  const mid = L.placePreview({ x: 195, y: 500 }, card, view, pad);
  assert.equal(mid.side, "above");
  assert.ok(mid.fits && mid.visible);
  assert.ok(mid.top + card.h <= 500 - 20, "the card doesn't cover its pin");
  const high = L.placePreview({ x: 195, y: 200 }, card, view, pad);
  assert.equal(high.side, "below", "no room above (top controls) → below");
  assert.ok(high.top >= pad.top);
  // Near an edge: the card slides to stay inside, the caret still points at the pin.
  const edge = L.placePreview({ x: 375, y: 520 }, card, view, pad);
  assert.ok(edge.left >= 8 && edge.left + card.w <= 390 - 8, "inside the screen");
  assert.equal(edge.left + edge.caretX >= 375 - 20, true, "caret points at the pin");
  // Never over the zoom control / credits (bottom-right, just above the sheet).
  const low = L.placePreview({ x: 360, y: 610 }, card, view, pad);
  assert.ok(low.left + card.w <= 390 - 52 || low.top + card.h <= 788 - 170 - 120, "clear of the control stack");
  assert.ok(low.top + card.h <= 788 - pad.bottom, "never under the sheet");
  // A pin just under the top controls keeps its card, below it and inside.
  const top = L.placePreview({ x: 195, y: 120 }, card, view, pad);
  assert.ok(top.visible && top.side === "below" && top.top >= pad.top, "near the top: card below, clear of the controls");
  // The measured control stack (zoom + expanded map credits ~300px wide,
  // just above the sheet): the card never covers it.
  const credits = { x: 52, y: 788 - 170 - 64, w: 330, h: 60 };
  const nearCredits = L.placePreview({ x: 195, y: 330 }, card, view, pad, credits);
  const over = (c, r) => c.left < r.x + r.w && c.left + card.w > r.x && c.top < r.y + r.h && c.top + card.h > r.y;
  assert.ok(!over(nearCredits, credits), "clear of the expanded credits");
  const below = L.placePreview({ x: 195, y: 250 }, card, view, pad, credits);
  assert.ok(!over(below, credits), "a card below its pin stops above the credits");
  if (!below.fits) {
    const [px, py] = L.previewPan({ x: 195, y: 250 }, card, view, pad, credits);
    const again = L.placePreview({ x: 195 - px, y: 250 - py }, card, view, pad, credits);
    assert.ok(!over(again, credits), "and the corrective pan keeps it clear");
  }
  // A pin under the sheet: hidden until the corrective pan brings it up.
  const under = L.placePreview({ x: 195, y: 700 }, card, view, pad);
  assert.equal(under.visible, false);
  const [dx, dy] = L.previewPan({ x: 195, y: 700 }, card, view, pad);
  const after = L.placePreview({ x: 195 - dx, y: 700 - dy }, card, view, pad);
  assert.ok(after.fits && after.side === "above", "one pan makes it fit above its pin");
  // A short visible map (small phone, two results at one place): the pan
  // targets an exact fit above the pin, else the pin near the top with the
  // card below it.
  const shortView = { w: 360, h: 684 };
  const shortPad = { top: 136, bottom: 200, left: 28, right: 28 };
  const tall = { w: 300, h: 294 };
  const [sx, sy] = L.previewPan({ x: 180, y: 310 }, tall, shortView, shortPad);
  const placed = L.placePreview({ x: 180 - sx, y: 310 - sy }, tall, shortView, shortPad);
  assert.ok(placed.fits, "one pan makes it fit whole beside its pin instead of covering it");
  // Shorter covers on short visible maps (Search This Area showing, small
  // phones) so the card still fits whole beside its pin.
  assert.equal(L.previewMedia(500), "full", "the tall ~150px cover where there's room");
  assert.equal(L.previewMedia(400), "compact");
  assert.equal(L.previewMedia(340), "compact");
  assert.equal(L.previewMedia(296), "tight");
  // 360x740 with Search This Area showing: ~296px visible, tight card ~230px.
  const staPad = { top: 180, bottom: 200, left: 28, right: 28 };
  const tight = { w: 300, h: 230 };
  const [tx, ty] = L.previewPan({ x: 180, y: 332 }, tight, shortView, staPad);
  assert.ok(L.placePreview({ x: 180 - tx, y: 332 - ty }, tight, shortView, staPad).fits, "fits after the one corrective pan");
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
  for (const [label, when] of [["Happening Now", "now"], ["Up Next", "upnext"], ["Today", "today"], ["This Weekend", "weekend"]]) {
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
  await act(async () => root.render(React.createElement(MapFilterSheet, { initial: {}, options: { categories: [], formats: [] }, onApply: (q) => applied.push(q), onClose: () => {}, count: async () => n })));
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

// ================================================================ Map Discovery Batch 1

test("selected label runs away from the nearer edge and is only as wide as the room there", () => {
  // 390px phone: a centered marker's label used to run off the right edge.
  assert.equal(L.selectedLabelSide(195 + 1, 390), "left");
  assert.equal(L.selectedLabelSide(60, 390), "right");
  assert.equal(L.selectedLabelSide(370, 390), "left", "near the right edge → label to the left");
  assert.equal(L.selectedLabelWidth(390 - 60), 176, "plenty of room → the normal max width");
  assert.equal(L.selectedLabelWidth(150), 88, "tight room → a narrower, truncated label");
  assert.equal(L.selectedLabelWidth(20), 72, "never collapses below a readable minimum");
  // Label + mark + offset always fit on the chosen side (360 / 390 / 412).
  for (const w of [360, 390, 412]) for (const x of [16, w / 3, w / 2, (2 * w) / 3, w - 16]) {
    const side = L.selectedLabelSide(x, w);
    const room = side === "left" ? x : w - x;
    if (room >= 134) assert.ok(L.selectedLabelWidth(room) + 62 <= room, `fits at ${w}px, x=${x}`);
  }
});

test("a new selection pans only when hidden: under the sheet / panel, off the padded view, or in the zoom-control corner", () => {
  const pad = { top: 140, bottom: 220, left: 28, right: 28 };
  assert.equal(L.selectionNeedsPan(195, 400, 390, 844, pad), false, "clearly visible → the map stays put");
  assert.equal(L.selectionNeedsPan(195, 700, 390, 844, pad), true, "under the sheet");
  assert.equal(L.selectionNeedsPan(195, 100, 390, 844, pad), true, "under the top controls");
  assert.equal(L.selectionNeedsPan(10, 400, 390, 844, pad), true, "at the edge");
  const desk = { top: 24, bottom: 24, left: 24, right: 24 };
  assert.equal(L.selectionNeedsPan(1180, 700, 1200, 760, desk), true, "beside the zoom control");
  assert.equal(L.selectionNeedsPan(600, 380, 1200, 760, desk), false);
});

test("/map request failures show a useful error with Try Again; the last results stay; a retry recovers", async () => {
  let fail = true;
  const { host, root, calls } = await mount({}, (u) => (fail ? { __status: 500 } : { ...DATA, total: 1, results: [card("occ:9", "loc:A")] }));
  const free = [...host.querySelectorAll("button")].find((b) => b.textContent === "Free");
  await act(async () => free.click());
  await settle();
  const alert = host.querySelector('[role="alert"]');
  assert.ok(alert, "an error is shown instead of silently keeping stale results");
  assert.match(alert.textContent, /couldn’t update these results/);
  assert.match(alert.textContent, /Showing the last results we found/);
  assert.ok(host.querySelector('[data-result-key="occ:1"]'), "the last results stay on screen");
  fail = false;
  const n = calls.length;
  await act(async () => [...alert.querySelectorAll("button")].find((b) => b.textContent.trim() === "Try Again").click());
  await settle();
  assert.equal(calls.length, n + 1, "Try Again repeats the request once");
  assert.equal(host.querySelector('[role="alert"]'), null, "and clears the error on success");
  assert.ok(host.querySelector('[data-result-key="occ:9"]'));
  root.unmount();
});

test("loading and empty states are unchanged", async () => {
  const { host, root } = await mount({ initialData: { ...DATA, total: 0, features: [], results: [], relaxations: [] } });
  assert.match(host.textContent, /Nothing matches all of these filters\./);
  assert.equal(host.querySelector('[role="alert"]'), null, "an empty result is not an error");
  root.unmount();
});

test("floating preview card: cover or Findmi fallback, type + title + context, ONE whole-card link, Close above it", async () => {
  const { default: MapFloatingPreview } = await import("../src/components/map/MapFloatingPreview.tsx");
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const root = createRoot(host);
  let closed = 0;
  const preview = { featureId: "loc:A", href: "/event/x", title: "A Very Long Holiday Makers Market Name That Wraps", kind: "Event", image: null, logo: null, status: "Starts 3 PM", live: false, detail: "Sat, Nov 7 · 3–9 PM", subtitle: "Chelsea Piers", more: 2 };
  await act(async () => root.render(React.createElement(MapFloatingPreview, { preview, side: "above", caretX: 150, style: { left: 10, top: 10, width: 300 }, onClose: () => closed++ })));
  const card = host.querySelector('[data-map-preview="loc:A"]');
  assert.ok(card);
  const links = card.querySelectorAll("a");
  assert.equal(links.length, 1, "one destination");
  assert.equal(links[0].getAttribute("href"), "/event/x");
  assert.ok(links[0].className.includes("after:inset-0"), "the whole card is the link");
  assert.ok(card.querySelector(".from-findmi-700.to-ink"), "no image → the Findmi gradient fallback");
  for (const t of ["Event", "Starts 3 PM", "Sat, Nov 7 · 3–9 PM", "Chelsea Piers", "+2 more here", preview.title]) assert.ok(card.textContent.includes(t), t);
  assert.ok(card.querySelector(".line-clamp-3"), "full, readable title (wraps up to three lines)");
  assert.ok(card.querySelector(".h-\\[150px\\]"), "the tall ~150px cover by default");
  assert.ok(card.textContent.includes("Sat, Nov 7 · 3–9 PM · Chelsea Piers"), "compact metadata: when · where on one line");
  // Tap feedback: pressed at once, then a small pending indicator.
  assert.ok(card.querySelector("article").className.includes("active:scale-[0.98]"), "immediate press feedback");
  assert.equal(card.querySelector('[role="status"]'), null);
  await act(async () => links[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
  assert.equal(card.getAttribute("data-pending"), "true");
  assert.match(card.querySelector('[role="status"]').textContent, /Opening…/, "pending-navigation indicator");
  assert.ok(card.querySelector("article").className.includes("ring-findmi"));
  await act(async () => dom.window.dispatchEvent(new dom.window.Event("pageshow")));
  assert.equal(card.querySelector('[role="status"]'), null, "cleared when the page comes back (back/forward cache)");
  await act(async () => links[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true })));
  assert.equal(card.querySelector('[role="status"]'), null, "a new-tab click leaves the card as it is");
  const close = card.querySelector('button[aria-label="Close map preview"]');
  assert.ok(close.className.includes("z-10"), "Close sits above the card link");
  await act(async () => close.click());
  assert.equal(closed, 1);
  root.unmount();
});

// ================================================================ Map Discovery Batch 2 — Back restores the discovery context

const BBOX = [-74.02, 40.7, -73.96, 40.77];
const PANNED = [-73.995, 40.72, -73.975, 40.74];

test("resume rules: the entry's URL beats a stale first render; its camera / selection / sheet only for that same query", () => {
  const initial = { bbox: BBOX };
  const loc = { pathname: "/map", search: `?free=1&when=weekend&bbox=${BBOX.join("%2C")}&view=list` };
  const key = Q.queryKey({ bbox: BBOX, free: true, when: "weekend" });
  const state = { __NA: true, findmiMap: { v: 1, key, viewport: PANNED, selected: "loc:B", sheet: "browse" } };
  const r = R.resumeMap(initial, "map", loc, state);
  assert.deepEqual({ free: r.query.free, when: r.query.when }, { free: true, when: "weekend" }, "filters + time from the URL");
  assert.equal(r.view, "list", "presentation from the URL");
  assert.deepEqual(r.entry.viewport, PANNED);
  assert.equal(r.entry.selected, "loc:B");
  assert.equal(r.entry.sheet, "browse");
  assert.equal(R.resumeMap(initial, "map", loc, { findmiMap: { ...state.findmiMap, key: "other" } }).entry, null, "another query's context is never applied");
  assert.equal(R.resumeMap(initial, "map", loc, { findmiMap: { ...state.findmiMap, viewport: [1, 2, 0, 3] } }).entry.viewport, null, "an invalid camera is dropped");
  const near = R.resumeMap(initial, "map", { pathname: "/map", search: "?near=1&free=1" }, null);
  assert.equal(near.query, initial, "Near Me is never resumed from a URL — the page asks again");
  const fresh = R.resumeMap(initial, "map", { pathname: "/map", search: "" }, null);
  assert.equal(fresh.query, initial, "a fresh visit keeps the server's default area");
  const next = R.mapEntryState({ __NA: true, tree: 1 }, { key, viewport: PANNED, selected: null, sheet: "peek" });
  assert.equal(next.__NA, true, "the router's own history state is kept");
  assert.equal(next.findmiMap.v, 1);
});

test("archive hints: only for the same result set, recent, and well-formed", () => {
  const now = 1_800_000_000_000;
  const ok = JSON.stringify({ key: "when=weekend", viewport: PANNED, selected: "loc:x", sheet: "browse", t: now - 60_000 });
  assert.deepEqual(R.parseGeoViewHint(ok, "when=weekend", now).viewport, PANNED);
  assert.equal(R.parseGeoViewHint(ok, "when=today", now), null, "another result set");
  assert.equal(R.parseGeoViewHint(JSON.stringify({ ...JSON.parse(ok), t: now - R.GEO_VIEW_TTL_MS - 1 }), "when=weekend", now), null, "stale");
  assert.equal(R.parseGeoViewHint("{oops", "when=weekend", now), null);
  assert.equal(R.parseGeoViewHint(JSON.stringify({ ...JSON.parse(ok), sheet: "huge" }), "when=weekend", now).sheet, "peek");
});

test("Back to /map: filters / search / time from the entry URL, the same camera, the selected result's floating preview and the sheet", async () => {
  const url = `/map?free=1&when=weekend&bbox=${BBOX.join("%2C")}`;
  const key = Q.queryKey({ bbox: BBOX, free: true, when: "weekend" });
  const state = { findmiMap: { v: 1, key, viewport: PANNED, selected: "loc:B", sheet: "browse" } };
  // The server's (cached) first render was the unfiltered query.
  const { host, root, calls } = await mount({}, () => DATA, { url, state });
  await settle();
  assert.ok(calls.some((u) => /free=1/.test(u) && /when=weekend/.test(u)), "the entry's query is what's fetched");
  assert.deepEqual(globalThis.__canvas.initialBbox, PANNED, "same center / zoom as when the visitor left");
  assert.equal(globalThis.__canvas.selectedId, "loc:B", "the selected result");
  assert.equal(globalThis.__canvas.preview?.featureId, "loc:B", "its floating preview is open again");
  assert.equal(sheet(host).querySelector("[aria-expanded]").getAttribute("aria-expanded"), "true", "the sheet position");
  const on = (label) => [...host.querySelectorAll('button[aria-pressed="true"]')].some((b) => b.textContent.trim() === label);
  assert.ok(on("Free"), "the Free filter chip is on");
  assert.ok(on("This Weekend"), "and the time window");
  assert.match(window.location.search, /free=1/, "and the URL keeps them (never rewritten to the stale render)");
  root.unmount();
});

test("Back to /map restores Search This Area exactly as it was (a programmatic pan never offered it)", async () => {
  const url = `/map?bbox=${BBOX.join("%2C")}`;
  const key = Q.queryKey({ bbox: BBOX });
  const { host, root } = await mount({}, () => DATA, { url, state: { findmiMap: { v: 1, key, viewport: PANNED, selected: null, sheet: "peek", searchArea: false } } });
  assert.deepEqual(globalThis.__canvas.initialBbox, PANNED);
  assert.equal(btn(host, "Search This Area"), undefined);
  root.unmount();
});

test("Back to /map with a selection that's gone: camera and filters stay, the selection clears quietly", async () => {
  const url = `/map?free=1&bbox=${BBOX.join("%2C")}`;
  const key = Q.queryKey({ bbox: BBOX, free: true });
  const { root } = await mount({}, () => DATA, { url, state: { findmiMap: { v: 1, key, viewport: PANNED, selected: "loc:GONE", sheet: "peek" } } });
  assert.deepEqual(globalThis.__canvas.initialBbox, PANNED);
  assert.equal(globalThis.__canvas.selectedId, null);
  assert.equal(globalThis.__canvas.preview, null);
  root.unmount();
});

test("the history entry keeps the context as the visitor explores (camera, selection, sheet) — never a Near Me camera", async () => {
  const { root } = await mount();
  await act(async () => globalThis.__canvas.onViewportChange(PANNED, true));
  await act(async () => globalThis.__canvas.onSelect("loc:A"));
  await settle();
  const e = window.history.state.findmiMap;
  assert.deepEqual(e.viewport, PANNED);
  assert.equal(e.selected, "loc:A");
  assert.equal(e.searchArea, true, "whether Search This Area was offered is kept, not re-derived");
  assert.equal(e.key, Q.queryKey({ bbox: [-74.02, 40.7, -73.96, 40.77] }));
  root.unmount();
  const n = await mount({ initialQuery: { near: true, bbox: BBOX } });
  assert.equal(window.history.state.findmiMap.viewport, null, "the viewer's own area is never stored");
  n.root.unmount();
});
