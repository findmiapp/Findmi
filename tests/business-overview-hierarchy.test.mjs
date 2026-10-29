// Business Command Center — /account/business/[id] Home (BusinessHome.tsx),
// Business Manager redesign (Findmi Consolidation pass). The Home for ONE
// Business reads: Status (+ Manage Profile / View Public Profile) →
// Management cards → section rail → Needs Attention (compact collapsed bar)
// → Requests → Follow-Ups → Happening Now → Coming Up → Growth → Performance
// → Recent Moments → Public Profile Link.
// No JSX rendering harness exists in this node:test suite, so render order
// is proven with source-level guards (indexOf comparisons), the attention
// rules by calling buildNeedsAttentionItems itself, and every Create on
// Findmi destination against the receiving route's own source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";

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

const BD = await import("../src/lib/business-dashboard.ts");
const CA = await import("../src/app/(public)/account/business/[id]/v2/createActions.ts");

const B = "src/app/(public)/account/business/[id]";
const read = (p) => readFileSync(p, "utf8");
const HOME = read(`${B}/v2/BusinessHome.tsx`);
const PAGE = read(`${B}/(manager)/page.tsx`);
const ADD = read(`${B}/v2/AddToPresence.tsx`);
const ATTENTION_BAR = read(`${B}/v2/NeedsAttentionBar.tsx`);
const GROWTH_VIEW = read(`${B}/v2/GrowthView.tsx`);
const EVENT_NEW = read("src/app/(public)/account/event/new/page.tsx");
const ACCOUNT_HOME = read("src/app/(public)/account/page.tsx");

const at = (marker) => {
  const i = HOME.indexOf(marker);
  assert.ok(i !== -1, `expected marker: ${marker}`);
  return i;
};

test("Home hierarchy: Status → Create & Manage → section rail → Happening Now → Coming Up → Inbox / Follow-Ups → Growth Manager → Performance → Public Profile", () => {
  const order = [
    'aria-label="Business status"',
    "<ManagementCards businessId={businessId} />",
    "<HomeSectionNav items={navItems} />",
    'aria-labelledby="happening-now"',
    'aria-labelledby="coming-up"',
    'aria-labelledby="home-inbox-title"',
    '<NeedsAttentionBar items={needsAttention} titleId="home-inbox-title"',
    "<HomeInboxRows",
    "<GrowthPanel",
    'aria-labelledby="performance-snapshot"',
    'aria-labelledby="findmi-link"',
  ].map(at);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], `marker #${i} out of order (${order.join(", ")})`);
  assert.doesNotMatch(HOME, /<Greeting \/>|aria-labelledby="quick-create"|const quick = |QuickActionsRail/, "management cards replace the Quick Create section and the Quick Actions rail");
  // The old large Brand Audit card, Ideas rail, Opportunities section and Recent Moments strip are gone from Home.
  assert.doesNotMatch(HOME, /BrandAuditEntry|Findmi Brand Audit|IdeasForYourBrand|HomeOpportunities|Create on Findmi|<MomentsStrip|RequestsSection|FollowUpsSection/);
  assert.match(HOME, /\{liveNow\.length > 0 && \(\s*<section aria-labelledby="happening-now">/);
});

test("Status is compact: chip + Manage Profile + View Public Profile (two different actions); explanation only where the status needs it", () => {
  const status = HOME.slice(at('aria-label="Business status"'), at("<ManagementCards"));
  assert.doesNotMatch(status, /businessName|SupabaseImage|"Pro"|"Free"/);
  assert.match(status, /<Chip tone=\{status\.tone\}>\{status\.label\}<\/Chip>/);
  assert.match(status, /href=\{managerHref\(businessId, "profile"\)\}[\s\S]*?>\s*Manage Profile\s*<\/Link>/, "prominent, never buried under More");
  assert.match(status, /\{publicationStatus === "live" \? "View Public Profile" : "Preview"\}/);
  assert.match(status, /\{status\.line && <p/);
  assert.match(HOME, /live: \{ label: "Live", tone: "aqua", line: null \}/);
  assert.match(HOME, /pending_review: \{ label: "Pending Review", tone: "amber", line: "Visible to you now, live in discovery after Findmi reviews it\." \}/);
  assert.doesNotMatch(PAGE, /business\.publication_status === "pending_review" && \(/);
  assert.match(PAGE, /publicationStatus=\{business\.publication_status\}/);
});

test("sticky section rail: in-page anchors only, no Attention entry (it is a status bar), no route changes", () => {
  const NAV = read(`${B}/v2/HomeSectionNav.tsx`);
  const items = HOME.slice(HOME.indexOf("const navItems"), HOME.indexOf("];", HOME.indexOf("const navItems")));
  assert.match(items, /\{ id: "overview", label: "Overview" \}/);
  assert.doesNotMatch(items, /Attention/, "the top-level Attention anchor is retired");
  // Overview · Our Schedule · Opportunities · Performance (unchanged labels).
  assert.match(items, /\{ id: "home-schedule", label: "Our Schedule" \}/);
  assert.doesNotMatch(items, /label: "Schedule"/, "never plain 'Schedule'");
  assert.doesNotMatch(items, /home-create|"Create"/, "creation lives on the management cards, not a Home section");
  assert.match(items, /\{ id: "home-growth", label: "Opportunities" \}/);
  assert.match(items, /\{ id: "home-performance", label: "Performance" \}/);
  assert.doesNotMatch(items, /Products|Findmi Here|More|Growth/, "never duplicates the bottom navigation");
  // every anchor target exists on Home, each with the sticky-chrome scroll margin
  for (const id of ["home-schedule", "home-performance", "home-inbox"]) assert.match(HOME, new RegExp(`id="${id}"[^>]*\\{?SECTION_CLASS|id="${id}" className=\\{\`[^\`]*\\$\\{SECTION_CLASS\\}`), id);
  assert.match(HOME, /const SECTION_CLASS = "scroll-mt-\[104px\]";/);
  // sticky directly under the 48px owner header, ~44px tall, rail-internal horizontal scroll
  assert.match(NAV, /className=\{`sticky top-12 z-30 [^`]*bg-paper /, "opaque, so content never shows through");
  assert.match(NAV, /data-stuck=\{stuck \|\| undefined\}/, "a soft edge once pinned");
});

test("Create sheet: five actions in the intentional order (ONE Event entry), each with icon + title + one explanatory line", () => {
  const actions = CA.orderedCreateActions("/account/business/biz", "biz");
  assert.deepEqual(actions.map((x) => x.label), ["Add An Event", "At a Location", "Add To Product Catalog", "Add a Moment", "Create A QR Code"]);
  assert.deepEqual(actions.map((x) => x.icon), ["calendar", "pin", "tag", "moment", "qr"]);
  assert.deepEqual(actions.map((x) => x.description), [
    "Something you’re hosting, or an Event you’re appearing at.",
    "Add a place customers can regularly find your Business.",
    "Add something people can discover from your Business.",
    "Document something your Business experienced.",
    "Create a trackable QR code for your Business or campaign.",
  ]);
  for (const a of actions) {
    assert.ok(a.detail.length > 0 && a.description.length <= 70, a.key);
    assert.doesNotMatch(a.description + a.detail, /Appearance record|Occurrence|entity|foreign key/i);
  }
  const all = actions.map((a) => a.label).join(" ") + read(`${B}/v2/createActions.ts`);
  // The product owner's Account revision adopted At a Location / Add To Product
  // Catalog / Create A QR Code as the owner-facing labels; "Appearance" is never one.
  assert.doesNotMatch(all, /Go Somewhere|Host Something/);
  assert.doesNotMatch(actions.map((a) => a.label).join(" "), /Appearance/);
});

test("participating vs organizing: ONE Event entry, then Hosting An Event (organizing) / Appearing At An Event (taking part in someone else's)", () => {
  const a = CA.businessCreateActions("/b", "x");
  assert.match(a.where.description + a.where.detail, /participating in/);
  assert.doesNotMatch(a.where.description + a.where.detail, /organiz/);
  assert.equal(a.where.detail, "Add a festival, market, retailer sampling, trade show, pop-up or other event your Business is participating in.");
  assert.match(a.event.detail, /Hosting your own Event, or appearing at/);
  const chooser = read(`${B}/v2/AddEventChooser.tsx`);
  assert.match(chooser, /title: "Hosting An Event", copy: "An Event your Business is organizing\."/);
  assert.match(chooser, /title: "Appearing At An Event", copy: "An Event or experience someone else is hosting that your Business will participate in\."/);
});

test("Management cards: Events · Locations · Products · QR Codes · Moments · Targets — manage (View All) and create (+ Add) as distinct actions, never asking which Business", () => {
  const CARDS = read(`${B}/v2/ManagementCards.tsx`);
  const ITEMS = read(`${B}/v2/managementCardItems.ts`);
  assert.match(ITEMS, /MANAGEMENT_CARD_ORDER: ManagementCardKey\[\] = \["events", "locations", "products", "qr", "moments", "targets"\]/);
  assert.match(ITEMS, /businessCreateActions\(/, "built on the shared create definitions");
  assert.doesNotMatch(ITEMS, /choose.*business|which business/i);
  assert.match(CARDS, /<h2 id="create-manage-title"[^>]*>\s*Create &amp; Manage\s*<\/h2>/);
  assert.match(CARDS, /<nav aria-label="Create And Manage" className="mt-2">/);
  assert.match(CARDS, /snap-x snap-mandatory[^"]*md:grid md:snap-none md:grid-cols-3[^"]*xl:grid-cols-6/, "one compact swipe rail on phones, a grid from md up");
  assert.match(CARDS, /rounded-2xl border border-black\/\[0\.08\] bg-white/, "rounded card, subtle light-gray border");
  assert.match(CARDS, /bg-findmi-50 px-1 text-\[12px\] font-bold text-findmi-700/, "+ Add: pale Aqua pill");
  assert.match(CARDS, /bg-black\/\[0\.03\] px-1 text-\[12px\] font-semibold text-secondary/, "View All: neutral pill");
  assert.match(CARDS, /<div className="mt-auto flex gap-1\.5 pt-2">/, "+ Add and View All share one row");
});

test("route integrity: every creation destination is an existing Business-scoped flow that reads its params", () => {
  const a = CA.businessCreateActions("/account/business/biz", "biz");
  assert.equal(a.where.href, "/account/business/biz?tab=findmi-here&compose=1");
  assert.match(PAGE, /const composeOpen = composeIntent === "appearing";/);
  assert.match(PAGE, /\{\(addHasDraft \|\| composeOpen\) && \(\s*<div id="going-somewhere"/);
  assert.equal(a.event.href, "/account/business/biz?tab=findmi-here&add=event");
  assert.match(PAGE, /if \(composeIntent === "hosting"\) redirect\(hostEventHref\(id\)\);/, "Hosting An Event → the canonical Host an Event page");
  assert.match(EVENT_NEW, /business_id: businessIdParam,/);
  assert.match(EVENT_NEW, /<input type="hidden" name="business_id" value=\{businessContext\.id\} \/>/);
  assert.equal(a.location.href, "/account/business/biz?tab=findmi-here&view=locations&add=1");
  assert.match(PAGE, /addOpen=\{addParam === "1"\}/);
  assert.equal(a.product.href, "/account/business/biz?tab=products&compose=1");
  assert.match(PAGE, /<details className="group" open=\{addProductHasDraft \|\| composeOpen\}>/);
  assert.equal(a.moment.href, "/my-world/journal/new?business=biz&postAs=biz");
  const journal = read("src/app/(public)/my-world/journal/new/page.tsx");
  assert.match(journal, /resolvePrefillBusiness\(params\.business\)/);
  assert.match(journal, /fromBusinessId: params\.postAs \?\? null/);
  assert.equal(a.qr.href, "/account/business/biz/qr/new");
  assert.ok(existsSync(`${B}/qr/new/page.tsx`));
  assert.match(read(`${B}/qr/new/page.tsx`), /await requireBusinessMember\(id\);/);
  assert.equal(CA.businessCreateActions("/b", "a b").event.href, "/b?tab=findmi-here&add=event");
  for (const tab of ["products", "qr"]) assert.match(PAGE, new RegExp(`\\{activeTab === "${tab}" && \\(`));
});

test("one definition + one icon system: Home rail, + sheet and More menu share label, icon and route", () => {
  assert.match(ADD, /const doOptions = orderedCreateActions\(basePath, businessId\)\.map\(\(a\) =>\s*option\(a\.href, a\.label, a\.detail, <CreateActionIcon icon=\{a\.icon\} \/>\)/);
  assert.doesNotMatch(ADD, /\/account\/event\/new|journal\/new|tab=findmi-here|tab=products/, "no locally re-typed routes");
  assert.match(read(`${B}/v2/MoreMenu.tsx`), /import \{ QrGlyph \} from "\.\/CreateActionIcon";/);
  assert.doesNotMatch(read(`${B}/v2/MoreMenu.tsx`), /function QrGlyph/);
  assert.match(read(`${B}/v2/PresenceViews.tsx`), /\+ Add a Location/);
  assert.match(PAGE, /"\+ Add a Product"/);
  // Identity capabilities: Business context "Host an Event"; Location
  // context names the Location; no Personal "Add An Event" form.
  assert.match(EVENT_NEW, /\{businessContext \? "Host an Event" : `Create An Event At \$\{managedLocation\?\.name \?\? "Your Location"\}`\}/, "Business vs Location context labels stay distinct");
});

// ── Needs Attention rules (real function) ─────────────────────────────────
const base = { businessId: "biz", hasPrimaryMarket: true, pendingMarketRequestText: null, upcomingAppearances: [], newOrderCount: 0, profileIncomplete: false };

test("complete profile, geography assigned, nothing pending → no attention items (section omitted)", () => {
  assert.deepEqual(BD.buildNeedsAttentionItems(base), []);
  // The bar itself renders nothing at zero.
  assert.match(ATTENTION_BAR, /const count = items\.length;[\s\S]*\{count > 0 && \([\s\S]*\{count > 0 && open && \(/);
});

test("Needs Attention is a compact count in the Inbox heading: collapsed by default, count badge, tap expands the items inline", () => {
  assert.match(ATTENTION_BAR, /"use client";/);
  assert.match(ATTENTION_BAR, /const \[open, setOpen\] = useState\(false\);/, "collapsed by default");
  assert.match(ATTENTION_BAR, /aria-expanded=\{open\}/);
  assert.match(ATTENTION_BAR, /aria-controls=\{panelId\}/);
  assert.match(ATTENTION_BAR, /onClick=\{\(\) => setOpen\(\(v\) => !v\)\}/, "the whole row toggles");
  assert.match(ATTENTION_BAR, />\s*Needs Attention\s*<\/span>/);
  assert.match(ATTENTION_BAR, /rounded-full bg-amber-500/, "small circular count badge");
  assert.match(ATTENTION_BAR, /<ChevronIcon direction="down" className=\{`[^`]*\$\{open \? "rotate-180" : ""\}`\}/, "chevron that rotates");
  assert.match(ATTENTION_BAR, /\{count > 0 && open && \(\s*<ul id=\{panelId\}/, "items only when expanded");
  assert.match(ATTENTION_BAR, /href=\{item\.actionHref\}/, "each item keeps its existing CTA");
  // Detection/logic is untouched: Home still feeds the same items.
  assert.match(PAGE, /needsAttention=\{needsAttention\}/);
});

test("a Business with NO geography is valid: no attention item and never 'won't appear in general discovery'", () => {
  assert.deepEqual(BD.buildNeedsAttentionItems({ ...base, hasPrimaryMarket: false }), []);
  const src = read("src/lib/business-dashboard.ts");
  assert.doesNotMatch(src, /general discovery|No Findmi Market is assigned yet/);
  assert.doesNotMatch(HOME + PAGE, /won['’]t appear in general discovery|won&rsquo;t appear in general discovery/);
  // Settings: a missing area is described as optional, never as lost discovery
  assert.match(PAGE, /A Findmi area is optional\. It places your business in that area&rsquo;s browsing\./);
  assert.doesNotMatch(PAGE, /receives general discovery|live in the meantime/);
});

test("a pending Area request waits on Findmi, not the Business — it is not a Needs Attention item", () => {
  const items = BD.buildNeedsAttentionItems({ ...base, hasPrimaryMarket: false, pendingMarketRequestText: "Hudson Valley" });
  assert.deepEqual(items, []);
});

test("incomplete profile → Complete Profile; either description satisfies it (no new requirements)", () => {
  const items = BD.buildNeedsAttentionItems({ ...base, profileIncomplete: true });
  assert.deepEqual(items.map((i) => [i.id, i.title, i.actionLabel, i.actionHref]), [["incomplete-profile", "Complete Your Profile", "Complete Profile", "/account/business/biz?tab=profile"]]);
  // what / why / action, from the same three signals (logo → description → category)
  const logo = BD.buildNeedsAttentionItems({ ...base, profileIncomplete: true, missingProfile: { logo: true, description: true, category: false } })[0];
  assert.deepEqual([logo.message, logo.actionLabel], ["Add a logo so people can recognize your Business across Findmi.", "Add Logo"]);
  const desc = BD.buildNeedsAttentionItems({ ...base, profileIncomplete: true, missingProfile: { logo: false, description: true, category: true } })[0];
  assert.equal(desc.actionLabel, "Add Description");
  const cat = BD.buildNeedsAttentionItems({ ...base, profileIncomplete: true, missingProfile: { logo: false, description: false, category: true } })[0];
  assert.equal(cat.actionLabel, "Choose Category");
  assert.match(PAGE, /missingProfile: \{\s*logo: !business\.logo_url,\s*description: !\(business\.short_description \|\| business\.description\),\s*category: !currentCategoryId,\s*\}/);
  assert.match(PAGE, /const profileIncomplete = !business\.logo_url \|\| !\(business\.short_description \|\| business\.description\) \|\| !currentCategoryId;/);
});

test("new Orders and Event Invitations are Requests now — never Needs Attention items", () => {
  assert.deepEqual(BD.buildNeedsAttentionItems({ ...base, newOrderCount: 2 }), []);
  assert.doesNotMatch(HOME, /event-invitations|pendingInvitationCount|newOrderCount/);
  assert.match(PAGE, /invitations: pendingInvitations,\s*newOrderCount: orderSummary\.newCount,/);
});

// ── Coming Up / Opportunities / Performance ───────────────────────────────
test("every attention item has a title (what), a message (why) and an action", () => {
  const all = BD.buildNeedsAttentionItems({
    ...base,
    hasPrimaryMarket: false,
    pendingMarketRequestText: "Hudson Valley",
    newOrderCount: 1,
    profileIncomplete: true,
  });
  for (const i of all) assert.ok(i.title && i.message && i.actionLabel && i.actionHref, i.id);
  assert.match(ATTENTION_BAR, /\{item\.title\}/);
  assert.match(ATTENTION_BAR, /\{item\.message\}/);
  assert.match(ATTENTION_BAR, /\{item\.actionLabel\}/);
});

test("Schedule: Happening Now (only when live) then a Coming Up rail; a compact empty state that routes to Add Event", () => {
  assert.match(PAGE, /comingUp=\{homeActivities\.comingUp\}/);
  assert.match(PAGE, /liveActivities=\{homeActivities\.live\}/);
  assert.match(PAGE, /const homeActivities = buildHomeComingUp\(\s*dashboardAppearances,\s*hostedUpcoming\.map\(/);
  const sched = HOME.slice(at('id="home-schedule"'), at('id="home-inbox"'));
  assert.ok(sched.indexOf("<LiveCard") < sched.indexOf("<UpcomingCard"));
  assert.match(sched, /\{liveNow\.length > 0 \? "Nothing else scheduled yet" : "Nothing scheduled yet"\}/);
  assert.match(sched, /href=\{managerHref\(businessId, "add-event"\)\}/, "the empty state routes to the one Add Event chooser (Hosting / Appearing At)");
  assert.doesNotMatch(sched, /CreateActionIcon/);
});

test("Growth (Home mini-dashboard + Growth tab): existing data only, never Pro-gated, no fabricated metrics", () => {
  assert.match(HOME, /<GrowthPanel basePath=\{basePath\} summary=\{growth\} \/>/);
  assert.doesNotMatch(GROWTH_VIEW, /\bpro\b/);
  const panel = read("src/app/(public)/account/business/[id]/v2/GrowthPanel.tsx");
  assert.doesNotMatch(panel, /\bpro\b/);
  assert.match(panel, /growthDestinationStatus\(summary, key\)/, "real counts only");
  assert.match(panel, /href=\{growthHref\(basePath, key\)\}/, "each tile opens its existing Growth destination");
  assert.match(GROWTH_VIEW, /<GoalsSection /);
  assert.match(GROWTH_VIEW, /eligibleGrowthIdeas\(ideas, summary\.hasSignal\)/);
  assert.match(PAGE, /<GrowthGoalsView\s/);
  assert.match(PAGE, /<GrowthIdeasView\s/);
});

test("Performance: existing metrics + Free/Pro gating; all-zero explains itself instead of four zeros", () => {
  const perf = HOME.slice(at('aria-labelledby="performance-snapshot"'), at('aria-labelledby="findmi-link"'));
  assert.match(perf, /linkLabel=\{pro \? "View All" : "Unlock Full Analytics"\}/);
  assert.match(perf, /<Suspense fallback=\{<HomePerformanceSkeleton \/>\}>/);
  const TILES = read(`${B}/v2/HomePerformance.tsx`);
  assert.match(TILES, /\{ key: "impressions", label: "Impressions", metric: headline\.impressions \}/);
  assert.match(TILES, /\{ key: "views", label: "Profile Views", metric: headline\.profileViews \}/);
  assert.match(TILES, /label: headline\.actionsTaken\.value === 1 \? "Action" : "Actions"/, "1 Action, 0/N Actions");
  assert.match(TILES, /\{ key: "followers", label: "Followers", metric: \{ value: followers, changeLabel: null \} \}/);
  assert.match(TILES, /metrics\.every\(\(m\) => m\.metric\.value === 0\) \? \(/);
  assert.match(TILES, /No activity yet\./);
  assert.match(TILES, /const change = pro \? metric\.changeLabel : null;/, "period change stays Pro");
});

test("Public Profile is ONE compact utility panel (link + Copy Link / Change, Manage Profile, Photos); claim/copy/change preserved", () => {
  const util = HOME.slice(at('aria-labelledby="findmi-link"'));
  assert.match(util, /^aria-labelledby="findmi-link" className="rounded-xl border border-black\/\[0\.07\] bg-white px-3 py-2">/);
  assert.match(util, />\s*Public Profile\s*<\/h2>/);
  assert.match(util, /href=\{managerHref\(businessId, "profile"\)\}[^>]*>\s*Manage Profile\s*</);
  assert.match(util, /href=\{managerHref\(businessId, "gallery"\)\}[^>]*>\s*Photos\s*</);
  assert.match(util, /currentHandle=\{businessHandle\} action=\{updateHandleAction\} compact \/>/);
  const CARD = read("src/components/FindmiUrlCard.tsx");
  assert.match(CARD, /const \[editing, setEditing\] = useState\(!currentHandle && !compact\);/);
  assert.match(CARD, /Create Link/);
  assert.match(CARD, /label="Copy Link"/);
  assert.match(CARD, /\{!compact && <p className="text-xs font-bold uppercase tracking-wide text-ink\/40">Findmi URL<\/p>\}/, "other callers unchanged");
});

test("BusinessHome stays a pure presentation component; /account Home is not turned into a Business dashboard", () => {
  assert.doesNotMatch(HOME, /\bawait\b|\bfetch\(|\bsupabase\b|createClient/i);
  assert.doesNotMatch(HOME, /isBusinessPro|plan_tier|plan_expires_at/);
  assert.doesNotMatch(ACCOUNT_HOME, /orderedCreateActions|BusinessHome|HomeSectionNav/);
  // The two streamed modules read through the cached, already-authorized manager context.
  for (const f of ["HomeInbox.tsx", "HomePerformance.tsx"]) assert.match(read(`${B}/v2/${f}`), /await getManagerCore\(businessId\)/, f);
});
