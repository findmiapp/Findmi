// Guest Moment draft — REAL runtime lifecycle, not source patterns.
//
// The real MomentComposer (and the real photo hook, Context stage, Photos
// stage, draft module and IndexedDB media module) is mounted with react-dom
// in jsdom. Only the network edges are stubbed (server actions, the browser
// Supabase client, next/navigation, next/image) and IndexedDB is a faithful
// in-memory fake. A "reload" is an unmount + fresh mount against the SAME
// localStorage and the SAME IndexedDB — exactly what survives a browser
// reload. A guest test also asserts that no server action and no Storage
// upload ever happened (no anonymous DB write, no anonymous upload).
import { test, before, beforeEach, after } from "node:test";
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
  "@/lib/imagePreprocessing": `${STAGE_FIX}/empty.mjs`,
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

const { installFakeIndexedDb, resetFakeIndexedDb, fakeIndexedDbSnapshot } = await import(pathToFileURL(`${FIX}/fake-indexeddb.mjs`).href);
installFakeIndexedDb();
const { calls, counters } = await import(pathToFileURL(`${FIX}/actions.mjs`).href);
const { uploads } = await import(pathToFileURL(`${FIX}/browser-supabase.mjs`).href);
const { pushes } = await import(pathToFileURL(`${FIX}/navigation.mjs`).href);

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { default: MomentComposer } = await import("../src/components/journal/MomentComposer.tsx");
const { emptyMomentInitial } = await import("../src/lib/moment-composer.ts");
const Draft = await import("../src/lib/guest-moment-draft.ts");
const h = React.createElement;

const DRAFT_KEY = "findmi_guest_moment_draft_v1";
const MEDIA_DB = "findmi-guest-moments";
const MEDIA_STORE = "media";

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
/** A (re)load of /my-world/journal/new: a brand-new React tree against the
 * same localStorage + IndexedDB. */
async function load({ initial = emptyMomentInitial(), authed = false, resume = false } = {}) {
  await unmount();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(h(MomentComposer, { mode: "create", initial, cancelHref: "/", authed, resume })));
  await settle();
}

const setNative = (el, value) => {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
};
const type = async (el, value) => {
  await act(async () => {
    setNative(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};
const click = async (el) => act(async () => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
const buttons = (text, scope = document) => [...scope.querySelectorAll("button")].filter((b) => b.textContent.trim() === text);
const goStage = async (label) => click(buttons(label, container.querySelector('nav[aria-label="Moment steps"]'))[0]);

const titleInput = () => container.querySelector('input[placeholder^="e.g. Saturday"]');
const notesInput = () => [...container.querySelectorAll("label")].find((l) => l.textContent.includes("Tell The Story")).querySelector("textarea");
const dateInput = () => container.querySelector('input[aria-label="Date"]');
const photoInput = () => container.querySelector('input[aria-label="Add photos"]');
const thumbs = () => [...container.querySelectorAll('button[aria-label="Photo options"]')].length;
const thumbSrcs = () => [...container.querySelectorAll('button[aria-label="Photo options"]')].map((b) => b.closest("div.group").querySelector("img").getAttribute("src"));

async function addPhotos(...files) {
  const input = photoInput();
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => input.dispatchEvent(new window.Event("change", { bubbles: true })));
  await settle();
}
const png = (name, bytes = [1, 2, 3]) => new File([new Uint8Array(bytes)], name, { type: "image/png" });

async function menuAction(photoIndex, label) {
  const opener = container.querySelectorAll('button[aria-label="Photo options"]')[photoIndex];
  assert.ok(opener, `photo ${photoIndex} has an options button`);
  await click(opener);
  const item = buttons(label, document.body).at(-1);
  assert.ok(item, `menu offers "${label}" (offered: ${[...document.body.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean).join(" | ")})`);
  await click(item);
  await settle(2);
}
async function addNote(photoIndex, text) {
  await menuAction(photoIndex, "Add A Note");
  const sheet = document.querySelector('[role="dialog"]');
  await type(sheet.querySelector("textarea"), text);
  await click(buttons("Save Note", sheet)[0]);
  await settle(2);
}

const storedDraft = () => Draft.readGuestMomentDraft();
const storedMediaKeys = () => fakeIndexedDbSnapshot()[MEDIA_DB]?.stores[MEDIA_STORE] ?? [];
const eventInitial = () => {
  const initial = emptyMomentInitial();
  initial.events.push({
    value: "ev-1",
    label: "Spring Pop-Up",
    sublabel: "Austin, TX",
    image_url: null,
    origin: "where",
    occurrence: { id: "occ-1", event_id: "ev-1", start_at: "2026-05-02T18:00:00Z", end_at: null, timezone: "America/Chicago", location_id: null },
  });
  initial.title = "Spring Pop-Up";
  initial.entryDate = "2026-05-02";
  initial.entryTime = "13:00";
  return initial;
};
const mentions = (text) => container.textContent.split(text).length - 1;

function assertNoServerTouch(label = "") {
  assert.deepEqual(calls, [], `no server action ran ${label}`);
  assert.deepEqual(uploads, [], `no Storage upload ran ${label}`);
}

beforeEach(async () => {
  await unmount();
  window.localStorage.clear();
  resetFakeIndexedDb();
  calls.length = 0;
  uploads.length = 0;
  pushes.length = 0;
  counters.entries = 0;
});
after(unmount);

// ── text + date ──────────────────────────────────────────────────────────

test("1-2. a guest draft is created automatically while composing — no Save/Publish needed — and never reaches the server", async () => {
  await load();
  assert.equal(storedDraft(), null, "opening the composer alone creates nothing");
  await goStage("Your Moment");
  await type(titleInput(), "Saturday At The Market");
  const draft = storedDraft();
  assert.ok(draft, "first meaningful edit creates the local draft");
  assert.equal(draft.title, "Saturday At The Market");
  assertNoServerTouch("while typing");
});

test("3-5. title, story and date/time survive a reload on a plain /new entry — restored automatically, no prompt", async () => {
  await load();
  await goStage("Your Moment");
  await type(titleInput(), "Rain Day Browsing");
  await type(notesInput(), "Found a little ceramic cup.");
  await type(dateInput(), "2026-04-11");
  await load(); // reload
  assert.equal(titleInput().value, "Rain Day Browsing");
  assert.equal(notesInput().value, "Found a little ceramic cup.");
  assert.equal(dateInput().value, "2026-04-11");
  assert.equal(document.body.textContent.includes("Continue Your Draft?"), false, "a guest's own reload restores directly");
  assertNoServerTouch("after reload");
});

// ── Event-connected entry (the real Production failure) ─────────────────

test("6-7. Event-connected entry: typed content survives a reload to the same ?event= URL, and the Event prefill neither erases it nor duplicates the Event", async () => {
  await load({ initial: eventInitial() });
  await goStage("Your Moment");
  await type(titleInput(), "My Spring Day");
  await type(notesInput(), "Bring snacks next time.");
  await load({ initial: eventInitial() }); // reload of the very same URL
  assert.equal(titleInput().value, "My Spring Day", "the user's title wins over the Event's auto title");
  assert.equal(notesInput().value, "Bring snacks next time.");
  assert.equal(mentions("Spring Pop-Up"), 1, "the Event appears exactly once");
  assertNoServerTouch();
});

test("an Event prefill alone is not a draft: nothing is stored until the guest actually edits", async () => {
  await load({ initial: eventInitial() });
  assert.equal(storedDraft(), null);
  await load({ initial: eventInitial() });
  assert.equal(storedDraft(), null);
  assert.equal(titleInput().value, "Spring Pop-Up", "the prefill is still shown");
});

// UX consolidation: a generic draft opened into a DIFFERENT (Event) context
// is never silently merged — the guest is asked first ("switch").
test("a Moment in progress meets a different Event context: ask first; the stored draft is untouched; Continue Moment restores it with its OWN context", async () => {
  await load();
  await goStage("Your Moment");
  await type(titleInput(), "Earlier Story");
  await type(notesInput(), "Written before opening the Event link.");
  const before = window.localStorage.getItem(DRAFT_KEY);
  const draftId = storedDraft().draftId;
  await load({ initial: eventInitial() });
  assert.ok(document.body.textContent.includes("You Have A Moment In Progress"), "the guest is asked");
  assert.ok(document.body.textContent.includes("Continue your unfinished Moment?"), "a context-free draft has no context label");
  assert.equal(window.localStorage.getItem(DRAFT_KEY), before, "untouched while the choice is pending");
  await click(buttons("Continue Moment", document.body)[0]);
  await settle();
  assert.equal(document.body.textContent.includes("You Have A Moment In Progress"), false);
  await goStage("Your Moment");
  assert.equal(titleInput().value, "Earlier Story");
  assert.equal(notesInput().value, "Written before opening the Event link.");
  assert.equal(mentions("Spring Pop-Up"), 0, "the newly opened Event is not mixed in");
  assert.equal(storedDraft().draftId, draftId, "the same draft");
  assert.deepEqual(storedDraft().events, [], "no Event merged into the stored draft");
  assertNoServerTouch();
});

test("Start A New Moment: the page's Event prefill is shown; the old draft and its photos stay stored until the new Moment is actually begun", async () => {
  await load();
  await goStage("Photos");
  await addPhotos(png("earlier.png", [4]));
  await goStage("Your Moment");
  await type(titleInput(), "Earlier Story");
  const before = window.localStorage.getItem(DRAFT_KEY);
  const old = storedDraft();
  assert.equal(storedMediaKeys().length, 1);

  await load({ initial: eventInitial() });
  await click(buttons("Start A New Moment", document.body)[0]);
  await settle();
  assert.equal(document.body.textContent.includes("You Have A Moment In Progress"), false);
  assert.equal(titleInput().value, "Spring Pop-Up", "a clean composer with the Event's prefill");
  assert.equal(window.localStorage.getItem(DRAFT_KEY), before, "choosing alone does not replace the stored draft");
  assert.deepEqual(storedMediaKeys(), old.media.map((m) => m.localId), "nor release its photos");

  // Leaving before editing loses nothing: the old Moment is still offered.
  await load({ initial: eventInitial() });
  assert.ok(document.body.textContent.includes("You Have A Moment In Progress"), "still in progress after a reload");
  assert.equal(window.localStorage.getItem(DRAFT_KEY), before);
  await click(buttons("Start A New Moment", document.body)[0]);
  await settle();

  // The first real edit begins the new Moment: it takes the device's one slot.
  await goStage("Your Moment");
  await type(notesInput(), "A brand new story.");
  await settle();
  const next = storedDraft();
  assert.notEqual(next.draftId, old.draftId, "a new draft replaced the old one");
  assert.equal(next.title, "Spring Pop-Up");
  assert.equal(next.notes, "A brand new story.");
  assert.deepEqual(next.events.map((e) => e.value), ["ev-1"]);
  assert.deepEqual(next.media, []);
  assert.deepEqual(storedMediaKeys(), [], "the old draft's photos are released only now");
  assertNoServerTouch();
});

test("8-10 + 6. a selected Event, Location, Business and Product all survive a reload", async () => {
  const initial = eventInitial();
  initial.location = { value: "loc-1", label: "Cedar Street Market", sublabel: "Austin, TX", image_url: null };
  initial.businesses.push({ value: "biz-1", label: "Little Saints Co", image_url: null });
  initial.products.push({ value: "prod-1", label: "Glazed Mug", sublabel: "Little Saints Co", image_url: null });
  await load({ initial });
  await goStage("Your Moment");
  await type(notesInput(), "Great stall.");
  await load(); // reload on the plain /new URL — context must come from the draft
  for (const label of ["Spring Pop-Up", "Cedar Street Market", "Little Saints Co", "Glazed Mug"]) {
    assert.ok(container.textContent.includes(label), `${label} restored`);
  }
  assertNoServerTouch();
});

// ── photos ───────────────────────────────────────────────────────────────

test("11-16. photos: Blobs go to IndexedDB under the draft's localIds; order, cover and caption survive a reload; previews are rebuilt", async () => {
  await load();
  await goStage("Photos");
  await addPhotos(png("first.png", [1]), png("second.png", [2, 2]));
  assert.equal(thumbs(), 2);
  const draft = storedDraft();
  assert.equal(draft.media.length, 2, "photo metadata persisted");
  assert.deepEqual([...storedMediaKeys()].sort(), draft.media.map((m) => m.localId).sort(), "IndexedDB keys == draft localIds");
  assert.equal(JSON.stringify(draft).includes("data:image"), false, "no base64 photo in localStorage");
  assertNoServerTouch("after selecting photos");

  await menuAction(1, "Move Earlier"); // second photo becomes first
  await menuAction(1, "Make Cover"); // the original first photo (now second) becomes the explicit cover
  await addNote(0, "Second photo note");
  const before = storedDraft().media;
  assert.deepEqual(before.map((m) => m.isCover), [false, true]);
  assert.deepEqual(before.map((m) => m.caption), ["Second photo note", null]);

  await load(); // reload
  await goStage("Photos");
  assert.equal(thumbs(), 2, "both photos come back");
  assert.ok(thumbSrcs().every((s) => s.startsWith("blob:")), "previews are rebuilt from the stored Blobs");
  const after = storedDraft().media;
  assert.deepEqual(after.map((m) => m.localId), before.map((m) => m.localId), "order survives");
  assert.deepEqual(after.map((m) => m.isCover), [false, true], "cover survives");
  assert.deepEqual(after.map((m) => m.caption), ["Second photo note", null], "caption survives");
  assertNoServerTouch("after reload");
});

test("a photo whose Blob is missing is dropped cleanly — the rest of the draft still restores", async () => {
  await load();
  await goStage("Photos");
  await addPhotos(png("a.png"), png("b.png", [9]));
  const [first] = storedDraft().media;
  fakeIndexedDbSnapshot(); // (keys inspected via snapshot)
  const { putGuestMomentMedia, deleteGuestMomentMedia } = await import("../src/lib/guest-moment-media-db.ts");
  void putGuestMomentMedia;
  await deleteGuestMomentMedia(first.localId);
  await load();
  await goStage("Photos");
  assert.equal(thumbs(), 1);
  assert.equal(storedDraft().media.length, 1, "the dangling reference is pruned from the draft");
});

// ── cleanup rules ────────────────────────────────────────────────────────

test("17-18. ordinary reloads and remounts never clear the draft or its media", async () => {
  await load();
  await goStage("Photos");
  await addPhotos(png("keep.png"));
  const id = storedDraft().draftId;
  for (let i = 0; i < 3; i++) await load();
  assert.equal(storedDraft().draftId, id, "same draft after repeated loads");
  assert.equal(storedMediaKeys().length, 1, "media untouched");
});

test("19. explicit Start Over clears the draft AND its media, and resets the composer", async () => {
  await load();
  await goStage("Photos");
  await addPhotos(png("gone.png"));
  await goStage("Your Moment");
  await type(titleInput(), "Discard Me");
  await load();
  await click(buttons("Start Over")[0]);
  await click(buttons("Clear Draft And Start Over", document.body)[0]);
  await settle();
  assert.equal(storedDraft(), null);
  assert.deepEqual(storedMediaKeys(), []);
  assert.equal(titleInput().value, "");
  assert.equal(thumbs(), 0);
  await load();
  assert.equal(titleInput().value, "", "still gone after a reload");
});

test("21. an expired draft is not restored and is purged together with its media", async () => {
  await load();
  await goStage("Photos");
  await addPhotos(png("old.png"));
  const raw = JSON.parse(window.localStorage.getItem(DRAFT_KEY));
  raw.updatedAt = Date.now() - 15 * 24 * 60 * 60 * 1000;
  raw.title = "Ancient";
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(raw));
  await load();
  assert.equal(titleInput().value, "", "stale draft not restored");
  assert.equal(window.localStorage.getItem(DRAFT_KEY), null, "stale draft purged");
  assert.deepEqual(storedMediaKeys(), [], "stale media purged");
});

// ── auth boundary + authenticated behavior ───────────────────────────────

test("guest Save & Publish asks for an account (contextual prompt), keeps the draft, and still touches no server", async () => {
  await load();
  await goStage("Your Moment");
  await type(titleInput(), "Ready To Save");
  await click(buttons("Save & Publish")[0]);
  assert.ok(document.body.textContent.includes("Your Moment Is Ready"));
  assert.equal(storedDraft().intendedAction, "publish");
  assertNoServerTouch("at the auth boundary");
});

test("23. a signed-in composer never writes a guest draft; a stored guest draft is OFFERED, never silently converted", async () => {
  await load({ authed: true });
  await goStage("Your Moment");
  await type(titleInput(), "Signed In Typing");
  assert.equal(window.localStorage.getItem(DRAFT_KEY), null, "authenticated composing does not use guest storage");

  window.localStorage.clear();
  await load();
  await goStage("Your Moment");
  await type(titleInput(), "Left Over From Before Sign Up");
  const before = window.localStorage.getItem(DRAFT_KEY);
  calls.length = 0;
  await load({ authed: true }); // signed in, but not via the resume round-trip
  assert.ok(document.body.textContent.includes("Continue Your Draft?"));
  assert.equal(window.localStorage.getItem(DRAFT_KEY), before, "untouched while the choice is pending");
  assert.deepEqual(calls, [], "nothing converted without a choice");
});

test("20, 14. authenticated resume converts exactly ONE Moment, uploads through the real pipeline, clears draft + media; a re-entry cannot create a duplicate", async () => {
  await load();
  await goStage("Photos");
  await addPhotos(png("p1.png", [1]), png("p2.png", [2]));
  await goStage("Your Moment");
  await type(titleInput(), "Converted Moment");
  await type(notesInput(), "Story text");
  await click(buttons("Save & Publish")[0]);
  assertNoServerTouch("before sign-in");

  await load({ authed: true, resume: true });
  await settle(14);
  const count = (n) => calls.filter((c) => c === n).length;
  assert.equal(count("startJournalDraft"), 1, "exactly one Moment created");
  assert.equal(count("publishJournalEntry"), 1);
  assert.equal(count("finalizeJournalPhotoBatch") >= 1, true, "photos went through the authenticated upload pipeline");
  assert.equal(uploads.length, 2, "each photo uploaded once, only now");
  assert.equal(window.localStorage.getItem(DRAFT_KEY), null, "draft cleared after success");
  assert.deepEqual(storedMediaKeys(), [], "media cleared after success");
  assert.deepEqual(pushes, ["/journal/entry-1"]);

  const created = counters.entries;
  await load({ authed: true, resume: true }); // refresh / re-entry
  await settle(6);
  assert.equal(counters.entries, created, "no second Moment on re-entry");
});
