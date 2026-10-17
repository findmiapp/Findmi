// Moment editor — Section card thumbnails, exercised through the REAL
// client path: the real useJournalPhotoUpload hook owns the photo state,
// the real MomentPhotosStage renders it (master grid, filter chips,
// Section cards), and the test clicks the real controls (••• → Move To
// Section, Add Photos To This Section). Mounted with react-dom in jsdom.
// Only the network edges are stubbed (server actions, Supabase browser
// client, image preprocessing) and next/image renders a plain <img>.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");
const { JSDOM } = require("jsdom");

const ROOT = process.cwd();
const FIX = resolvePath(ROOT, "tests/fixtures/moment-stage");
const STUBS = {
  "@/app/(public)/my-world/journal/actions": `${FIX}/actions.mjs`,
  "@/lib/supabase/client": `${FIX}/empty.mjs`,
  "@/lib/imagePreprocessing": `${FIX}/empty.mjs`,
  "next/image": `${FIX}/next-image.mjs`,
};
const withExt = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((f) => existsSync(f) && !f.endsWith("/"));

registerHooks({
  resolve(specifier, context, next) {
    if (STUBS[specifier]) return { url: pathToFileURL(STUBS[specifier]).href, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const f = withExt(resolvePath(ROOT, "src", specifier.slice(2)));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.includes("/src/")) {
      const f = withExt(resolvePath(new URL(".", context.parentURL).pathname, specifier));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.includes("/src/") && /\.tsx?$/.test(url)) {
      const path = new URL(url).pathname;
      const { code } = transform(readFileSync(path, "utf8"), { transforms: ["typescript", "jsx"], jsxRuntime: "automatic", production: true, filePath: path });
      return { format: "module", source: code, shortCircuit: true };
    }
    return next(url, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Element", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  if (!(key in globalThis) || key === "navigator") Object.defineProperty(globalThis, key, { value: dom.window[key] ?? dom.window, configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { default: MomentPhotosStage } = await import("../src/components/journal/MomentPhotosStage.tsx");
const { useJournalPhotoUpload } = await import("../src/components/journal/useJournalPhotoUpload.ts");
const h = React.createElement;

// A B C D E in global display_order; A is the cover; nothing sectioned yet.
const PHOTOS = ["A", "B", "C", "D", "E"].map((id, i) => ({ id, url: `https://img.test/${id}.jpg`, isCover: i === 0, sectionId: null, caption: null }));
const SECTIONS = [
  { id: "s-exp", journal_entry_id: "e1", section_type: "experience", title: null, notes: null, display_order: 0 },
  { id: "s-place", journal_entry_id: "e1", section_type: "place", title: null, notes: null, display_order: 1 },
];

let order = [];
function Harness({ initial }) {
  const photos = useJournalPhotoUpload(initial, async () => "e1");
  const [sections, setSections] = React.useState(SECTIONS);
  order = photos.items.map((it) => it.localId);
  return h(MomentPhotosStage, { photos, sections, setSections, ensureEntryId: async () => "e1", onError: () => {} });
}

let container;
let root;
async function mount(initial = PHOTOS) {
  if (root) await act(async () => root.unmount());
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(h(Harness, { initial })));
}
const sectionThumbs = (label) => {
  const ul = document.querySelector(`ul[aria-label="Photos in ${label}"]`);
  return ul ? [...ul.querySelectorAll("img")].map((img) => img.getAttribute("src").match(/\/(\w)\.jpg$/)[1]) : [];
};
const buttons = (text) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === text);
const click = async (el) => act(async () => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
async function moveViaMenu(photoIndex, sectionLabel) {
  await click(document.querySelectorAll('button[aria-label="Photo options"]')[photoIndex]);
  await click(buttons("Move To Section")[0]);
  const sheet = document.querySelector('[role="dialog"]') ?? document.body;
  // A sheet option is "<label>[hint][Current]" — match on its label line.
  await click([...sheet.querySelectorAll("button")].filter((b) => b.querySelector("span > span")?.textContent.trim() === sectionLabel).at(-1));
}

before(async () => mount());
after(async () => act(async () => root.unmount()));

test("assign via the real Add Photos To This Section sheet → the Section card shows those thumbnails", async () => {
  assert.deepEqual(sectionThumbs("The Experience"), [], "nothing assigned yet");
  await click(buttons("Add Photos To This Section")[0]);
  const picks = document.querySelectorAll('button[aria-label="Select photo"]');
  await click(picks[3]); // D
  await click(picks[1]); // B
  await click(buttons("Add 2 Photos")[0]);
  assert.deepEqual(sectionThumbs("The Experience"), ["B", "D"], "visible, in global relative order");
  assert.deepEqual(order, ["A", "B", "C", "D", "E"], "global order unchanged");
});

test("the Section card and the Section filter chip read the same current state", async () => {
  await click(buttons("The Experience")[0]); // the filter chip
  const grid = [...container.querySelectorAll('button[aria-label="Photo options"]')].length;
  assert.equal(grid, sectionThumbs("The Experience").length);
  await click(buttons("All")[0]);
});

test("move one photo to Section B via ••• → Move To Section: A loses it, B gains it, order unchanged", async () => {
  await moveViaMenu(3, "The Place"); // D
  assert.deepEqual(sectionThumbs("The Experience"), ["B"]);
  assert.deepEqual(sectionThumbs("The Place"), ["D"]);
  assert.deepEqual(order, ["A", "B", "C", "D", "E"]);
});

test("clearing a photo's Section removes it from that card only; the cover shows in its Section", async () => {
  await moveViaMenu(1, "No Section"); // B
  assert.deepEqual(sectionThumbs("The Experience"), []);
  assert.deepEqual(sectionThumbs("The Place"), ["D"]);
  await moveViaMenu(0, "The Place"); // A — the cover
  assert.deepEqual(sectionThumbs("The Place"), ["A", "D"], "cover included, global order");
  assert.deepEqual(order, ["A", "B", "C", "D", "E"]);
});

test("after save/reload (assignments come back from the server), the cards show them", async () => {
  await mount(PHOTOS.map((p) => ({ ...p, sectionId: { B: "s-exp", E: "s-exp", C: "s-place" }[p.id] ?? null })));
  assert.deepEqual(sectionThumbs("The Experience"), ["B", "E"]);
  assert.deepEqual(sectionThumbs("The Place"), ["C"]);
});

// ── Preset sections are unique: choosing an existing one reuses it ────────
const STUB = await import("@/app/(public)/my-world/journal/actions");
const P = await import("../src/lib/journal-sections.ts");
const sectionCards = () => document.querySelectorAll('select[aria-label="Section type"]').length;
const presetButton = (label) => [...(document.querySelector('[role="dialog"][aria-label="Add Section"]')?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === label);
async function openAddSection() {
  await click(buttons("+ Add Section")[0]);
}

test("presets: the server-side rule reuses an existing preset, never 'other'", () => {
  const rows = [
    { id: "x2", section_type: "experience", display_order: 3 },
    { id: "x1", section_type: "experience", display_order: 1 }, // historical duplicate
    { id: "o1", section_type: "other", display_order: 2 },
  ];
  assert.equal(P.existingPresetSection(rows, "experience").id, "x1", "first in section order");
  assert.equal(P.existingPresetSection(rows, "place"), null);
  assert.equal(P.existingPresetSection(rows, "other"), null, "free-form sections may repeat");
  const src = readFileSync("src/app/(public)/my-world/journal/actions.ts", "utf8");
  assert.match(src, /const reuse = existingPresetSection\(existing, input\.sectionType\);\s*if \(reuse\) return \{ section: reuse \};\s*const nextOrder/);
});

test("Add Section → an existing preset is REUSED: no new section, photos intact, card focused, all presets still offered", async () => {
  await mount(PHOTOS.map((p) => ({ ...p, sectionId: p.id === "B" ? "s-exp" : null })));
  STUB.createdSections.length = 0;
  assert.equal(sectionCards(), 2);
  await openAddSection();
  for (const label of Object.values(P.JOURNAL_SECTION_TYPE_LABELS)) assert.ok(presetButton(label), `${label} still offered`);
  await click(presetButton("The Experience"));
  await act(async () => new Promise((r) => setTimeout(r, 50)));
  assert.equal(STUB.createdSections.length, 0, "no create request for an existing preset");
  assert.equal(sectionCards(), 2, "section count unchanged");
  assert.deepEqual(sectionThumbs("The Experience"), ["B"], "existing section keeps its photos");
  const focused = document.querySelector("[data-focused]");
  assert.ok(focused?.querySelector('ul[aria-label="Photos in The Experience"]'), "the existing card is the one highlighted");
  assert.equal(document.querySelector('[role="dialog"]')?.getAttribute("aria-label"), "Add Photos To The Experience", "straight into its Add Photos flow");
  assert.deepEqual(order, ["A", "B", "C", "D", "E"]);
});

test("Add Section → an unused preset is created normally, then reused", async () => {
  await mount();
  STUB.createdSections.length = 0;
  await openAddSection();
  await click(presetButton("Favorites"));
  await act(async () => new Promise((r) => setTimeout(r, 50)));
  assert.equal(STUB.createdSections.length, 1);
  assert.equal(sectionCards(), 3);
  await click(document.querySelector('[role="dialog"] button[aria-label="Close"]') ?? buttons("Cancel")[0] ?? document.body);
  await openAddSection();
  await click(presetButton("Favorites"));
  await act(async () => new Promise((r) => setTimeout(r, 50)));
  assert.equal(STUB.createdSections.length, 1, "second pick reuses it");
  assert.equal(sectionCards(), 3);
});

test("rapid repeated taps on a new preset create exactly one section", async () => {
  await mount();
  STUB.createdSections.length = 0;
  await openAddSection();
  const btn = presetButton("People");
  await act(async () => {
    for (let i = 0; i < 4; i++) btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await act(async () => new Promise((r) => setTimeout(r, 80)));
  assert.equal(STUB.createdSections.length, 1);
  assert.equal(sectionCards(), 3);
});
