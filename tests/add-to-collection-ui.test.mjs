// One "Add to Collection" control (components/EntityPersonalActions.tsx):
// the type's built-in lists + Collections in one sheet; signed out it saves
// on this device (lib/guest-library.ts) with one dismissible reminder.
// The REAL component in jsdom (fetch stubbed).
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
  "next/navigation": "export const usePathname = () => globalThis.__path ?? '/location/duffy-square'; export const useRouter = () => ({ push(){}, refresh(){} });",
};
registerHooks({
  resolve(specifier, context, next) {
    if (STUBS[specifier] !== undefined) return js(STUBS[specifier]);
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

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://findmi.test/location/duffy-square", pretendToBeVisual: true });
const saved = {};
for (const k of ["window", "document", "navigator", "HTMLElement", "Node", "localStorage"]) saved[k] = globalThis[k];
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
after(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete globalThis[k];
  dom.window.close();
});
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { default: EntityPersonalActions } = await import("../src/components/EntityPersonalActions.tsx");
const G = await import("../src/lib/guest-library.ts");

const LOC = "00000000-0000-4000-8000-000000000042";
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
const btn = (root, text) => [...root.querySelectorAll("button, a")].find((b) => b.textContent.replace(/\s+/g, " ").trim() === text);

async function mount({ signedIn = false, relations = [], collections = [] } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    const u = String(url);
    if (u.startsWith("/api/collections")) return { ok: true, json: async () => ({ signedIn, available: signedIn, collections }) };
    if (u.startsWith("/api/relationships")) return { ok: true, json: async () => (init?.method === "POST" ? { ok: true } : { signedIn, relations }) };
    return { ok: false, json: async () => ({}) };
  };
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(EntityPersonalActions, { entityType: "location", entityId: LOC, entityName: "Duffy Square" })));
  await settle();
  return { host, root, calls };
}

test("one control replaces the standalone status buttons: no Want To Go / Been Here buttons on the page itself", async () => {
  window.localStorage.clear();
  const { host, root } = await mount();
  const labels = [...host.querySelectorAll("button")].map((b) => b.textContent.trim());
  assert.deepEqual(labels, ["+ Add to Collection"]);
  root.unmount();
});

test("signed out: lists and a new Collection save on this device — no sign-in wall; the button shows it's saved", async () => {
  window.localStorage.clear();
  const { host, root, calls } = await mount();
  await act(async () => btn(host, "+ Add to Collection").click());
  const sheet = document.querySelector('[role="dialog"]');
  assert.ok(sheet, "the sheet opens (not a redirect to /login)");
  assert.deepEqual([...sheet.querySelectorAll('[aria-label="Your Lists"] button')].map((b) => b.textContent), ["Want To Go", "Must Do", "Been Here"]);
  await act(async () => btn(sheet, "Want To Go").click());
  assert.equal(btn(sheet, "Want To Go").getAttribute("aria-pressed"), "true");
  await act(async () => btn(sheet, "+ New Collection").click());
  const input = sheet.querySelector('input[aria-label="New Collection name"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "Date Night");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () => sheet.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  const stored = G.parseGuestLibrary(window.localStorage.getItem(G.GUEST_LIBRARY_KEY));
  assert.deepEqual(stored.relations.map((r) => `${r.type}:${r.relation}:${r.name}:${r.href}`), [`location:want:Duffy Square:/location/duffy-square`]);
  assert.deepEqual(stored.collections.map((c) => `${c.name}:${c.items.length}`), ["Date Night:1"]);
  assert.match(sheet.textContent, /Saved on this device/);
  assert.equal(calls.filter((c) => c.body).length, 0, "nothing sent to the server while signed out");
  assert.ok(btn(host, "✓ In Your Collections"), "the page's one control shows it's saved");
  root.unmount();
});

test("after three saves: one dismissible reminder to create an account; saving continues without prompts", async () => {
  window.localStorage.clear();
  const { host, root } = await mount();
  await act(async () => btn(host, "+ Add to Collection").click());
  const sheet = () => document.querySelector('[role="dialog"]');
  await act(async () => btn(sheet(), "Want To Go").click());
  await act(async () => btn(sheet(), "Must Do").click());
  assert.equal(sheet().querySelector("[data-guest-reminder]"), null, "not after two");
  await act(async () => btn(sheet(), "Been Here").click());
  const reminder = sheet().querySelector("[data-guest-reminder]");
  assert.ok(reminder, "after the third save");
  assert.match(reminder.querySelector("a").getAttribute("href"), /^\/signup\?next=%2Flocation%2Fduffy-square$/);
  await act(async () => btn(reminder, "Not Now").click());
  assert.equal(sheet().querySelector("[data-guest-reminder]"), null);
  await act(async () => btn(sheet(), "Been Here").click());
  await act(async () => btn(sheet(), "Been Here").click());
  assert.equal(sheet().querySelector("[data-guest-reminder]"), null, "never again once dismissed");
  root.unmount();
});

test("private browsing / storage blocked: saves still work for the visit and the sheet says they won't be kept", async () => {
  window.localStorage.clear();
  G.clearGuestLibrary(); // a fresh page: no in-memory copy from an earlier test
  const desc = Object.getOwnPropertyDescriptor(dom.window, "localStorage");
  Object.defineProperty(dom.window, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
  try {
    const { host, root } = await mount();
    await act(async () => btn(host, "+ Add to Collection").click());
    const sheet = document.querySelector('[role="dialog"]');
    assert.match(sheet.textContent, /isn’t keeping saves/);
    await act(async () => btn(sheet, "Want To Go").click());
    assert.equal(btn(sheet, "Want To Go").getAttribute("aria-pressed"), "true", "kept in memory for this visit");
    root.unmount();
  } finally {
    Object.defineProperty(dom.window, "localStorage", desc);
  }
});

test("signed in: existing records are read from the account; a list toggle writes only the relationship; Collections use the account picker", async () => {
  window.localStorage.clear();
  const { host, root, calls } = await mount({ signedIn: true, relations: ["been"], collections: [{ id: "c1", name: "Favorites", itemCount: 3, contains: false }] });
  assert.ok(btn(host, "✓ In Your Collections"), "an existing Been Here shows as saved");
  await act(async () => btn(host, "✓ In Your Collections").click());
  await settle();
  const sheet = document.querySelector('[role="dialog"]');
  assert.equal(btn(sheet, "Been Here").getAttribute("aria-pressed"), "true", "existing status value preserved");
  await act(async () => btn(sheet, "Must Do").click());
  const post = calls.find((c) => c.url === "/api/relationships" && c.body);
  assert.deepEqual(post.body, { entityType: "location", entityId: LOC, relation: "must_do", on: true });
  assert.ok(btn(sheet, "Favorites"), "the account's own Collections");
  assert.equal(window.localStorage.getItem(G.GUEST_LIBRARY_KEY), null, "nothing written to guest storage when signed in");
  root.unmount();
});
