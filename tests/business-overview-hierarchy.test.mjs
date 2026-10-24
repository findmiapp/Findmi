// Business Command Center — /account/business/[id] Home (BusinessHome.tsx),
// Business Manager redesign. The Home for ONE Business reads: Status → sticky
// Quick Actions rail → section rail → Needs Attention (compact collapsed bar)
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

test("Home hierarchy: Status → Quick Actions → section rail → Needs Attention → Requests → Follow-Ups → Happening Now → Coming Up → Growth → Performance → Moments → Public Profile", () => {
  const order = [
    'aria-label="Business status"',
    "<QuickActionsRail businessId={businessId} />",
    "<HomeSectionNav items={navItems} />",
    "<NeedsAttentionBar items={needsAttention} />",
    "<RequestsSection basePath={basePath} items={requests} expanded={requestsExpanded} />",
    "<FollowUpsSection basePath={basePath} items={followUps} expanded={followUpsExpanded} />",
    'aria-labelledby="happening-now"',
    'aria-labelledby="coming-up"',
    "<GrowthPanel",
    'aria-labelledby="performance-snapshot"',
    "<MomentsStrip",
    'aria-labelledby="findmi-link"',
  ].map(at);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], `marker #${i} out of order (${order.join(", ")})`);
  assert.doesNotMatch(HOME, /<Greeting \/>|aria-labelledby="quick-create"|const quick = /, "the Quick Create section is replaced by the Quick Actions rail");
  // conditional sections disappear, never render empty
  // The old large Brand Audit card, Ideas rail and Opportunities section are gone from Home.
  assert.doesNotMatch(HOME, /BrandAuditEntry|Findmi Brand Audit|IdeasForYourBrand|HomeOpportunities|Create on Findmi/);
  assert.match(HOME, /\{liveNow\.length > 0 && \(\s*<section aria-labelledby="happening-now">/);
});

test("Status is compact: chip + View Public Profile; explanation only where the status needs it", () => {
  const status = HOME.slice(at('aria-label="Business status"'), at("<QuickActionsRail"));
  assert.doesNotMatch(status, /businessName|SupabaseImage|"Pro"|"Free"/);
  assert.match(status, /<Chip tone=\{status\.tone\}>\{status\.label\}<\/Chip>/);
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
  assert.match(items, /\{ id: "home-schedule", label: "Schedule" \}/);
  assert.doesNotMatch(items, /home-create|"Create"/, "creation lives in the Quick Actions rail, not a Home section");
  assert.match(items, /\{ id: "home-growth", label: "Growth" \}/);
  assert.match(items, /metrics \? \[\{ id: "home-performance", label: "Performance" \}\] : \[\]/);
  assert.doesNotMatch(items, /Products|Opportunities|Findmi Here|More/, "never duplicates the bottom navigation");
  // every anchor target exists on Home, each with the sticky-chrome scroll margin
  for (const id of ["home-schedule", "home-performance"]) assert.match(HOME, new RegExp(`id="${id}"[^>]*\\{?SECTION_CLASS|id="${id}" className=\\{\`[^\`]*\\$\\{SECTION_CLASS\\}`), id);
  assert.match(HOME, /const SECTION_CLASS = "scroll-mt-\[104px\]";/);
  // sticky directly under the 48px owner header, ~44px tall, rail-internal horizontal scroll
  assert.match(NAV, /className="sticky top-12 z-30 /);
  assert.match(NAV, /export const HOME_SECTION_STICKY_TOP = 48;/);
  assert.match(NAV, /flex h-11 snap-x snap-mandatory scroll-px-3 items-center gap-1 overflow-x-auto px-3/);
  assert.match(NAV, /flex h-8 shrink-0 snap-start items-center/);
  assert.match(NAV, /<span ref=\{spacerRef\} aria-hidden="true" className="h-px shrink-0" \/>/, "end stop is a chip boundary");
  assert.match(NAV, /spacer\.style\.width = `\$\{Math\.max\(0, stop \+ rail\.clientWidth - lastEnd - padRight - gap\)\}px`;/);
  assert.match(NAV, /target = snapPoints\.find\(\(p\) => chipEnd \+ padRight <= p \+ rail\.clientWidth\) \?\? max;/, "auto-scroll rests on a chip boundary");
  assert.match(read("src/components/OwnerHeader.tsx"), /<div className="h-\[3px\] bg-findmi" \/>\s*<div className="flex h-11 /, "header = 3px strip + 44px bar + 1px border");
  // anchors: preventDefault + smooth scroll; Overview → top; reduced motion respected
  assert.match(NAV, /href=\{`#\$\{item\.id\}`\}/);
  assert.match(NAV, /e\.preventDefault\(\);/);
  assert.match(NAV, /window\.scrollTo\(\{ top: 0,/);
  assert.match(NAV, /scrollIntoView\(\{ behavior: smooth \? "smooth" : "auto", block: "start" \}\)/);
  assert.match(NAV, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(NAV, /next\/link|router\.push|useRouter/, "never route-changing");
  // active state follows scrolling (rAF-throttled, cleaned up)
  assert.match(NAV, /window\.addEventListener\("scroll", onScroll, \{ passive: true \}\);/);
  assert.match(NAV, /window\.removeEventListener\("scroll", onScroll\);/);
  assert.match(NAV, /aria-current=\{isActive \? "location" : undefined\}/);
  // a tapped section stays active until its smooth scroll settles (short pages)
  assert.match(NAV, /lockRef\.current = \{ id, timer: window\.setTimeout\(\(\) => \(lockRef\.current = null\), 600\) \};/);
  assert.match(NAV, /if \(lock\) \{[\s\S]*?return;\s*\}/);
});

test("Create sheet: six actions in the intentional order, each with icon + title + one explanatory line", () => {
  const actions = CA.orderedCreateActions("/account/business/biz", "biz");
  assert.deepEqual(actions.map((x) => x.label), ["Where I\u2019ll Be", "Host an Event", "At a Location", "Add To Product Catalog", "Add a Moment", "Create A QR Code"]);
  assert.deepEqual(actions.map((x) => x.icon), ["compass", "calendar", "pin", "tag", "moment", "qr"]);
  assert.deepEqual(actions.map((x) => x.description), [
    "Add something your Business is participating in.",
    "Create something your Business is organizing.",
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

test("participating vs organizing: Where I'll Be = taking part in someone else's; Host an Event = organizing", () => {
  const a = CA.businessCreateActions("/b", "x");
  assert.match(a.where.description + a.where.detail, /participating in/);
  assert.doesNotMatch(a.where.description + a.where.detail, /organiz/);
  assert.match(a.event.description + a.event.detail, /organizing/);
  assert.doesNotMatch(a.event.description + a.event.detail, /participat/);
  assert.equal(a.where.detail, "Add a festival, market, retailer sampling, trade show, pop-up or other event your Business is participating in.");
  assert.equal(a.event.detail, "Create an activation, pop-up, tasting, class, launch or other Event your Business is organizing.");
});

test("Quick Actions rail: thin swipeable aqua circles from the shared definitions, never asking which Business", () => {
  const RAIL = read(`${B}/v2/QuickActionsRail.tsx`);
  const QA = read(`${B}/v2/quickActions.ts`);
  assert.match(RAIL, /<nav aria-label="Quick Actions"/);
  assert.match(RAIL, /overflow-x-auto/);
  assert.match(RAIL, /bg-findmi-50/);
  assert.match(QA, /businessCreateActions\(/, "built on the shared create definitions");
  assert.doesNotMatch(QA, /choose.*business|which business/i);
});

test("route integrity: every creation destination is an existing Business-scoped flow that reads its params", () => {
  const a = CA.businessCreateActions("/account/business/biz", "biz");
  assert.equal(a.where.href, "/account/business/biz?tab=findmi-here&compose=1");
  assert.match(PAGE, /const composeOpen = composeParam === "1";/);
  assert.match(PAGE, /\{\(addHasDraft \|\| composeOpen\) && \(\s*<div id="going-somewhere"/);
  assert.equal(a.event.href, "/account/event/new?business_id=biz");
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
  assert.equal(CA.businessCreateActions("/b", "a b").event.href, "/account/event/new?business_id=a%20b");
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
  assert.match(ATTENTION_BAR, /if \(items\.length === 0\) return null;/);
});

test("Needs Attention is a compact status bar: collapsed by default, count badge, circular chevron, tap expands inline", () => {
  assert.match(ATTENTION_BAR, /"use client";/);
  assert.match(ATTENTION_BAR, /const \[open, setOpen\] = useState\(false\);/, "collapsed by default");
  assert.match(ATTENTION_BAR, /aria-expanded=\{open\}/);
  assert.match(ATTENTION_BAR, /aria-controls=\{panelId\}/);
  assert.match(ATTENTION_BAR, /onClick=\{\(\) => setOpen\(\(v\) => !v\)\}/, "the whole row toggles");
  assert.match(ATTENTION_BAR, /Needs Attention<\/span>/);
  assert.match(ATTENTION_BAR, /rounded-full bg-amber-500/, "small circular count badge");
  assert.match(ATTENTION_BAR, /rounded-full bg-white[^"]*"[^>]*>\s*<ChevronIcon direction="down" className=\{`[^`]*\$\{open \? "rotate-180" : ""\}`\}/, "circular chevron that rotates");
  assert.match(ATTENTION_BAR, /\{open && \(\s*<ul id=\{panelId\}/, "items only when expanded");
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

test("Schedule: Happening Now (only when live) then Coming Up; a compact empty state that never repeats Quick Create", () => {
  assert.match(PAGE, /comingUp=\{homeActivities\.comingUp\}/);
  assert.match(PAGE, /liveActivities=\{homeActivities\.live\}/);
  assert.match(PAGE, /const homeActivities = buildHomeComingUp\(\s*dashboardAppearances,\s*hostedUpcoming\.map\(/);
  const sched = HOME.slice(at('id="home-schedule"'), at("<MomentsStrip"));
  assert.ok(sched.indexOf("<LiveCard") < sched.indexOf("<UpcomingRow"));
  assert.match(sched, /<p className="mt-2 text-body text-muted">\{liveNow\.length > 0 \? "Nothing else scheduled yet\." : "Nothing scheduled yet\."\}<\/p>/);
  assert.doesNotMatch(sched, /create\.where|create\.event|CreateActionIcon/, "Where I'll Be / Host An Event live in Quick Create only");
});

test("Growth (Home mini-dashboard + Growth tab): existing data only, never Pro-gated, no fabricated metrics", () => {
  assert.match(HOME, /<GrowthPanel basePath=\{basePath\} summary=\{growth\} \/>/);
  assert.doesNotMatch(GROWTH_VIEW, /\bpro\b/);
  const panel = read("src/app/(public)/account/business/[id]/v2/GrowthPanel.tsx");
  assert.doesNotMatch(panel, /\bpro\b/);
  assert.match(panel, /GROWTH_DESTINATIONS/, "Home exposes all three destinations from the shared definition");
  assert.match(panel, /growthDestinationStatus\(/, "real counts only");
  assert.match(GROWTH_VIEW, /<GoalsSection /);
  assert.match(GROWTH_VIEW, /eligibleGrowthIdeas\(ideas, summary\.hasSignal\)/);
  assert.match(PAGE, /<GrowthGoalsView\s/);
  assert.match(PAGE, /<GrowthIdeasView\s/);
});

test("Performance: existing metrics + Free/Pro gating; all-zero explains itself instead of four zeros", () => {
  const perf = HOME.slice(at('aria-labelledby="performance-snapshot"'), at('aria-labelledby="findmi-link"'));
  for (const l of ["Views", "Scans"]) assert.match(perf, new RegExp(`<MetricTile label="${l}"`));
  assert.match(perf, /<MetricTile label=\{metrics\.actionsTaken\.value === 1 \? "Action" : "Actions"\} metric=\{metrics\.actionsTaken\}/, "1 Action, 0/N Actions");
  assert.match(perf, /linkLabel=\{pro \? "View Performance" : "Unlock Full Analytics"\}/);
  assert.match(perf, /metrics\.profileViews\.value \+ metrics\.actionsTaken\.value \+ metrics\.qrScans\.value \+ metrics\.followers === 0 \? \(/);
  assert.match(perf, /No activity yet\./);
  assert.match(HOME, /const change = pro \? metric\.changeLabel : null;/);
});

test("Public Profile link is a compact utility row, not a major section; claim/copy/change preserved", () => {
  const util = HOME.slice(at('aria-labelledby="findmi-link"'));
  assert.match(util, /text-label font-bold uppercase text-subtle">\s*Public Profile Link/);
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
});
