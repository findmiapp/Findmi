// Pass A — Navigation Shell. The REAL HamburgerMenu and NavDesktop are
// mounted with react-dom in jsdom for each viewer state (signed out,
// signed in, Business manager with one / several Businesses, Admin) and
// their rendered sections are asserted. Only framework edges are stubbed
// (next/link → <a>, next/navigation pathname, Search/Cart/Create/Logo →
// null, the signOut Server Action). Source guards pin the Admin toolbar
// mounting and the shared offset token.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");
const { JSDOM } = require("jsdom");

const ROOT = process.cwd();
const FIX = resolvePath(ROOT, "tests/fixtures/nav-shell");
const NULL = `${FIX}/null-component.mjs`;
const STUBS = {
  "next/link": `${FIX}/next-link.mjs`,
  "next/navigation": `${FIX}/next-navigation.mjs`,
  "@/app/(public)/account/profile/actions": NULL,
  "./CartBadge": NULL,
  "./HeaderSearch": NULL,
  "./QuickCreateMenu": NULL,
  "./Logo": NULL,
  "./DrawerSearch": NULL,
};
const withExt = (base) => [base, `${base}.ts`, `${base}.tsx`].find((f) => existsSync(f));
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
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Element", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key] ?? dom.window, configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const NAV = await import("next/navigation");
const { default: HamburgerMenu } = await import("../src/components/HamburgerMenu.tsx");
const { default: NavDesktop } = await import("../src/components/NavDesktop.tsx");
const h = React.createElement;

let root;
async function render(el, pathname = "/") {
  NAV.state.pathname = pathname;
  if (root) await act(async () => root.unmount());
  document.body.innerHTML = "<div id=app></div>";
  root = createRoot(document.getElementById("app"));
  await act(async () => root.render(el));
}
after(async () => act(async () => root?.unmount()));
const click = (el) => act(async () => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));

async function openDrawer(props, pathname) {
  await render(h(HamburgerMenu, props), pathname);
  await click(document.querySelector('button[aria-label="Menu"]'));
  const drawer = document.querySelector('[role="dialog"][aria-label="Menu"]');
  const sections = [...drawer.querySelectorAll("section")].map((s) => ({
    title: s.querySelector("h2").textContent,
    links: [...s.querySelectorAll("a")].map((a) => [a.textContent.trim(), a.getAttribute("href")]),
  }));
  const text = drawer.textContent;
  return { sections, text, drawer };
}
const titles = (sections) => sections.map((s) => s.title);
const count = (text, needle) => text.split(needle).length - 1;
const DISCOVER = [["Discover", "/discover"], ["Events", "/events"], ["Places", "/locations"], ["Brands", "/businesses"], ["Moments", "/moments"]];

test("mobile, signed out: Search, DISCOVER, FOR BUSINESS, one Log In / Join For Free", async () => {
  const { sections, text } = await openDrawer({ authenticated: false });
  assert.deepEqual(titles(sections), ["Discover", "For Business"]);
  assert.deepEqual(sections[0].links, DISCOVER);
  assert.deepEqual(sections[1].links, [["Findmi For Business", "/join/business"]]);
  assert.equal(count(text, "Log In"), 1);
  assert.equal(count(text, "Join For Free"), 1);
  assert.doesNotMatch(text, /Sign Out|Your Findmi|Manage|Admin/);
});

test("mobile, signed in: DISCOVER first, then YOUR FINDMI; one Sign Out; no login actions", async () => {
  const { sections, text } = await openDrawer({ authenticated: true, businesses: [] });
  assert.deepEqual(titles(sections), ["Discover", "Your Findmi"]);
  assert.deepEqual(sections[1].links.map(([l]) => l), ["My World", "Saved", "My Moments", "Add Moment", "Messages", "Account"]);
  assert.equal(count(text, "Sign Out"), 1);
  assert.doesNotMatch(text, /Log In|Join For Free|For Business/);
});

test("mobile, Business manager: one compact MANAGE entry — never a list of Businesses", async () => {
  let { sections } = await openDrawer({ authenticated: true, businesses: [{ id: "b1", name: "FUJIFILM" }] });
  assert.deepEqual(titles(sections), ["Discover", "Your Findmi", "Manage"]);
  assert.deepEqual(sections[2].links, [["FUJIFILM", "/account/business/b1"]]);
  ({ sections } = await openDrawer({ authenticated: true, businesses: [{ id: "b1", name: "A" }, { id: "b2", name: "B" }, { id: "b3", name: "C" }] }));
  assert.deepEqual(sections[2].links, [["Manage Businesses (3)", "/account/business"]], "the existing chooser, one row");
});

test("mobile, Admin: one Admin entry after the personal sections", async () => {
  const { sections, text } = await openDrawer({ authenticated: true, isAdmin: true, businesses: [{ id: "b1", name: "X" }] });
  assert.deepEqual(titles(sections), ["Discover", "Your Findmi", "Manage", "Admin"]);
  assert.deepEqual(sections[3].links, [["Findmi Admin", "/admin"]]);
  assert.equal(count(text, "Sign Out"), 1);
});

test("mobile: the current destination is marked active", async () => {
  const { drawer } = await openDrawer({ authenticated: false }, "/location/fujikina-theater");
  assert.equal(drawer.querySelector('a[aria-current="page"]').textContent.trim(), "Places");
});

test("desktop: Discover · Events · Places · Brands · Moments; no My Moments/Add Moment in the bar", async () => {
  await render(h(NavDesktop, { authenticated: false, isAdmin: false, businesses: [] }), "/events");
  const nav = document.querySelector('nav[aria-label="Discover"]');
  assert.deepEqual([...nav.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]), DISCOVER);
  assert.equal(nav.querySelector('a[aria-current="page"]').textContent, "Events");
  const header = document.querySelector("header").textContent;
  assert.doesNotMatch(header, /My Moments|Add Moment/);
  assert.equal(count(header, "Log In"), 1);
  assert.equal(count(header, "Join For Free"), 1);
});

test("desktop, signed in: the account menu holds Your Findmi, Manage, Admin and Sign Out", async () => {
  await render(h(NavDesktop, { authenticated: true, isAdmin: true, businesses: [{ id: "b1", name: "FUJIFILM" }] }), "/");
  assert.doesNotMatch(document.querySelector("header").textContent, /Log In|Join For Free/);
  await click(document.querySelector('button[aria-label="Your Findmi"]'));
  const menu = document.querySelector('[role="menu"]');
  assert.deepEqual([...menu.querySelectorAll("a")].map((a) => a.textContent), ["My World", "Saved", "My Moments", "Messages", "Account", "FUJIFILM", "Findmi Admin"]);
  assert.equal(count(menu.textContent, "Sign Out"), 1);
  await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })));
  assert.equal(document.querySelector('[role="menu"]'), null, "Escape closes it");
});

// ── Admin toolbar mounting + the shared offset token ─────────────────────
test("Admin toolbar: one instance per shell (public, /account + auth screens, /admin)", () => {
  const chrome = readFileSync("src/components/SiteChrome.tsx", "utf8");
  assert.equal((chrome.match(/\{adminToolbar\}/g) ?? []).length, 2, "public + composer branches (fixed on mobile)");
  assert.equal((chrome.match(/\{adminToolbarStatic\}/g) ?? []).length, 2, "/account + auth screens (in flow)");
  assert.match(readFileSync("src/app/admin/(protected)/layout.tsx", "utf8"), /<AdminToolbar placement="static" \/>/);
  assert.doesNotMatch(readFileSync("src/components/OwnerHeader.tsx", "utf8"), /href="\/admin"/, "no duplicate Admin link in the account header");
  const toolbar = readFileSync("src/components/AdminToolbar.tsx", "utf8");
  assert.match(toolbar, /if \(!\(await isAdminSession\(\)\)\) return null;/);
});

test("Admin toolbar groups come from adminNavItems and point at real routes", async () => {
  const { ADMIN_TOOLBAR_GROUPS } = await import("../src/components/admin/adminNavItems.ts");
  assert.deepEqual(ADMIN_TOOLBAR_GROUPS.map((g) => g.label), ["Content", "Import", "Requests"]);
  for (const g of ADMIN_TOOLBAR_GROUPS) {
    assert.ok(g.items.length > 0, g.label);
    for (const item of g.items) assert.ok(existsSync(`src/app/admin/(protected)${item.href.replace(/^\/admin/, "")}/page.tsx`), item.href);
  }
  assert.deepEqual(ADMIN_TOOLBAR_GROUPS[1].items.map((i) => i.label), ["Import Events", "Import Locations", "Import Brands", "Import Appearances", "Convert To Events"]);
});

test("toolbar offsets use ONE token (--admin-bar-h), not scattered 1.75rem values", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /html:has\(#findmi-admin-bar\[data-placement="public"\]\) \{\s*--admin-bar-h: 1\.75rem;/);
  assert.match(readFileSync("src/components/MobileHeader.tsx", "utf8"), /top-\[var\(--admin-bar-h\)\]/);
  assert.match(readFileSync("src/components/SiteChrome.tsx", "utf8"), /pt-\[calc\(3\.5rem\+var\(--admin-bar-h\)\)\]/);
  for (const f of ["src/components/MobileHeader.tsx", "src/components/SiteChrome.tsx", "src/components/journal/JournalMomentGallery.tsx"]) {
    assert.doesNotMatch(readFileSync(f, "utf8").replace(/\/\/.*$/gm, ""), /1\.75rem|top-7\b/, f);
  }
});
