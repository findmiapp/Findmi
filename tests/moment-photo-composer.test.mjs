// Moment photo composer — ONE photo-composition capability for signed-out
// and signed-in people, and a photo pipeline that uploads every supported
// photo (HEIC/HEIF included) through the same signed-URL path.
//
// REAL runtime, not source patterns: the real MomentComposer (photo hook,
// Photos stage, draft module, IndexedDB media module, image preprocessing)
// mounted with react-dom in jsdom. Only the network edges are stubbed
// (server actions, the browser Supabase client, next/navigation,
// next/image); IndexedDB is the same in-memory fake the guest draft tests
// use. A "reload" is an unmount + fresh mount against the same storage.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");
const { JSDOM } = require("jsdom");

const ROOT = process.cwd();
const FIX = resolvePath(ROOT, "tests/fixtures/moment-composer");
const STAGE_FIX = resolvePath(ROOT, "tests/fixtures/moment-stage");
const STUBS = {
  "@/app/(public)/my-world/journal/actions": `${FIX}/actions.mjs`,
  "@/lib/supabase/client": `${FIX}/browser-supabase.mjs`,
  "next/image": `${STAGE_FIX}/next-image.mjs`,
  "next/navigation": `${FIX}/navigation.mjs`,
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

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://findmi.test/my-world/journal/new", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Node", "Element", "Event", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key] ?? dom.window, configurable: true, writable: true });
}
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const { installFakeIndexedDb, resetFakeIndexedDb } = await import(pathToFileURL(`${FIX}/fake-indexeddb.mjs`).href);
installFakeIndexedDb();
const { calls, counters, authorized, finalized, createdSections } = await import(pathToFileURL(`${FIX}/actions.mjs`).href);
const { uploads, failOnce } = await import(pathToFileURL(`${FIX}/browser-supabase.mjs`).href);
const { pushes } = await import(pathToFileURL(`${FIX}/navigation.mjs`).href);

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { default: MomentComposer } = await import("../src/components/journal/MomentComposer.tsx");
const { PhotoSourceMenu, usePhotoSource } = await import("../src/components/journal/photoSource.tsx");
const { emptyMomentInitial } = await import("../src/lib/moment-composer.ts");
const Draft = await import("../src/lib/guest-moment-draft.ts");
const h = React.createElement;

// ── harness ──────────────────────────────────────────────────────────────

let root = null;
let container = null;

async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++) await act(async () => new Promise((r) => setTimeout(r, 12)));
}
async function unmount() {
  if (root) await act(async () => root.unmount());
  root = null;
  document.body.innerHTML = "";
}
async function mount(element) {
  await unmount();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(element));
  await settle();
}
const load = ({ authed = false, resume = false } = {}) => mount(h(MomentComposer, { mode: "create", initial: emptyMomentInitial(), cancelHref: "/", authed, resume }));

const click = async (el) => act(async () => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
const buttons = (text, scope = document) => [...scope.querySelectorAll("button")].filter((b) => b.textContent.trim() === text);
const button = (text, scope = document) => {
  const found = buttons(text, scope).at(-1);
  assert.ok(found, `"${text}" is offered (offered: ${[...scope.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean).join(" | ")})`);
  return found;
};
const goStage = async (label) => click(buttons(label, container.querySelector('nav[aria-label="Moment steps"]'))[0]);
const type = async (el, value) => {
  await act(async () => {
    const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};

async function addPhotos(...files) {
  const input = container.querySelector('input[aria-label="Add photos"]');
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => input.dispatchEvent(new window.Event("change", { bubbles: true })));
  await settle();
}
const png = (name) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
const jpg = (name) => new File([new Uint8Array([4, 5, 6])], name, { type: "image/jpeg" });
const heic = (name) => new File([new Uint8Array([7, 8, 9])], name, { type: "image/heic" });

const tiles = () => [...container.querySelectorAll('button[aria-label="Photo options"]')].map((b) => b.closest("div.group"));
async function menuAction(photoIndex, label) {
  await click(container.querySelectorAll('button[aria-label="Photo options"]')[photoIndex]);
  await click(button(label, document.body));
  await settle(2);
}
async function addNote(photoIndex, text) {
  await menuAction(photoIndex, "Add A Note");
  const sheet = document.querySelector('[role="dialog"]');
  await type(sheet.querySelector("textarea"), text);
  await click(button("Save Note", sheet));
  await settle(2);
}
/** Organize Your Photos → + Add Section → a preset; then puts the chosen
 * photos (by grid index) into it through the existing assign sheet. */
async function addSection(label, photoIndexes) {
  await click(button("+ Add Section", container));
  await click(button(label, document.querySelector('[role="dialog"]')));
  await settle(3);
  const sheet = document.querySelector('[role="dialog"]');
  assert.ok(sheet, "choosing a section with unsectioned photos offers to fill it");
  const picks = [...sheet.querySelectorAll('button[aria-label="Select photo"]')];
  for (const i of photoIndexes) await click(picks[i]);
  await click(button(`Add ${photoIndexes.length} Photo${photoIndexes.length === 1 ? "" : "s"}`, sheet));
  await settle(3);
}
const stored = () => Draft.readGuestMomentDraft();

beforeEach(async () => {
  await unmount();
  window.localStorage.clear();
  resetFakeIndexedDb();
  for (const list of [calls, uploads, pushes, authorized, finalized, createdSections]) list.length = 0;
  failOnce.clear();
  counters.entries = 0;
});
after(unmount);

// ── 1-6 · signed out: the complete photo composer ────────────────────────

test("1. a signed-out Photos step exposes Organize Your Photos — the same tools as signed in, with nothing sent to the server", async () => {
  await load();
  await goStage("Photos");
  await addPhotos(png("a.png"), png("b.png"));
  assert.equal(tiles().length, 2);
  assert.match(container.textContent, /Organize Your Photos/);
  assert.ok(buttons("+ Add Section", container).length > 0);
  assert.deepEqual(calls, [], "no server action");
  assert.deepEqual(uploads, [], "no Storage upload");
});

test("2. a guest creates sections and assigns photos with the existing section system — kept in the draft, never on the server", async () => {
  await load();
  await goStage("Photos");
  await addPhotos(png("a.png"), png("b.png"), png("c.png"));
  await addSection("The Place", [1]);
  assert.match(container.textContent, /Sections/);
  assert.ok(container.querySelector('[aria-label="Filter photos by section"]'), "section filter chips render");
  assert.ok(buttons("+ Add Section", container).length > 0, "more sections can be added");
  const draft = stored();
  assert.equal(draft.sections.length, 1);
  assert.equal(draft.sections[0].sectionType, "place");
  assert.deepEqual(
    draft.media.map((m) => m.sectionId ?? null),
    [null, draft.sections[0].id, null],
    "the chosen photo carries the section; the global photo order is unchanged"
  );
  assert.deepEqual(calls, []);
});

test("3-4. guest photo notes (•••), cover, reorder and remove all work and land in the draft", async () => {
  await load();
  await goStage("Photos");
  await addPhotos(png("a.png"), png("b.png"), png("c.png"));
  const [a, b, c] = stored().media.map((m) => m.localId);
  await addNote(0, "The front window");
  assert.equal(stored().media[0].caption, "The front window");
  await menuAction(2, "Make Cover");
  assert.deepEqual(stored().media.map((m) => m.isCover), [false, false, true]);
  await menuAction(0, "Move Later");
  assert.deepEqual(stored().media.map((m) => m.localId), [b, a, c]);
  await menuAction(1, "Remove");
  assert.deepEqual(stored().media.map((m) => m.localId), [b, c]);
  assert.deepEqual(calls, []);
});

test("5. a guest draft keeps its photo organization across a reload: order, cover, notes, sections and section membership", async () => {
  await load();
  await goStage("Photos");
  await addPhotos(png("a.png"), png("b.png"), png("c.png"));
  await addNote(1, "Best bite");
  await menuAction(2, "Make Cover");
  await addSection("Food & Drink", [0, 1]);
  const before = stored();

  await load(); // reload
  await goStage("Photos");
  const after = stored();
  assert.equal(tiles().length, 3, "every photo is back");
  assert.match(container.textContent, /Organize Your Photos/);
  assert.match(container.textContent, /Food & Drink/, "the section is back");
  assert.deepEqual(after.media, before.media, "order, cover, note and section membership survive");
  assert.deepEqual(after.sections.map((s) => [s.id, s.sectionType]), before.sections.map((s) => [s.id, s.sectionType]));
  assert.deepEqual(calls, []);
});

test("6. signing in converts the WHOLE composition: sections created, each photo uploaded into its section in order, notes and cover carried over", async () => {
  await load();
  await goStage("Photos");
  await addPhotos(png("a.png"), png("b.png"), png("c.png"));
  await addNote(2, "Dessert");
  await menuAction(1, "Make Cover");
  await addSection("Food & Drink", [2]);
  await goStage("Your Moment");
  await type(container.querySelector('input[placeholder^="e.g. Saturday"]'), "Dinner Out");

  await load({ authed: true, resume: true }); // the auth round trip
  await settle(10);

  assert.equal(calls.filter((c) => c === "startJournalDraft").length, 1, "exactly one Moment");
  assert.equal(createdSections.length, 1, "the guest's section is created for real");
  assert.equal(createdSections[0].section_type, "food_drink");
  assert.equal(finalized.length, 3, "every photo uploaded once");
  assert.deepEqual(finalized.map((f) => f.displayOrder), [0, 1, 2], "in the guest's order");
  assert.deepEqual(finalized.map((f) => f.sectionId ?? null), [null, null, createdSections[0].id], "each photo straight into its real section");
  assert.ok(calls.includes("saveJournalMediaCaption"), "the note is carried over");
  assert.ok(calls.includes("setJournalCover"), "the chosen cover is carried over");
  assert.equal(stored(), null, "the draft is cleared only after a full conversion");
  assert.equal(pushes.length, 1);
});

test("6b. a retried conversion reuses sections already created for this draft instead of adding them again", async () => {
  const draft = { ...Draft.emptyGuestMomentDraft(), title: "Again", serverEntryId: "entry-9", sections: [{ id: "local-x", sectionType: "place", title: null, notes: null, serverId: "sec-existing" }] };
  Draft.writeGuestMomentDraft(draft);
  await load({ authed: true, resume: true });
  await settle(6);
  assert.equal(createdSections.length, 0);
});

// ── 7-9 · photo source menu ─────────────────────────────────────────────

test("7. the Add Photos menu lists Choose From Photos above Take Photo, keeping the compact rows", async () => {
  await mount(h(PhotoSourceMenu, { takePhoto: () => {}, choosePhotos: () => {} }));
  const rows = [...container.querySelectorAll("li button")].map((b) => b.textContent);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /Choose From Photos/);
  assert.match(rows[0], /Pick one or more from your library/);
  assert.match(rows[1], /Take Photo/);
  assert.match(rows[1], /Open your camera/);
});

test("8-9. Choose From Photos is a multi-image library input; Take Photo stays a camera-only capture input", async () => {
  function Inputs() {
    return usePhotoSource(() => {}).inputs;
  }
  await mount(h(Inputs));
  const library = container.querySelector('input[aria-label="Add photos"]');
  const camera = container.querySelector('input[aria-label="Take a photo"]');
  assert.equal(library.getAttribute("accept"), "image/*");
  assert.equal(library.hasAttribute("multiple"), true);
  assert.equal(library.hasAttribute("capture"), false, "the library picker never forces the camera");
  assert.equal(camera.getAttribute("capture"), "environment");
  assert.equal(camera.hasAttribute("multiple"), false);
});

// ── 10-13 · signed-in upload pipeline ──────────────────────────────────

test("10. several photos at once (HEIC included) all go through ONE signed-URL pipeline: authorized once each, uploaded once each, finalized in order", async () => {
  await load({ authed: true });
  await goStage("Photos");
  await addPhotos(jpg("a.jpg"), heic("b.heic"), png("c.png"), jpg("d.jpg"));
  await settle(6);
  assert.deepEqual(authorized.map((a) => a.extension), ["jpg", "heic", "png", "jpg"], "HEIC is staged as-is for server-side conversion");
  assert.equal(new Set(uploads).size, 4, "four distinct Storage objects");
  assert.equal(uploads.length, 4, "no photo uploaded twice");
  assert.ok(uploads[1].endsWith(".heic"));
  assert.deepEqual(finalized.map((f) => f.displayOrder), [0, 1, 2, 3]);
  assert.equal(calls.includes("uploadJournalPhoto"), false, "no multi-MB Server Action request body for HEIC any more");
  assert.equal(tiles().length, 4);
  assert.equal(buttons("Retry", container).length, 0);
});

test("11-12. one failed photo shows Retry, retries on its own, and never re-uploads the photos that already succeeded", async () => {
  await load({ authed: true });
  await goStage("Photos");
  // The second photo's first upload fails (its path is known once authorized).
  const realPush = authorized.push.bind(authorized);
  authorized.push = (...items) => {
    if (authorized.length === 0) failOnce.add(`p/${items[1].localId}.${items[1].extension}`);
    return realPush(...items);
  };
  try {
    await addPhotos(jpg("a.jpg"), jpg("b.jpg"), jpg("c.jpg"));
    await settle(6);
  } finally {
    authorized.push = realPush;
  }
  assert.equal(buttons("Retry", container).length, 1, "only the failed photo offers Retry");
  assert.match(container.textContent, /1 photo couldn't be uploaded\. Tap Retry on it\./);
  assert.equal(finalized.length, 2, "the two good photos were saved");
  const uploadedBefore = uploads.length;
  const finalizedBefore = finalized.length;

  await click(buttons("Retry", container)[0]);
  await settle(6);
  assert.equal(buttons("Retry", container).length, 0);
  assert.equal(uploads.length, uploadedBefore + 1, "exactly one upload: the failed photo");
  assert.equal(finalized.length, finalizedBefore + 1, "exactly one finalize: the failed photo");
  assert.equal(new Set(finalized.map((f) => f.localId)).size, 3, "no photo saved twice");
});

test("13. signed in, sections still go straight to the server (unchanged)", async () => {
  await load({ authed: true });
  await goStage("Photos");
  await addPhotos(jpg("a.jpg"), jpg("b.jpg"));
  await settle(4);
  await addSection("The Place", [0]);
  assert.equal(createdSections.length, 1);
  assert.ok(calls.includes("createJournalSection"));
  assert.ok(calls.includes("saveJournalMediaLayout"), "the assignment is persisted");
});
