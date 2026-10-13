// Business Command Center — /account/business/[id] Home (BusinessHome.tsx),
// final UX pass. The Home for ONE Business reads: Status → sticky section
// rail → Needs Attention → Happening Now → Coming Up → Create on Findmi →
// Opportunities For You → Performance → Public Profile Link.
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
const PAGE = read(`${B}/page.tsx`);
const ADD = read(`${B}/v2/AddToPresence.tsx`);
const EVENT_NEW = read("src/app/(public)/account/event/new/page.tsx");
const ACCOUNT_HOME = read("src/app/(public)/account/page.tsx");

const at = (marker) => {
  const i = HOME.indexOf(marker);
  assert.ok(i !== -1, `expected marker: ${marker}`);
  return i;
};

test("Home hierarchy: Status → section rail → Needs Attention → Happening Now → Coming Up → Create → Opportunities → Performance → Public Profile", () => {
  const order = [
    'aria-label="Business status"',
    "<HomeSectionNav items={navItems} />",
    'aria-labelledby="needs-attention"',
    'aria-labelledby="happening-now"',
    'aria-labelledby="coming-up"',
    'aria-labelledby="create-on-findmi"',
    "<HomeOpportunities",
    'aria-labelledby="performance-snapshot"',
    'aria-labelledby="findmi-link"',
  ].map(at);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], `marker #${i} out of order (${order.join(", ")})`);
  assert.doesNotMatch(HOME, /<Greeting \/>|aria-label="Quick actions"/);
  // conditional sections disappear, never render empty
  assert.match(HOME, /\{attention\.length > 0 && \(\s*<section id="home-attention"/);
  assert.match(HOME, /\{liveNow\.length > 0 && \(\s*<section aria-labelledby="happening-now">/);
});

test("Status is compact: chip + View Public Profile; explanation only where the status needs it", () => {
  const status = HOME.slice(at('aria-label="Business status"'), at("<HomeSectionNav"));
  assert.doesNotMatch(status, /businessName|SupabaseImage|"Pro"|"Free"/);
  assert.match(status, /<Chip tone=\{status\.tone\}>\{status\.label\}<\/Chip>/);
  assert.match(status, /\{publicationStatus === "live" \? "View Public Profile" : "Preview"\}/);
  assert.match(status, /\{status\.line && <p/);
  assert.match(HOME, /live: \{ label: "Live", tone: "aqua", line: null \}/);
  assert.match(HOME, /pending_review: \{ label: "Pending Review", tone: "amber", line: "Visible to you now, live in discovery after Findmi reviews it\." \}/);
  assert.doesNotMatch(PAGE, /business\.publication_status === "pending_review" && \(/);
  assert.match(PAGE, /publicationStatus=\{business\.publication_status\}/);
});

test("sticky section rail: in-page anchors only, Attention only with items (with its count), no route changes", () => {
  const NAV = read(`${B}/v2/HomeSectionNav.tsx`);
  const items = HOME.slice(HOME.indexOf("const navItems"), HOME.indexOf("];", HOME.indexOf("const navItems")));
  assert.match(items, /\{ id: "overview", label: "Overview" \}/);
  assert.match(items, /attention\.length > 0 \? \[\{ id: "home-attention", label: "Attention", count: attention\.length \}\] : \[\]/);
  assert.match(items, /\{ id: "home-schedule", label: "Schedule" \}/);
  assert.match(items, /\{ id: "home-create", label: "Create" \}/);
  assert.match(items, /metrics \? \[\{ id: "home-performance", label: "Performance" \}\] : \[\]/);
  assert.doesNotMatch(items, /Products|Opportunities|Findmi Here|More/, "never duplicates the bottom navigation");
  // every anchor target exists on Home, each with the sticky-chrome scroll margin
  for (const id of ["home-attention", "home-schedule", "home-create", "home-performance"]) assert.match(HOME, new RegExp(`id="${id}"[^>]*\\{?SECTION_CLASS|id="${id}" className=\\{\`[^\`]*\\$\\{SECTION_CLASS\\}`), id);
  assert.match(HOME, /const SECTION_CLASS = "scroll-mt-\[104px\]";/);
  // sticky directly under the 48px owner header, ~44px tall, rail-internal horizontal scroll
  assert.match(NAV, /className="sticky top-12 z-30 /);
  assert.match(NAV, /export const HOME_SECTION_STICKY_TOP = 48;/);
  assert.match(NAV, /flex h-11 items-center gap-1 overflow-x-auto/);
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

test("Create on Findmi: six actions in the intentional order, each with icon + title + one explanatory line", () => {
  const actions = CA.orderedCreateActions("/account/business/biz", "biz");
  assert.deepEqual(actions.map((x) => x.label), ["Where I\u2019ll Be", "Host an Event", "Add a Location", "Add a Product", "Add a Moment", "Create a QR Code"]);
  assert.deepEqual(actions.map((x) => x.icon), ["compass", "calendar", "pin", "tag", "moment", "qr"]);
  assert.deepEqual(actions.map((x) => x.description), [
    "Tell people where they can find you in person.",
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
  assert.doesNotMatch(all, /Go Somewhere|Host Something|At a Location|Add To Product Catalog|Create A QR Code/);
});

test("Create rail: horizontal, compact cards (no title wrap), next card peeks; View All opens the existing + sheet", () => {
  const create = HOME.slice(at('aria-labelledby="create-on-findmi"'), at("<HomeOpportunities"));
  assert.match(create, /\{orderedCreateActions\(basePath, businessId\)\.map\(\(action\) => \(/);
  assert.match(create, /<ul className=\{`mt-3 \$\{RAIL_CLASS\} lg:grid lg:grid-cols-3 lg:overflow-visible`\}>/);
  assert.match(HOME, /const RAIL_CLASS =\s*"-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4/);
  assert.match(create, /className="w-\[min\(15\.5rem,72vw\)\] shrink-0 snap-start lg:w-auto"/, "< full width → the next card peeks");
  assert.match(create, /<span className="min-w-0 truncate text-card-title font-semibold text-primary">\{action\.label\}<\/span>/, "one-line title");
  assert.match(create, /<span className="line-clamp-2 text-metadata text-muted">\{action\.description\}<\/span>/);
  assert.match(create, /<CreateActionIcon icon=\{action\.icon\}/);
  assert.match(create, /<AddToPresence basePath=\{basePath\} businessId=\{businessId\} variant="link" \/>/);
  assert.match(ADD, /variant === "link" \? \(/);
  assert.match(ADD, /View All/);
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
  assert.equal(a.moment.href, "/my-world/journal/new?business=biz");
  const journal = read("src/app/(public)/my-world/journal/new/page.tsx");
  assert.match(journal, /resolvePrefillBusiness\(params\.business\)/);
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
  assert.match(EVENT_NEW, /\{businessContext \? "Host an Event" : "Add An Event"\}/, "global vs Business context labels stay distinct");
});

// ── Needs Attention rules (real function) ─────────────────────────────────
const base = { businessId: "biz", hasPrimaryMarket: true, pendingMarketRequestText: null, upcomingAppearances: [], newOrderCount: 0, profileIncomplete: false };

test("complete profile, geography assigned, nothing pending → no attention items (section omitted)", () => {
  assert.deepEqual(BD.buildNeedsAttentionItems(base), []);
  assert.match(HOME, /\{attention\.length > 0 && \(\s*<section id="home-attention" aria-labelledby="needs-attention"/);
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

test("the owner's own pending Market Request is still surfaced", () => {
  const items = BD.buildNeedsAttentionItems({ ...base, hasPrimaryMarket: false, pendingMarketRequestText: "Hudson Valley" });
  assert.deepEqual(items.map((i) => i.id), ["pending-market"]);
  assert.match(items[0].message, /"Hudson Valley" is awaiting review/);
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

test("new Orders are ONE attention item (the duplicate Order tile is gone); pending Event Invitations join the list", () => {
  assert.equal(BD.buildNeedsAttentionItems({ ...base, newOrderCount: 2 })[0].message, "You have 2 new orders to review.");
  assert.doesNotMatch(HOME, /New Order\{newOrderCount === 1/);
  assert.doesNotMatch(HOME, /\(pendingInvitationCount > 0 \|\| newOrderCount > 0\) &&/);
  assert.match(HOME, /\.\.\.\(pendingInvitationCount > 0\s*\?\s*\[\s*\{\s*id: "event-invitations",/);
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
  const list = HOME.slice(at('aria-labelledby="needs-attention"'), at('id="home-schedule"'));
  assert.match(list, /\{item\.title\}/);
  assert.match(list, /\{item\.message\}/);
  assert.match(list, /\{item\.actionLabel\}/);
  assert.match(HOME, /You\\u2019re invited to participate in \$\{invitedTo\}\./);
  assert.match(PAGE, /pendingInvitationNames=\{pendingInvitations\.filter\(\(o\) => o\.status === "pending"\)\.map\(\(o\) => o\.eventName\)\}/);
});

test("Schedule: Happening Now (only when live) then Coming Up; useful empty state with the two presence actions", () => {
  assert.match(PAGE, /comingUp=\{homeActivities\.comingUp\}/);
  assert.match(PAGE, /liveActivities=\{homeActivities\.live\}/);
  assert.match(PAGE, /const homeActivities = buildHomeComingUp\(\s*dashboardAppearances,\s*hostedUpcoming\.map\(/);
  const sched = HOME.slice(at('id="home-schedule"'), at('id="home-create"'));
  assert.ok(sched.indexOf("<LiveCard") < sched.indexOf("<UpcomingRow"));
  assert.match(sched, /Tell people where you&rsquo;ll be or host an Event\./);
  assert.match(sched, /\{\[create\.where, create\.event\]\.map\(\(a\) => \(/);
});

test("Opportunities For You: existing data only, compact, never Pro-gated", () => {
  assert.match(HOME, /<HomeOpportunities basePath=\{basePath\} items=\{opportunityItems\} \/>/);
  const opp = HOME.slice(HOME.indexOf("function HomeOpportunities"), HOME.indexOf("function SectionTitle"));
  assert.doesNotMatch(opp, /\bpro\b/);
  assert.match(opp, /Opportunities For You/);
  assert.match(opp, /\]\.slice\(0, 3\);/, "at most three existing recommendations");
  assert.match(opp, /ranked\.length === 1 \? \(/);
  assert.match(opp, /ranked\.length > 1 \? \(\s*<ul className=\{`mt-3 \$\{RAIL_CLASS\}`\}>/, "several real ones → a short horizontal collection");
  assert.match(opp, /Explore Opportunities/);
  assert.match(opp, /Tell Findmi Your Goals/);
  assert.doesNotMatch(opp, /Browse Opportunities/);
});

test("Performance: existing metrics + Free/Pro gating; all-zero explains itself instead of four zeros", () => {
  const perf = HOME.slice(at('aria-labelledby="performance-snapshot"'), at('aria-labelledby="findmi-link"'));
  for (const l of ["Profile Views", "Actions", "QR Scans"]) assert.match(perf, new RegExp(`<MetricTile label="${l}"`));
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
