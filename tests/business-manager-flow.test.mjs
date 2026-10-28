// Business Manager Flow & Navigation — one persistent Business context, exact
// deep links (lib/manager-links), Quick Actions on Home, the More directory,
// one Public Profile destination, the unified scoped Inbox, Manager Search,
// origin-aware Back and the minimal unsaved-change guard. Pure helpers are
// called directly; Search and the Inbox run against the in-memory PostgREST
// fake; page structure is proven with source-level guards (no JSX harness).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { registerHooks } from "node:module";
import { fakeDb } from "./helpers/fake-postgrest.mjs";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const L = await import("../src/lib/manager-links.ts");
const MC = await import("../src/app/(public)/account/business/[id]/v2/managementCardItems.ts");
const HS = await import("../src/lib/home-schedule.ts");
const I = await import("../src/lib/inbox.ts");
const IS = await import("../src/lib/inbox-server.ts");
const S = await import("../src/lib/manager-search.ts");
const NAV = await import("../src/app/(public)/account/business/[id]/v2/business-nav.ts");

const read = (p) => readFileSync(p, "utf8");
const B = "src/app/(public)/account/business/[id]";
const M = `${B}/(manager)`;
const HOME = read(`${B}/v2/BusinessHome.tsx`);
const PAGE = read(`${M}/page.tsx`);
const MORE = read(`${B}/v2/MoreMenu.tsx`);
const SHELL = read(`${B}/v2/BusinessAppShell.tsx`);
const SWITCHER = read("src/components/account/AccountContextSwitcher.tsx");
const THREAD_VIEW = read("src/app/(public)/account/messages/[id]/ConversationThreadView.tsx");
const BIZ_INBOX = read(`${M}/inbox/page.tsx`);
const BIZ_THREAD = read(`${M}/inbox/[conversationId]/page.tsx`);
const SEARCH_PAGE = read(`${M}/search/page.tsx`);
const DISCOVER = read(`${B}/v2/DiscoverView.tsx`);
const GUARD = read("src/components/UnsavedChangesGuard.tsx");

const BIZ = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const UUID3 = "33333333-3333-4333-8333-333333333333";
const base = `/account/business/${BIZ}`;

// ── 1. Destinations ────────────────────────────────────────────────────────

test("1. managerHref: every destination resolves to its exact Manager URL", () => {
  const want = {
    home: base,
    profile: `${base}?tab=profile`,
    "public-actions": `${base}?tab=profile#public-actions`,
    announcement: `${base}?tab=profile#announcement`,
    gallery: `${base}?tab=gallery`,
    "inquiry-settings": `${base}?tab=inquiries`,
    products: `${base}?tab=products`,
    schedule: `${base}?tab=findmi-here&view=upcoming`,
    "find-us": `${base}?tab=findmi-here&view=find-us`,
    performance: `${base}?tab=performance`,
    qr: `${base}?tab=qr`,
    "new-qr": `${base}/qr/new`,
    goals: `${base}/brand-audit?step=goals`,
    targets: `${base}?tab=growth&view=targets`,
    "add-target": `${base}?tab=growth&view=targets&add=1`,
    discover: `${base}?tab=growth&view=discover`,
    opportunities: `${base}?tab=opportunities`,
    inbox: `${base}/inbox`,
    search: `${base}/search`,
    settings: `${base}?tab=settings`,
  };
  for (const [d, href] of Object.entries(want)) assert.equal(L.managerHref(BIZ, d), href, d);
});

test("2. every Manager destination stays inside the active Business", () => {
  const all = ["home", "profile", "public-actions", "announcement", "gallery", "inquiry-settings", "products", "add-product", "findmi-here", "schedule", "find-us", "where-ill-be", "add-location", "moments", "performance", "qr", "new-qr", "growth", "goals", "targets", "add-target", "discover", "opportunities", "ideas", "orders", "settings", "inbox", "search", "more"];
  for (const d of all) assert.ok(L.managerHref(BIZ, d).startsWith(base), d);
});

test("3. record deep links: thread, product row, appearance", () => {
  assert.equal(L.managerThreadHref(BIZ, "c1"), `${base}/inbox/c1`);
  assert.equal(L.managerProductHref(BIZ, "p1"), `${base}?tab=products&editing=p1#product-p1`);
  assert.equal(L.managerAppearanceHref(BIZ, "a1"), `${base}?tab=findmi-here&editing=a1`);
});

test("4. 'Public Actions' lands on the Public Actions section of Public Profile", () => {
  assert.match(read("src/components/public-actions/PublicActionsEditor.tsx"), /<section id="public-actions" className="scroll-mt-24/);
  // Profile Buttons is the last Profile section (Consolidation pass).
  assert.match(read(`${B}/v2/ProfileSectionNav.tsx`), /\{ key: "public-actions", label: "Profile Buttons" \},\n\];/);
});

test("5. Set Your Goals opens the Goals editor step, which the page reads", () => {
  assert.match(read(`${B}/v2/GrowthPanel.tsx`), /brand-audit\?step=goals/);
  assert.match(read(`${B}/v2/GrowthView.tsx`), /\?step=goals/);
  assert.match(read(`${B}/brand-audit/page.tsx`), /STEPS\.includes\(stepParam as AuditStep\)/);
});

test("6. Add Target opens the Add form directly (?add=1)", () => {
  const tv = read(`${B}/v2/TargetsView.tsx`);
  assert.match(tv, /useState\(\(\) => canEdit && searchParams\.get\("add"\) === "1"\)/);
});

test("7. product deep link opens that product row (anchor + open editor)", () => {
  assert.match(PAGE, /id=\{`product-\$\{p\.id\}`\}/);
  assert.match(PAGE, /open=\{editing === p\.id\}/);
});

test("8. View Performance and View Public Page use the active Business", () => {
  assert.match(HOME, /href=\{managerHref\(businessId, "performance"\)\}/);
  assert.match(MORE, /href: `\/business\/\$\{businessSlug\}`, label: "View Public Page"/);
  assert.match(PAGE, /View Public Page/);
});

// ── 2. Origin-aware Back (no open redirect) ────────────────────────────────

test("9. originBack maps each known origin to a fixed destination of the SAME Business", () => {
  assert.deepEqual(L.originBack(BIZ, "discover"), { href: L.managerHref(BIZ, "discover"), label: "Discover" });
  assert.deepEqual(L.originBack(BIZ, "targets"), { href: L.managerHref(BIZ, "targets"), label: "Targets" });
  assert.deepEqual(L.originBack(BIZ, "inbox"), { href: L.managerHref(BIZ, "inbox"), label: "Inbox" });
  assert.deepEqual(L.originBack(BIZ, "search"), { href: L.managerHref(BIZ, "search"), label: "Search" });
  // Targets moved out of Find Us Here (Growth owns them): Back lands on the list.
  assert.equal(L.originBack(BIZ, "findmi-here").href, `${base}?tab=findmi-here&view=find-us`);
  assert.equal(L.originBack(BIZ, "markets").href, `${base}?tab=findmi-here&view=find-us&fv=markets`);
  for (const o of L.MANAGER_ORIGINS) assert.ok(L.originBack(BIZ, o).href.startsWith(base), o);
});

test("10. unknown / hostile origins are ignored (no open redirect)", () => {
  for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/admin", "Discover", "", null, undefined, 3, ["inbox"]]) assert.equal(L.originBack(BIZ, bad), null, String(bad));
});

test("11. withOrigin tags a href and keeps its #anchor", () => {
  assert.equal(L.withOrigin(`${base}/inbox/c1`, "search"), `${base}/inbox/c1?from=search`);
  assert.equal(L.withOrigin(`${base}?tab=products#product-p`, "search"), `${base}?tab=products&from=search#product-p`);
});

test("12. relationship workspace Back honors a validated origin, else the lens it came from", () => {
  assert.match(PAGE, /const workspaceOrigin = originBack\(id, rawSearchParams\.from\);/);
  assert.match(PAGE, /if \(workspaceOrigin\) return workspaceOrigin\.href;/);
  assert.match(PAGE, /k !== "from"/, "from never leaks into the lens URL");
  assert.match(PAGE, /backLabel=\{workspaceOrigin\?\.label \?\? "Targets"\}/);
});

test("13. Discover → relationship → Back returns to Discover", () => {
  assert.match(DISCOVER, /\}\)\)\}&from=discover` : null;/);
});

test("14. Inbox → Inquiry → Back returns to the Inbox", () => {
  assert.equal(I.threadSourceLink("commercial_inquiry", UUID3, BIZ).href, `${base}/inquiries/${UUID3}?from=inbox`);
  const detail = read(`${B}/inquiries/[inquiryId]/page.tsx`);
  assert.match(detail, /const origin = originBack\(id, from\);/);
  assert.match(detail, /origin\?\.label \?\?/);
});

test("15. Manager thread Back: origin when known, else the Business Inbox", () => {
  assert.match(BIZ_THREAD, /originBack\(/);
  assert.match(BIZ_THREAD, /managerBusinessId=\{id\}/);
});

// ── 3. Business switching ──────────────────────────────────────────────────

const sw = (path, search = "") => L.switchBusinessHref(path, search, BIZ, OTHER);
const other = `/account/business/${OTHER}`;

test("16. switching keeps Home, a tab and a view", () => {
  assert.equal(sw(base), other);
  assert.equal(sw(base, "?tab=products"), `${other}?tab=products`);
  assert.equal(sw(base, "?tab=growth&view=discover"), `${other}?tab=growth&view=discover`);
  assert.equal(sw(base, "?tab=findmi-here&view=find-us&fv=markets"), `${other}?tab=findmi-here&view=find-us&fv=markets`);
});

test("17. switching keeps portable sub-pages (Inbox, Search, Goals, New QR)", () => {
  assert.equal(sw(`${base}/inbox`), `${other}/inbox`);
  assert.equal(sw(`${base}/search`, "?q=market"), `${other}/search`, "the query is this Business's search, not carried");
  assert.equal(sw(`${base}/brand-audit`, "?step=goals"), `${other}/brand-audit?step=goals`);
  assert.equal(sw(`${base}/qr/new`), `${other}/qr/new`);
});

test("18. switching drops record-specific state and falls back to Home", () => {
  assert.equal(sw(`${base}/inbox/c1`), other, "a thread belongs to one Business");
  assert.equal(sw(`${base}/inquiries/${UUID3}`), other);
  assert.equal(sw(`${base}/opportunities/r1`), other);
  assert.equal(sw(base, "?tab=growth&view=targets&tgt=t1&editing=e1"), `${other}?tab=growth&view=targets`);
});

test("19. switching never carries unsafe values or leaves the Manager", () => {
  assert.equal(sw(base, "?tab=%3Cscript%3E"), other);
  assert.equal(sw(base, `?tab=${"x".repeat(41)}`), other);
  assert.equal(sw("/account/messages"), other);
  assert.equal(sw("/admin"), other);
});

test("20. the switcher preserves the destination and offers a deliberate Exit", () => {
  assert.match(SWITCHER, /switchBusinessHref\(/);
  assert.match(SWITCHER, /Exit Business Manager/);
  assert.match(SWITCHER, /isPlainLeftClick/);
});

// ── 4. Persistent shell + frozen bottom nav ────────────────────────────────

test("21. bottom nav is frozen: Home · Moments · Findmi Here · Performance · More", () => {
  assert.deepEqual(NAV.BUSINESS_NAV.filter((n) => !n.desktopOnly).map((n) => n.label), ["Home", "Moments", "Findmi Here", "Performance", "More"]);
});

test("22. Inbox and Search live in the (manager) route group (persistent shell)", () => {
  for (const p of [`${M}/inbox/page.tsx`, `${M}/inbox/[conversationId]/page.tsx`, `${M}/search/page.tsx`]) assert.ok(existsSync(p), p);
  assert.match(BIZ_INBOX, /getManagerCore\(id\)/);
  assert.match(SEARCH_PAGE, /getManagerCore\(id\)/);
});

test("23. Inbox / Search highlight More in the persistent nav", () => {
  // Discovery Engine + Map V1 added the Manager Map sub-route (also in More).
  assert.match(read(`${B}/v2/ManagerNav.tsx`), /\(inbox\|search\|map\)\(\\\/\|\$\)/);
});

test("24. context bar: compact Search + Inbox with accessible names", () => {
  assert.match(SHELL, /managerHref\([^)]*"search"\)/);
  assert.match(SHELL, /managerHref\([^)]*"inbox"\)/);
  assert.match(SHELL, /aria-label=\{`Search \$\{/);
  assert.match(SHELL, /Inbox`\}/);
});

// ── 5. Management cards (Findmi Consolidation pass — replace Quick Actions) ──

const cards = MC.managementCards(BIZ);

test("25. Management cards in the locked order: Events · Locations · Products · QR Codes · Moments · Targets", () => {
  assert.deepEqual(cards.map((c) => c.key), ["events", "locations", "products", "qr", "moments", "targets"]);
});

test("26. every card's actions inherit the active Business (never ask which one)", () => {
  for (const c of cards) {
    assert.ok(c.addHref.includes(BIZ), `${c.key} add: ${c.addHref}`);
    assert.ok(c.viewHref.includes(BIZ), `${c.key} view: ${c.viewHref}`);
  }
});

test("27. each card has a distinct manage action (View All …) and create action (Add …)", () => {
  for (const c of cards) {
    assert.match(c.viewLabel, /^View All /, c.key);
    assert.match(c.addLabel, /^Add /, c.key);
    assert.notEqual(c.viewHref, c.addHref, `${c.key}: the two actions go to different places`);
  }
});

test("28. destinations are the existing / canonical flows (Event chooser, search-first Location, Add Target, New QR)", () => {
  const by = (k) => cards.find((c) => c.key === k);
  assert.equal(by("events").addHref, L.managerHref(BIZ, "add-event"));
  assert.equal(by("locations").addHref, `/account/location/new?business_id=${BIZ}`);
  assert.equal(by("targets").addHref, L.managerHref(BIZ, "add-target"));
  assert.match(by("qr").addHref, /\/qr\/new/);
  assert.equal(by("events").viewHref, L.managerHref(BIZ, "findmi-here"));
  assert.equal(by("locations").viewHref, L.managerHref(BIZ, "our-locations"));
});

test("29. cards: rounded, light-gray border, Aqua icon tile; one swipeable snap row on phones (founder direction), grid from sm up", () => {
  const CARDS = read(`${B}/v2/ManagementCards.tsx`);
  assert.match(CARDS, /<nav aria-label="Manage Your Business">/);
  assert.match(CARDS, /-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 [^"]*sm:grid sm:snap-none sm:grid-cols-3/);
  assert.match(CARDS, /h-12 w-12 items-center justify-center rounded-2xl bg-findmi-50 text-findmi-700/);
});

test("30. the old Quick Create section and Quick Actions rail are gone; the cards sit directly under identity", () => {
  assert.doesNotMatch(HOME, /aria-labelledby="quick-create"|const quick = |QuickActionsRail/);
  assert.ok(HOME.indexOf('aria-label="Business status"') < HOME.indexOf("<ManagementCards"));
  assert.ok(HOME.indexOf("<ManagementCards") < HOME.indexOf("<NeedsAttentionBar"));
});

test("31. Home order: identity → Management cards → Needs Attention → Requests → Follow-Ups → Coming Up → Opportunities → Performance → utility", () => {
  const order = ['aria-label="Business status"', "<ManagementCards", "<NeedsAttentionBar", "<RequestsSection", "<FollowUpsSection", 'aria-labelledby="coming-up"', "<GrowthPanel", 'aria-labelledby="performance-snapshot"', 'aria-labelledby="findmi-link"'].map((m) => HOME.indexOf(m));
  assert.ok(order.every((i) => i > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("32. Needs Attention, Requests and Follow-Ups render nothing at zero", () => {
  assert.match(read(`${B}/v2/NeedsAttentionBar.tsx`), /if \(items\.length === 0\) return null;/);
  assert.match(HOME, /if \(!items\.length\) return null;|items\.length === 0\) return null/);
});

// ── 6. Coming Up grouping ──────────────────────────────────────────────────

const NOW = new Date("2026-10-24T16:00:00Z"); // Sat Oct 24, 12:00 PM New York

test("33. Coming Up buckets: Today / Tomorrow / This Week / Later (New York days)", () => {
  assert.equal(HS.comingUpBucket("2026-10-24T22:00:00Z", NOW), "today");
  assert.equal(HS.comingUpBucket("2026-10-25T03:30:00Z", NOW), "today", "11:30 PM New York is still today");
  assert.equal(HS.comingUpBucket("2026-10-25T15:00:00Z", NOW), "tomorrow");
  assert.equal(HS.comingUpBucket("2026-10-30T15:00:00Z", NOW), "this-week");
  assert.equal(HS.comingUpBucket("2026-10-31T15:00:00Z", NOW), "later");
});

test("34. bad dates are never guessed into Today", () => {
  assert.equal(HS.comingUpBucket("not a date", NOW), "later");
});

test("35. groupComingUp keeps order and omits empty buckets", () => {
  const items = [{ startAt: "2026-10-24T22:00:00Z", k: 1 }, { startAt: "2026-10-28T15:00:00Z", k: 2 }, { startAt: "2026-10-29T15:00:00Z", k: 3 }];
  const g = HS.groupComingUp(items, NOW);
  assert.deepEqual(g.map((x) => x.label), ["Today", "This Week"]);
  assert.deepEqual(g[1].items.map((x) => x.k), [2, 3]);
});

test("36. Coming Up renders the groups from existing data only", () => {
  assert.match(HOME, /const comingUpGroups = groupComingUp\(comingUp\);/);
  assert.match(HOME, /<h3 className="text-label font-bold uppercase text-subtle">\{g\.label\}<\/h3>/);
  assert.doesNotMatch(read("src/lib/home-schedule.ts"), /from\(|supabase/i);
});

// ── 7. More directory ──────────────────────────────────────────────────────

test("37. More groups in order: Manage · Work · Tools · Business · Your Account", () => {
  const titles = [...MORE.matchAll(/<MoreGroup title="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(titles.slice(0, 5), ["Manage", "Work", "Tools", "Business", "Your Account"]);
});

test("38. MANAGE: Public Profile, Products, Schedule, Findmi Here, Growth (+ View Public Page)", () => {
  const manage = MORE.slice(MORE.indexOf("const manage"), MORE.indexOf("const work"));
  for (const k of ['to("profile")', 'to("products")', 'to("schedule")', 'to("find-us")', 'to("growth")']) assert.ok(manage.includes(k), k);
  assert.equal(NAV.BUSINESS_MORE_TABS.profile.label, "Public Profile");
});

test("39. WORK: Inbox, Opportunities, Orders (when relevant), Inquiry Settings", () => {
  const work = MORE.slice(MORE.indexOf("const work"), MORE.indexOf("const tools"));
  for (const k of ['to("inbox")', 'to("opportunities")', 'to("orders")', 'to("inquiry-settings")']) assert.ok(work.includes(k), k);
  assert.match(work, /\.\.\.\(ordersRelevant \?/);
});

test("40. TOOLS: QR Codes (and Search); BUSINESS: Plan & Settings", () => {
  const tools = MORE.slice(MORE.indexOf("const tools"), MORE.indexOf("const business"));
  assert.ok(tools.includes('to("qr")') && tools.includes('to("search")'));
  const business = MORE.slice(MORE.indexOf("const business"), MORE.indexOf("const yourAccount"));
  assert.ok(business.includes('to("settings")'));
});

test("41. More descriptions are concise (fit two lines at 360px) and every row is a real destination", () => {
  const descs = [...MORE.matchAll(/description: "([^"]+)"/g)].map((m) => m[1]).concat(Object.values(NAV.BUSINESS_MORE_TABS).map((t) => t.description).filter(Boolean));
  for (const d of descs) assert.ok(d.length <= 72, d);
  assert.match(MORE, /line-clamp-2/);
  assert.doesNotMatch(MORE, /href: "#"|coming soon/i);
});

test("42. no backend terms in More / management card / Search labels", () => {
  const labels = [...MORE.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]).concat(cards.flatMap((c) => [c.title, c.addLabel, c.viewLabel]), Object.values(S.MANAGER_SEARCH_TYPE_LABELS), Object.values(I.INBOX_TYPE_LABELS));
  for (const l of labels) assert.doesNotMatch(l, /appearance|entity|subject|recipient|_|tab=|commercial_/i, l);
});

// ── 8. Public Profile ──────────────────────────────────────────────────────

test("43. Public Profile is one destination: details, Public Actions, Links, Announcement; Photos is linked, not embedded", () => {
  const nav = read(`${B}/v2/ProfileSectionNav.tsx`);
  assert.match(nav, /ariaLabel="Public Profile sections"/);
  for (const k of ["details", "public-actions", "links", "announcement"]) assert.ok(nav.includes(`{ key: "${k}", `), k);
  assert.match(nav, /key === "gallery" \? managerHref\(businessId, "gallery"\)/, "Photos opens the Photos destination");
  assert.match(PAGE, /<ProfileSectionNav businessId=\{id\} current="profile" \/>/);
  for (const id of ['Panel id="details"', 'Panel id="links"', 'id="announcement"']) assert.ok(PAGE.includes(id), id);
  assert.ok(!PAGE.includes('Panel id="gallery"'), "the gallery is no longer a Profile section");
});

test("44. Panel takes an id with a sticky-safe scroll margin", () => {
  assert.match(read("src/app/(public)/account/owner-ui.tsx"), /scroll-mt-24/);
});

test("45. Inquiry capability and topics stay in Inquiry Settings", () => {
  assert.match(PAGE, /How inquiries work stays in Inquiry Settings/);
  assert.match(NAV.BUSINESS_MORE_TABS.inquiries.description, /on or off, and topics/);
});

// ── 9. Unified Inbox ───────────────────────────────────────────────────────

const conv = (id, keys, extra = {}) => ({ id, unread: false, myKeys: keys, subjectType: "business_inquiry", subjectId: "x", otherPartyLabel: id, ...extra });

test("46. parseInboxScope: all / personal / a managed Business only", () => {
  assert.deepEqual(I.parseInboxScope(undefined, [BIZ]), { kind: "all" });
  assert.deepEqual(I.parseInboxScope("personal", [BIZ]), { kind: "personal" });
  assert.deepEqual(I.parseInboxScope(`business:${BIZ}`, [BIZ]), { kind: "business", businessId: BIZ });
});

test("47. a Business the viewer doesn't manage (or junk) falls back to All", () => {
  assert.deepEqual(I.parseInboxScope(`business:${OTHER}`, [BIZ]), { kind: "all" });
  assert.deepEqual(I.parseInboxScope("business:not-a-uuid", ["not-a-uuid"]), { kind: "all" });
});

test("48. scopes filter the ONE conversation list by the viewer's identities", () => {
  const items = [conv("p", ["personal:u"]), conv("b", [`business:${BIZ}`]), conv("both", ["personal:u", `business:${BIZ}`]), conv("o", [`business:${OTHER}`])];
  assert.deepEqual(I.filterInbox(items, { kind: "all" }).map((c) => c.id), ["p", "b", "both", "o"]);
  assert.deepEqual(I.filterInbox(items, { kind: "personal" }).map((c) => c.id), ["p"]);
  assert.deepEqual(I.filterInbox(items, { kind: "business", businessId: BIZ }).map((c) => c.id), ["b", "both"]);
});

test("49. unread counts per scope; All never double-counts a shared thread", () => {
  const items = [conv("p", ["personal:u"], { unread: true }), conv("both", [`business:${BIZ}`, `business:${OTHER}`], { unread: true }), conv("r", [`business:${BIZ}`])];
  assert.deepEqual(I.inboxUnreadCounts(items, [BIZ, OTHER]), { all: 2, personal: 1, business: { [BIZ]: 1, [OTHER]: 1 } });
});

test("50. every conversation type has a business-language label", () => {
  for (const t of ["commercial_inquiry", "commercial_opportunity", "business_inquiry", "product_inquiry", "event_inquiry", "venue_inquiry", "findmi_commercial_request", "findmi_sales", "event_business_chat", "business_business_chat", "business_location_chat"]) {
    assert.ok(I.INBOX_TYPE_LABELS[t], t);
  }
  assert.equal(I.inboxTypeLabel("something_new"), "Message", "never the raw subject_type");
});

test("51. thread source links: View Inquiry / View Opportunity / View Product, only for this Business", () => {
  assert.deepEqual(I.threadSourceLink("commercial_opportunity", UUID3, BIZ), { label: "View Opportunity", href: `${base}/opportunities/${UUID3}` });
  assert.equal(I.threadSourceLink("product_inquiry", UUID3, BIZ).label, "View Product");
  assert.equal(I.threadSourceLink("commercial_inquiry", UUID3, null), null);
  assert.equal(I.threadSourceLink("commercial_inquiry", "../x", BIZ), null);
  assert.equal(I.threadSourceLink("business_business_chat", UUID3, BIZ), null);
});

test("52. loadInboxView: hides Event-participation notes, caps the page, details only for shown rows", async () => {
  const many = Array.from({ length: 60 }, (_, i) => conv(`c${i}`, [`business:${BIZ}`], { subjectType: "commercial_inquiry", subjectId: `0000000${i % 10}-0000-4000-8000-000000000000`.slice(-36) }));
  const all = [conv("note", [`business:${BIZ}`], { subjectType: "opportunity" }), ...many];
  const db = fakeDb({ commercial_inquiries: [], opportunity_recipients: [] });
  const view = await IS.loadInboxView(db, all, { kind: "business", businessId: BIZ }, [BIZ]);
  assert.equal(view.rows.length, IS.INBOX_PAGE_SIZE);
  assert.equal(view.total, 60);
  assert.ok(!view.rows.some((r) => r.id === "note"));
  assert.ok(db.calls.length <= 2, "at most two batched detail reads");
});

test("53. thread details: intent for an Inquiry, title for an Opportunity, in two batched reads", async () => {
  const db = fakeDb({ commercial_inquiries: [{ id: UUID3, intent: "pop_up" }], opportunity_recipients: [{ id: BIZ, listing_id: "L" }], opportunity_listings: [{ id: "L", title: "Holiday Market" }] });
  const d = await IS.inboxThreadDetails(db, [{ id: "a", subjectType: "commercial_inquiry", subjectId: UUID3 }, { id: "b", subjectType: "commercial_opportunity", subjectId: BIZ }, { id: "c", subjectType: "business_inquiry", subjectId: UUID3 }]);
  assert.equal(d.get("b"), "Holiday Market");
  assert.ok(d.has("a"));
  assert.ok(!d.has("c"));
  assert.equal(db.calls.length, 2);
});

test("54. no new messaging tables: the Inbox reads the existing conversation model only", () => {
  const src = read("src/lib/inbox.ts") + read("src/lib/inbox-server.ts");
  assert.doesNotMatch(src, /from\("(inbox|inbox_items|messages|notifications|orders)"\)/);
  assert.match(BIZ_INBOX, /listConversationsForUser\(admin, user\.id\)/);
});

test("55. Business Inbox defaults to that Business's scope; the selector lists All, Personal and each Business", () => {
  assert.match(BIZ_INBOX, /loadInboxView\(admin, all, \{ kind: "business", businessId: id \}, businessIds\)/);
  assert.match(BIZ_INBOX, /<InboxScopeMenu current=\{`business:\$\{id\}`\} options=\{scopes\} \/>/);
  assert.match(BIZ_INBOX, /key: "all"[\s\S]*key: "personal"[\s\S]*managedBusinesses\.map/);
});

test("56. Business Inbox rows open the thread inside the Manager", () => {
  assert.match(BIZ_INBOX, /href: managerThreadHref\(id, c\.id\)/);
});

test("57. the Manager thread is only for a Business that is a party (else the personal thread)", () => {
  assert.match(THREAD_VIEW, /managerBusinessId/);
  assert.match(THREAD_VIEW, /redirect\(`\/account\/messages\/\$\{/);
});

test("58. the thread shows why it exists (type · detail) and links to its source", () => {
  assert.match(THREAD_VIEW, /inboxTypeLabel\(/);
  assert.match(THREAD_VIEW, /threadSourceLink\(/);
});

test("59. every Manager Inbox entry point opens the Business Inbox", () => {
  assert.match(MORE, /to\("inbox"\)/);
  assert.match(PAGE, /href=\{managerHref\(id, "inbox"\)\}/);
  assert.match(read("src/lib/opportunity-listings.ts"), /href: `\/account\/business\/\$\{args\.businessId\}\/inbox\/\$\{thread\.conversationId\}`/);
  assert.match(read("src/lib/business-requests.ts"), /href: `\$\{basePath\}\/inbox\?view=invitations`/);
  assert.match(BIZ_INBOX, /viewParam === "invitations"/);
});

test("60. Requests stay distinct from the Inbox: unread never creates a Request", () => {
  assert.doesNotMatch(read("src/lib/business-requests.ts").replace(/\/\/.*$/gm, ""), /unread|last_read/);
});

test("61. invitation responses from a Manager thread stay in the Manager", () => {
  const a = read("src/app/(public)/connect/actions.ts");
  assert.match(a, /inManager: boolean/);
  assert.match(a, /threadPath\(conversationId, /);
});

test("62. the personal Inbox uses the same scopes and rows", () => {
  const p = read("src/app/(public)/account/messages/page.tsx");
  assert.match(p, /parseInboxScope\(/);
  assert.match(p, /<InboxScopeMenu/);
  assert.match(p, /<InboxThreadList/);
});

test("63. the scope selector is compact (a disclosure, not a wall of cards) with tap-size rows", () => {
  const m = read("src/components/inbox/InboxScopeMenu.tsx");
  assert.match(m, /<details/);
  assert.match(m, /min-h-11/);
  assert.match(m, /aria-current=/);
});

// ── 10. Manager Search ─────────────────────────────────────────────────────

test("64. searchPattern: too short or not text → no search", () => {
  for (const q of [undefined, null, 3, "", " ", "a", " a "]) assert.equal(S.searchPattern(q), null, String(q));
  assert.equal(S.searchPattern("ma"), "%ma%");
});

test("65. searchPattern escapes LIKE wildcards and PostgREST separators", () => {
  assert.equal(S.searchPattern("50%_off\\"), "%50\\%\\_off\\\\%");
  assert.equal(S.searchPattern("a,b(c)"), "%a b c %");
});

test("66. searchPattern collapses whitespace and caps the text at 80 characters", () => {
  assert.equal(S.searchPattern("  night    market "), "%night market%");
  assert.equal(S.searchPattern("x".repeat(200)).length, 82);
});

const seed = () => ({
  products: [
    { id: "p1", business_id: BIZ, name: "Market Tote", trashed_at: null },
    { id: "p2", business_id: BIZ, name: "Market Mug (old)", trashed_at: "2026-01-01" },
    { id: "p3", business_id: OTHER, name: "Market Secret", trashed_at: null },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `px${i}`, business_id: BIZ, name: `Market Item ${i}`, trashed_at: null })),
  ],
  locations: [{ id: "l1", name: "Market Hall" }, { id: "l2", name: "Market Square" }],
  business_locations: [{ id: "bl1", business_id: BIZ, location_id: "l1" }, { id: "bl2", business_id: OTHER, location_id: "l2" }],
  events: [
    { id: "e1", name: "Night Market", slug: "night-market", host_business_id: BIZ, trashed_at: null },
    { id: "e2", name: "Harvest Market", slug: "harvest-market", host_business_id: OTHER, trashed_at: null },
    { id: "e3", name: "Secret Market", slug: "secret-market", host_business_id: OTHER, trashed_at: null },
  ],
  event_businesses: [{ id: "eb1", business_id: BIZ, event_id: "e2", status: "approved" }, { id: "eb2", business_id: OTHER, event_id: "e3", status: "approved" }],
  appearances: [{ id: "a1", business_id: BIZ, title: "Market Pop-Up", start_at: "2026-11-01" }, { id: "a2", business_id: OTHER, title: "Market Other", start_at: "2026-11-01" }],
  opportunity_listings: [{ id: "ol1", title: "Market Vendors Wanted" }],
  opportunity_recipients: [
    { id: "r1", business_id: BIZ, status: "offered", listing_id: "ol1" },
    { id: "r2", business_id: BIZ, status: "withdrawn", listing_id: "ol1" },
    { id: "r3", business_id: OTHER, status: "offered", listing_id: "ol1" },
  ],
  businesses: [{ id: BIZ, name: "Market Self" }, { id: "b9", name: "Market Bakery" }],
  business_targets: [
    { id: "t1", business_id: BIZ, status: "target", target_business_id: "b9", target_location_id: null, target_event_id: null },
    { id: "t2", business_id: OTHER, status: "target", target_business_id: "b9", target_location_id: null, target_event_id: null },
  ],
});
const convs = [
  { id: "c1", otherPartyLabel: "Market Bakery", subjectType: "commercial_inquiry", myKeys: [`business:${BIZ}`] },
  { id: "c2", otherPartyLabel: "Market Personal", subjectType: "business_inquiry", myKeys: ["personal:u"] },
  { id: "c3", otherPartyLabel: "Market Other Biz", subjectType: "business_inquiry", myKeys: [`business:${OTHER}`] },
];
const run = async (q = "market") => {
  const db = fakeDb(seed());
  return { db, res: await S.searchManager(db, BIZ, q, convs) };
};
const titles = (res, type) => res.filter((r) => r.type === type).map((r) => r.title);

test("67. a too-short query reads nothing", async () => {
  const db = fakeDb(seed());
  assert.deepEqual(await S.searchManager(db, BIZ, "m", convs), []);
  assert.equal(db.calls.length, 0);
});

test("68. Products: this Business's live catalog only, capped per type", async () => {
  const { res } = await run();
  const p = titles(res, "product");
  assert.equal(p.length, S.MANAGER_SEARCH_PER_TYPE);
  assert.ok(!p.includes("Market Secret"), "never another Business's product");
  assert.ok(!p.includes("Market Mug (old)"), "never a trashed product");
});

test("69. Places: only this Business's own Locations", async () => {
  const { res } = await run();
  assert.deepEqual(titles(res, "place"), ["Market Hall"]);
});

test("70. Events: hosted, plus the ones it takes part in — never another Business's", async () => {
  const { res } = await run();
  assert.deepEqual(titles(res, "event").sort(), ["Harvest Market", "Night Market"]);
  assert.equal(res.find((r) => r.title === "Night Market").context, "Event · Hosting");
  assert.equal(res.find((r) => r.title === "Harvest Market").context, "Event · Taking Part");
});

test("71. Where I'll Be: this Business's appearances only", async () => {
  const { res } = await run();
  assert.deepEqual(titles(res, "appearance"), ["Market Pop-Up"]);
});

test("72. Targets: only THIS Business's private Targets (never another's)", async () => {
  const { res } = await run();
  const t = res.filter((r) => r.type === "target");
  assert.equal(t.length, 1);
  assert.equal(t[0].title, "Market Bakery");
  assert.match(t[0].href, /tgt=t1&from=search$/);
});

test("73. Opportunities: sent to this Business, withdrawn hidden", async () => {
  const { res } = await run();
  const o = res.filter((r) => r.type === "opportunity");
  assert.deepEqual(o.map((r) => r.href), [`${base}/opportunities/r1`]);
});

test("74. Conversations: only threads this Business is part of", async () => {
  const { res } = await run();
  assert.deepEqual(titles(res, "conversation"), ["Market Bakery"]);
  assert.equal(res.find((r) => r.type === "conversation").context, "Conversation · Commercial Inquiry");
});

test("75. results deep-link to exact Manager destinations", async () => {
  const { res } = await run();
  const href = (type, title) => res.find((r) => r.type === type && r.title === title).href;
  assert.equal(href("product", "Market Tote"), L.managerProductHref(BIZ, "p1"));
  assert.equal(href("appearance", "Market Pop-Up"), L.managerAppearanceHref(BIZ, "a1"));
  assert.equal(href("conversation", "Market Bakery"), `${base}/inbox/c1?from=search`);
  assert.equal(href("event", "Night Market"), `/account/event/e1?business_id=${BIZ}`);
  assert.match(href("place", "Market Hall"), /loc=l1&from=search$/);
});

test("76. every per-Business read is filtered by the active Business and bounded", async () => {
  const { db } = await run();
  const scoped = ["products", "business_locations", "appearances", "opportunity_recipients", "event_businesses", "business_targets"];
  for (const c of db.calls.filter((x) => scoped.includes(x.table))) assert.ok(c.filters.some((f) => f.endsWith("business_id")), `${c.table}: ${c.filters}`);
  assert.ok(db.calls.length <= 10, `bounded: ${db.calls.length} reads`);
  const src = read("src/lib/manager-search.ts");
  assert.equal((src.match(/\.from\(/g) ?? []).length, (src.match(/\.limit\(/g) ?? []).length, "every read has a limit");
});

test("77. a query with no matches returns nothing (and never the public catalog)", async () => {
  const { res } = await run("zzzz");
  assert.deepEqual(res, []);
});

test("78. Search page: compact GET form with an accessible name and no auto-capitalize", () => {
  assert.match(SEARCH_PAGE, /<form role="search" action=\{managerHref\(id, "search"\)\} method="get"/);
  assert.match(SEARCH_PAGE, /aria-label=\{`Search \$\{name\}`\}/);
  assert.match(SEARCH_PAGE, /autoCapitalize="none"/);
  assert.match(SEARCH_PAGE, /min-h-11/);
});

test("79. Search page states: empty, too short, no results, grouped results with context", () => {
  assert.match(SEARCH_PAGE, /Search by name\. Results only come from/);
  assert.match(SEARCH_PAGE, /Type at least \{MANAGER_SEARCH_MIN\} characters\./);
  assert.match(SEARCH_PAGE, /Nothing in \{name\} matches/);
  assert.match(SEARCH_PAGE, /aria-labelledby=\{`search-\$\{g\.type\}`\}/);
  assert.match(SEARCH_PAGE, /\{r\.context\}/);
});

test("80. Search loads Conversations only for a signed-in member and only when searching", () => {
  assert.match(SEARCH_PAGE, /searching && user \? await listConversationsForUser\(admin, user\.id\) : \[\]/);
});

// ── 11. Growth / Discover ──────────────────────────────────────────────────

test("81. Discover shows its place: Opportunities / Targets / Discover, with Back to Targets", () => {
  assert.match(DISCOVER, /<nav aria-label="You are here"/);
  assert.match(DISCOVER, /<li>Opportunities<\/li>/, "Consolidation pass: Opportunities replaces the Growth destination");
  assert.match(DISCOVER, /aria-current="page"[^>]*>\s*Discover/);
  assert.match(DISCOVER, /← Back to Targets/);
});

test("82. Targets keep Add Target / Search by name and Discover / Explore what's out there", () => {
  const tv = read(`${B}/v2/TargetsView.tsx`);
  assert.match(tv, /Add Target/);
  assert.match(tv, /Search by name/);
  assert.match(tv, /Discover/);
  assert.match(tv, /Explore what(’|&rsquo;|')s out there/);
});

// ── 12. Unsaved-change guard ───────────────────────────────────────────────

test("83. guard: browser prompt on unload + confirm on in-app link taps, same-page anchors exempt", () => {
  assert.match(GUARD, /addEventListener\("beforeunload", onBeforeUnload\)/);
  assert.match(GUARD, /window\.confirm\(UNSAVED_CHANGES_MESSAGE\)/);
  assert.match(GUARD, /url\.pathname === window\.location\.pathname && url\.search === window\.location\.search\) return;/);
  assert.match(GUARD, /removeEventListener\("beforeunload"/);
  assert.match(GUARD, /form\.addEventListener\("submit", onSubmit\)/, "a save clears it");
});

test("84. guard sits where data loss is realistic: Profile, Links, Public Actions, Inquiry Settings, Event, Location", () => {
  // Details, Contact & Links, Announcement, Logo & Cover — one per form.
  assert.equal((PAGE.match(/<UnsavedChangesGuard \/>/g) ?? []).length, 4);
  assert.match(read(`${B}/CustomerInquiriesForm.tsx`), /<UnsavedChangesGuard \/>/);
  assert.equal((read("src/app/(public)/account/event/[id]/page.tsx").match(/<UnsavedChangesGuard \/>/g) ?? []).length, 2);
  assert.equal((read("src/app/(public)/account/location/[id]/page.tsx").match(/<UnsavedChangesGuard \/>/g) ?? []).length, 2);
  const pa = read("src/components/public-actions/PublicActionsEditor.tsx");
  assert.match(pa, /useUnsavedChangesGuard\(snapshot\(rows\) !== savedSnapshot\)/);
  assert.match(pa, /setSavedSnapshot\(snapshot\(rows\)\);/);
});

// ── 13. Boundaries ─────────────────────────────────────────────────────────

test("85. no schema change in this pass and Findmi casing in new copy", () => {
  const changed = execSync("git status --porcelain -- supabase/migrations", { encoding: "utf8" }).trim();
  assert.equal(changed, "", "no new or edited migration");
  for (const f of [`${B}/v2/ManagementCards.tsx`, `${B}/v2/managementCardItems.ts`, `${M}/search/page.tsx`, `${M}/inbox/page.tsx`, "src/components/inbox/InboxScopeMenu.tsx", "src/components/inbox/InboxThreadList.tsx", "src/lib/inbox.ts", "src/lib/manager-search.ts"]) {
    const code = read(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    assert.doesNotMatch(code, /FindMi|FINDMI/, f);
  }
});
