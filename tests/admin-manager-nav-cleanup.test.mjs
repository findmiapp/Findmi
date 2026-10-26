// Admin & Manager cleanup, Phase 1 — navigation/presentation only. Every
// route stays; this pins the regrouping and the shared Manager definitions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const NAV = await import("../src/components/admin/adminNavItems.ts");
const BIZ = await import("../src/app/(public)/account/business/[id]/v2/business-nav.ts");
const read = (p) => readFileSync(p, "utf8");
const B = "src/app/(public)/account/business/[id]";
const all = () => NAV.ADMIN_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => ({ ...i, section: s.key, group: g.label }))));
const sidebar = () => all().filter((i) => i.sidebar !== false);
const pageFor = (href) => existsSync(`src/app/admin/(protected)${href.replace(/^\/admin/, "")}/page.tsx`);

test("no destination is listed twice in the Admin rail (Markets & Areas included)", () => {
  const hrefs = sidebar().map((i) => i.href);
  assert.deepEqual(hrefs.filter((h, i) => hrefs.indexOf(h) !== i), []);
  assert.equal(hrefs.filter((h) => h === "/admin/markets").length, 1);
});

test("every Admin destination still points at a real page (nothing removed)", () => {
  for (const i of all()) assert.ok(pageFor(i.href), i.href);
});

test("Import: one hub entry; the five tools keep their routes and open under it", () => {
  const act = NAV.getAdminSection("activity").groups.find((g) => g.label === "Import");
  assert.ok(act);
  assert.deepEqual(sidebar().filter((i) => i.group === "Import").map((i) => i.href), ["/admin/import"]);
  assert.deepEqual(NAV.IMPORT_TOOLS.map((t) => t.href), ["/admin/events/import", "/admin/locations/import", "/admin/businesses/import", "/admin/appearances/import", "/admin/appearances/convert"]);
  for (const t of NAV.IMPORT_TOOLS) {
    assert.ok(pageFor(t.href), t.href);
    const r = NAV.resolveAdminRoute(t.href);
    assert.equal(r.item.href, "/admin/import", `${t.href} breadcrumbs resolve to the hub`);
    assert.equal(r.section, "activity");
  }
  assert.equal(NAV.resolveAdminRoute("/admin/events").item.href, "/admin/events", "Events itself is unaffected");
  assert.ok(pageFor("/admin/import"));
  assert.deepEqual(NAV.ADMIN_TOOLBAR_GROUPS.find((g) => g.key === "import").items.map((i) => i.label), ["Import Events", "Import Locations", "Import Brands", "Import Appearances", "Convert To Events"]);
  const hub = read("src/app/admin/(protected)/import/page.tsx");
  assert.match(hub, /IMPORT_TOOLS/);
});

test("Opportunities, Intelligence, Ideas and Activations sit together as one group", () => {
  const g = NAV.getAdminSection("activity").groups.find((x) => x.label === "Opportunities");
  assert.deepEqual(g.items.map((i) => i.href), ["/admin/opportunities", "/admin/opportunities/intelligence", "/admin/opportunities/ideas", "/admin/activations"]);
});

test("Communications / Inquiries / Sales Inquiries: one rail entry, all three still reachable and distinct", () => {
  const g = NAV.getAdminSection("requests").groups.find((x) => x.label === "Communications");
  assert.deepEqual(g.items.map((i) => i.href), ["/admin/conversations", "/admin/inquiries", "/admin/sales-inquiries", "/admin/commercial-inquiries" /* Commercial Inquiry v1 */]);
  assert.deepEqual(sidebar().filter((i) => i.group === "Communications").map((i) => i.href), ["/admin/conversations"]);
  assert.ok(g.items.every((i) => i.hub !== false), "all three stay listed on the Requests hub");
  for (const h of ["/admin/inquiries", "/admin/sales-inquiries", "/admin/commercial-inquiries"]) {
    assert.equal(NAV.resolveAdminRoute(`${h}/abc`).item.href === undefined, false);
    assert.equal(NAV.resolveAdminRoute(h).item.href, "/admin/conversations");
  }
  assert.ok(NAV.ADMIN_TOOLBAR_GROUPS.find((g2) => g2.key === "requests").items.some((i) => i.href === "/admin/inquiries"), "toolbar Requests menu unchanged");
});

test("Pro Access groups Pro Requests, Pro Invites and Plans; Legacy keeps Onboarding and Forms accessible", () => {
  const pro = NAV.getAdminSection("requests").groups.find((x) => x.label === "Pro Access");
  assert.deepEqual(pro.items.map((i) => i.href), ["/admin/pro-requests", "/admin/pro-invites", "/admin/plans"]);
  const legacy = NAV.getAdminSection("more").groups.find((x) => x.label === "Legacy");
  assert.deepEqual(legacy.items.map((i) => i.href), ["/admin/onboarding", "/admin/forms"]);
  assert.ok(legacy.items.every((i) => i.sidebar !== false && i.hub !== false));
  const toolbar = NAV.ADMIN_TOOLBAR_GROUPS.find((g) => g.key === "requests").items.map((i) => i.href);
  assert.ok(toolbar.includes("/admin/pro-requests") && !toolbar.includes("/admin/plans") && !toolbar.includes("/admin/pro-invites"));
  assert.match(read("src/app/admin/(protected)/requests/page.tsx"), /badges\["\/admin\/pro-requests"\]/, "Pro Requests pending badge preserved");
});

test("Homepage Bulletins sits with Site Editor; Discovery labels are clearer; the routes are unchanged", () => {
  assert.ok(!all().some((i) => i.href === "/admin/bulletins"));
  const r = NAV.resolveAdminRoute("/admin/bulletins");
  assert.equal(r.section, "more");
  assert.equal(r.item.href, "/admin/site");
  assert.ok(pageFor("/admin/bulletins"));
  const site = read("src/app/admin/(protected)/site/page.tsx");
  assert.match(site, /label: "Homepage Bulletins", href: "\/admin\/bulletins"/);
  assert.match(site, /label: "Discovery Pages", href: "\/admin\/site\/pages"/);
  assert.match(site, /label: "Topics & Lanes", href: "\/admin\/site\/discovery"/);
  assert.doesNotMatch(site, /Phase 1|Topics \+ Lanes/);
});

test("Manager: one shared tab definition — same valid keys as before, legacy redirects intact", () => {
  const expected = ["overview", "findmi-here", "performance", "qr", "profile", "products", "orders", "settings", "opportunities", "inquiries", "referral", "more", "gallery", "links", "plan", "market", "followers", "moments", "growth"];
  assert.deepEqual([...BIZ.VALID_BUSINESS_TAB_KEYS].sort(), [...expected].sort());
  assert.deepEqual(BIZ.LEGACY_TAB_REDIRECTS, { links: "profile", plan: "settings", market: "settings", followers: "performance" });
  assert.ok(BIZ.VALID_BUSINESS_TAB_KEYS.has("gallery"), "gallery stays a valid key: Photos is its own destination again");
  assert.deepEqual(BIZ.BUSINESS_NAV.map((n) => [n.label, n.tab]), [["Home", "overview"], ["Moments", "moments"], ["Findmi Here", "findmi-here"], ["Performance", "performance"], ["Products", "products"], ["Growth", "growth"], ["More", "more"]]);
  const page = read(`${B}/(manager)/page.tsx`);
  assert.doesNotMatch(page, /const PRIMARY_TABS|const LEGACY_TAB_REDIRECTS|const ORDERS_TAB/);
  assert.match(page, /from "\.\.\/v2\/business-nav"/);
  assert.match(page, /LEGACY_TAB_REDIRECTS\[tab\]/, "redirect behavior untouched");
  assert.match(read(`${B}/v2/BusinessAppShell.tsx`), /BUSINESS_NAV\.map/);
  assert.match(read(`${B}/v2/MoreMenu.tsx`), /BUSINESS_MORE_TABS as T/);
});

test("Business More: personal destinations sit behind one Your Account entry; Manager tools (Schedule, Inbox, Orders) stay", () => {
  const more = read(`${B}/v2/MoreMenu.tsx`);
  assert.match(more, /href: "\/account", label: "Your Account"/);
  for (const gone of ["/account/saved", "/account/following", "/account/orders", "/account/profile"]) assert.ok(!more.includes(`"${gone}"`), gone);
  // Manager tools resolve through lib/manager-links, so they stay inside this Business.
  for (const kept of ['to("schedule")', 'to("inbox")', 'to("orders")', 'to("qr")', 'to("settings")', 'to("inquiry-settings")']) assert.ok(more.includes(kept), kept);
  const personal = read("src/app/(public)/account/PersonalAppShell.tsx");
  for (const dest of ["/account/saved", "/account/following", "/account/orders", "/account/profile"]) assert.ok(personal.includes(`"${dest}"`), `${dest} still reachable from the personal shell`);
});

test("Business More ends with a direct Sign Out that reuses the existing confirm + signOut action", () => {
  const more = read(`${B}/v2/MoreMenu.tsx`);
  assert.match(more, /import SignOutConfirm from "@\/components\/SignOutConfirm";/);
  assert.match(more, /import \{ signOut \} from "@\/app\/\(public\)\/account\/profile\/actions";/);
  assert.match(more, /<SignOutConfirm\s+action=\{signOut\}/);
  assert.ok(more.indexOf('title="Your Account"') < more.indexOf("<SignOutConfirm"), "Sign Out sits below Your Account, at the bottom");
  assert.ok(more.includes('href: "/account", label: "Your Account"') && more.includes('to("schedule")'), "Your Account and Schedule kept");
});
