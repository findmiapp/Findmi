// Pass A — Navigation Shell. The REAL HamburgerMenu and NavDesktop are
// mounted with react-dom in jsdom for each viewer state (signed out,
// signed in, Business manager with one / several Businesses, Admin) and
// their rendered sections are asserted. Only framework edges are stubbed
// (next/link → <a>, next/navigation pathname, Search/Cart/Create/Logo →
// null, the signOut Server Action). Source guards pin the Admin toolbar
// mounting and the shared offset token.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
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
const isFile = (f) => existsSync(f) && statSync(f).isFile();
const withExt = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(isFile);
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
const NAVLIB = await import("../src/lib/navigation.ts");
const DEFAULT_ITEMS = NAVLIB.FALLBACK_NAV_ITEMS;
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
  await render(h(HamburgerMenu, { items: DEFAULT_ITEMS, ...props }), pathname);
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
  await render(h(NavDesktop, { navItems: DEFAULT_ITEMS, authenticated: false, isAdmin: false, businesses: [] }), "/events");
  const nav = document.querySelector('nav[aria-label="Discover"]');
  assert.deepEqual([...nav.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]), DISCOVER);
  assert.equal(nav.querySelector('a[aria-current="page"]').textContent, "Events");
  const header = document.querySelector("header").textContent;
  assert.doesNotMatch(header, /My Moments|Add Moment/);
  assert.equal(count(header, "Log In"), 1);
  assert.equal(count(header, "Join For Free"), 1);
});

test("desktop, signed in: the account menu holds Your Findmi, Manage, Admin and Sign Out", async () => {
  await render(h(NavDesktop, { navItems: DEFAULT_ITEMS, authenticated: true, isAdmin: true, businesses: [{ id: "b1", name: "FUJIFILM" }] }), "/");
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

// ── Admin → Site → Navigation drives the public discovery menu ───────────
// Rows go through the SAME pipeline as (public)/layout.tsx:
// resolveNavTree → filterNavItemsForAudience → publicDiscoveryNav.
let seq = 0;
const row = (o) => ({
  id: o.id ?? `r${++seq}`,
  label: o.label,
  destination_type: o.custom ? "custom" : "route",
  route_key: o.route ?? null,
  custom_href: o.custom ?? null,
  group_label: null,
  icon_key: o.icon ?? null,
  is_visible: o.visible ?? true,
  is_highlight: o.highlight ?? false,
  sort_order: o.sort ?? 0,
  parent_id: o.parent ?? null,
  audience: o.audience ?? "everyone",
});
const pipeline = (rows, authenticated) =>
  NAVLIB.publicDiscoveryNav(NAVLIB.filterNavItemsForAudience(NAVLIB.resolveNavTree([...rows].sort((a, b) => a.sort_order - b.sort_order)), authenticated));
const APPROVED = [
  row({ id: "d", label: "Discover", route: "discover", sort: 10 }),
  row({ id: "e", label: "Events", route: "events", sort: 20 }),
  row({ id: "p", label: "Places", route: "locations", sort: 30 }),
  row({ id: "b", label: "Brands", route: "businesses", sort: 40 }),
  row({ id: "m", label: "Moments", route: "moments", sort: 50 }),
];
async function desktopLinks(rows, { authenticated = false, pathname = "/" } = {}) {
  await render(h(NavDesktop, { navItems: pipeline(rows, authenticated), authenticated, isAdmin: false, businesses: [] }), pathname);
  const nav = document.querySelector('nav[aria-label="Discover"]');
  return [...nav.children].map((el) => el.querySelector("button")?.textContent.trim() ?? [el.textContent, el.getAttribute("href")]);
}
async function drawerDiscover(rows, authenticated = false) {
  const { sections } = await openDrawer({ items: pipeline(rows, authenticated), authenticated });
  return sections.find((s) => s.title === "Discover");
}

test("Admin rows (the approved IA) render in the desktop bar and the drawer", async () => {
  assert.deepEqual(await desktopLinks(APPROVED), DISCOVER);
  assert.deepEqual((await drawerDiscover(APPROVED)).links, DISCOVER);
});

test("Admin edits: rename, reorder and hide change the rendered menu", async () => {
  const edited = APPROVED.map((r) => (r.id === "p" ? { ...r, label: "Spots", sort_order: 5 } : r.id === "m" ? { ...r, is_visible: false } : r));
  const expected = [["Spots", "/locations"], ["Discover", "/discover"], ["Events", "/events"], ["Brands", "/businesses"]];
  assert.deepEqual(await desktopLinks(edited), expected);
  assert.deepEqual((await drawerDiscover(edited)).links, expected);
});

test("Admin edits: audience — a Signed In Only row shows only to signed-in visitors", async () => {
  const rows = [...APPROVED, row({ label: "Members", custom: "/members", sort: 60, audience: "logged_in" })];
  assert.ok(!(await drawerDiscover(rows, false)).links.some(([l]) => l === "Members"));
  assert.ok((await drawerDiscover(rows, true)).links.some(([l]) => l === "Members"));
});

test("Admin edits: nesting, highlight, icon and custom links", async () => {
  const rows = [
    row({ id: "g", label: "Explore", sort: 10, icon: "compass" }),
    row({ label: "Pop-Ups", custom: "/events?format=pop-up", parent: "g", sort: 1 }),
    row({ label: "Guide", custom: "https://guide.example.com", parent: "g", sort: 2 }),
    row({ label: "Tonight", custom: "/events?when=today", sort: 20, highlight: true }),
  ];
  assert.deepEqual(await desktopLinks(rows), ["Explore", ["Tonight", "/events?when=today"]]);
  assert.match(document.querySelector('nav[aria-label="Discover"] a').className, /bg-findmi text-white/, "highlight");
  await click(document.querySelector('nav[aria-label="Discover"] button'));
  const menu = [...document.querySelectorAll('[role="menu"] a')].map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("target")]);
  assert.deepEqual(menu, [["Pop-Ups", "/events?format=pop-up", null], ["Guide", "https://guide.example.com", "_blank"]]);
  const { drawer } = await openDrawer({ items: pipeline(rows, false), authenticated: false });
  const group = [...drawer.querySelectorAll("button[aria-expanded]")].find((b) => b.textContent.includes("Explore"));
  assert.ok(group.querySelector("svg"), "icon rendered");
  await click(group);
  assert.ok([...drawer.querySelectorAll("a")].some((a) => a.textContent === "Pop-Ups"), "group expands to its children");
});

test("reserved account/auth rows never render — no duplicate Log In, Join or account links", async () => {
  // Shaped like the live rows: account groups, auth links, Saved, Profile.
  const rows = [
    ...APPROVED,
    row({ id: "yf", label: "Your Findmi", sort: 1, audience: "logged_in" }),
    row({ label: "Account", custom: "/account", parent: "yf", audience: "logged_in" }),
    row({ label: "Messages", custom: "/account/messages", parent: "yf", audience: "logged_in" }),
    row({ label: "Saved", route: "saved", sort: 2 }),
    row({ label: "Log In", custom: "/login", sort: 990, audience: "logged_out" }),
    row({ label: "Join For Free", route: "join", sort: 999, highlight: true, audience: "logged_out" }),
    row({ label: "Profile", custom: "/account/profile", sort: 995, audience: "logged_in" }),
  ];
  for (const authenticated of [false, true]) {
    assert.deepEqual(await desktopLinks(rows, { authenticated }), DISCOVER, `authenticated=${authenticated}`);
    const header = document.querySelector("header").textContent;
    assert.ok(header.split("Log In").length - 1 <= 1 && header.split("Join For Free").length - 1 <= 1);
    const { text } = await openDrawer({ items: pipeline(rows, authenticated), authenticated });
    assert.equal(text.split("Log In").length - 1, authenticated ? 0 : 1);
    assert.equal(text.split("Account").length - 1, authenticated ? 1 : 0, "Account appears once, in Your Findmi");
  }
});

test("more than five top-level items: extras move into More ▾ — no horizontal scrolling", async () => {
  const rows = [...APPROVED, row({ label: "Marketplace", route: "marketplace", sort: 60 }), row({ label: "About", route: "about", sort: 70 })];
  const bar = await desktopLinks(rows);
  assert.equal(bar.length, 5);
  assert.deepEqual(bar.slice(0, 4), DISCOVER.slice(0, 4));
  assert.equal(bar[4], "More");
  await click([...document.querySelectorAll('nav[aria-label="Discover"] button')].find((b) => b.textContent.includes("More")));
  assert.deepEqual([...document.querySelectorAll('[role="menu"] a')].map((a) => a.textContent), ["Moments", "Marketplace", "About"]);
  assert.doesNotMatch(document.querySelector('nav[aria-label="Discover"]').className, /overflow-x/);
});

test("desktop budget: long labels move into More by width, not just by count", async () => {
  const long = ["Neighbourhoods", "Things To Do!!", "Local Makers XL"].map((label, i) => row({ label: label.slice(0, 14), custom: `/x${i}`, sort: i }));
  const { bar, more } = NAVLIB.splitDesktopNav(pipeline(long, false));
  assert.deepEqual(bar.map((i) => i.label), ["Neighbourhoods", "Things To Do!!"]);
  assert.deepEqual(more.map((i) => i.label), ["Local Makers X"]);
  const used = bar.reduce((n, i) => n + i.label.length + (i.children.length ? 2 : 0), 0);
  assert.ok(used + 6 <= NAVLIB.DESKTOP_NAV_CHAR_BUDGET && bar.length + 1 <= NAVLIB.DESKTOP_NAV_MAX_ITEMS);
  const approvedChars = pipeline(APPROVED, false).reduce((n, i) => n + i.label.length, 0);
  assert.ok(approvedChars <= NAVLIB.DESKTOP_NAV_CHAR_BUDGET, "the approved IA fits without More");
  const page = readFileSync("src/app/admin/(protected)/site/navigation/page.tsx", "utf8");
  assert.match(page, /splitDesktopNav\(publicDiscoveryNav\(filterNavItemsForAudience\(resolveNavTree\(items\), i === 1\)\)\)/, "Admin warns with the same pipeline");
});

test("no visible rows → the approved default IA", async () => {
  assert.deepEqual(await desktopLinks([]), DISCOVER);
  assert.deepEqual(await desktopLinks(APPROVED.map((r) => ({ ...r, is_visible: false }))), DISCOVER);
});

test("Admin editor: reserved rows are flagged read-only; saves reject reserved destinations and over-long top-level labels", () => {
  const rows = [
    row({ id: "yf", label: "Your Findmi" }),
    row({ id: "acc", label: "Account", custom: "/account", parent: "yf" }),
    row({ id: "li", label: "Log In", custom: "/login" }),
    row({ id: "ev", label: "Events", route: "events" }),
  ];
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(NAVLIB.navRowPublicStatus(byId.acc, rows).reservedBy, "the account menu");
  assert.equal(NAVLIB.navRowPublicStatus(byId.li, rows).reservedBy, "the Log In button");
  assert.equal(NAVLIB.navRowPublicStatus(byId.yf, rows).hiddenGroup, true);
  assert.deepEqual(NAVLIB.navRowPublicStatus(byId.ev, rows), { reservedBy: null, hiddenGroup: false });
  assert.equal(NAVLIB.reservedNavOwner("https://example.com/account"), null, "external links are never reserved");
  const card = readFileSync("src/components/admin/NavItemCard.tsx", "utf8");
  assert.match(card, /<fieldset disabled=\{reserved\} className="contents">/);
  assert.match(card, /\{!reserved && \(\s*<button\s+type="submit"/);
  const actions = readFileSync("src/app/admin/(protected)/site/navigation/actions.ts", "utf8");
  assert.match(actions, /const reservedBy = reservedNavOwner\(destination\);\s*if \(reservedBy\) return \{ error:/);
  assert.match(actions, /if \(!parent_id && label\.length > NAV_TOP_LABEL_MAX\)/);
  const page = readFileSync("src/app/admin/(protected)/site/navigation/page.tsx", "utf8");
  assert.match(page, /publicStatus=\{navRowPublicStatus\(item, items\)\}/);
  assert.match(page, /PUBLIC_ROUTES\.filter\(\(r\) => !reservedNavOwner\(r\.path\) \|\| r\.key === item\.route_key\)/);
});

test("the public layout feeds nav_items through audience + reserved filtering", () => {
  const layout = readFileSync("src/app/(public)/layout.tsx", "utf8");
  assert.match(layout, /const allNavItems = await getVisibleNavItems\(\);/);
  assert.match(layout, /publicDiscoveryNav\(filterNavItemsForAudience\(allNavItems, authenticated\)\)/);
  assert.match(layout, /<MobileHeader navItems=\{navItems\}/);
  assert.match(layout, /<NavDesktop navItems=\{navItems\}/);
});
