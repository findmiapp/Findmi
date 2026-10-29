// Business Manager → Overview / Home redesign. The approved hierarchy —
// Status → section nav → Create & Manage → Coming Up → Inbox / Follow-Ups →
// Growth Manager → Performance — over real Findmi data only. Pure rules are
// exercised by calling them (buildHomeInbox, buildHomeComingUp,
// managementCards, homePerformanceMetrics); render order and wiring are
// proven with source-level guards (this suite has no JSX harness).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const HI = await import("../src/lib/home-inbox.ts");
const BD = await import("../src/lib/business-dashboard.ts");
const MC = await import("../src/app/(public)/account/business/[id]/v2/managementCardItems.ts");
const L = await import("../src/lib/manager-links.ts");
const G = await import("../src/lib/growth.ts");
const NAV = await import("../src/app/(public)/account/business/[id]/v2/business-nav.ts");
const { getTemporalLabel } = await import("../src/lib/format.ts");

const B = "src/app/(public)/account/business/[id]";
const read = (p) => readFileSync(p, "utf8");
const HOME = read(`${B}/v2/BusinessHome.tsx`);
const PAGE = read(`${B}/(manager)/page.tsx`);
const CARDS = read(`${B}/v2/ManagementCards.tsx`);
const INBOX = read(`${B}/v2/HomeInbox.tsx`);
const PERF = read(`${B}/v2/HomePerformance.tsx`);
const GROWTH = read(`${B}/v2/GrowthPanel.tsx`);
const BIZ = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

// ── Hierarchy ──────────────────────────────────────────────────────────────

test("section order: Status → Create & Manage → section nav → Coming Up → Inbox / Follow-Ups → Growth Manager → Performance", () => {
  const order = [
    'aria-label="Business status"',
    "<ManagementCards businessId={businessId} />",
    "<HomeSectionNav items={navItems} />",
    'aria-labelledby="coming-up"',
    'aria-labelledby="home-inbox-title"',
    "<GrowthPanel basePath={basePath} summary={growth} />",
    'aria-labelledby="performance-snapshot"',
  ].map((m) => {
    const i = HOME.indexOf(m);
    assert.ok(i > 0, m);
    return i;
  });
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(HOME, /title="Inbox \/ Follow-Ups"/);
  assert.match(GROWTH, />\s*Growth Manager\s*</);
  assert.match(CARDS, />\s*Create &amp; Manage\s*</);
});

test("the persistent shell and its bottom navigation are untouched: Home · Moments · Findmi Here · Performance · More", () => {
  const mobile = NAV.BUSINESS_NAV.filter((n) => !n.desktopOnly).map((n) => n.label);
  assert.deepEqual(mobile, ["Home", "Moments", "Findmi Here", "Performance", "More"]);
  assert.match(read(`${B}/(manager)/layout.tsx`), /<BusinessAppShell \{\.\.\.shell\}>\{children\}<\/BusinessAppShell>/);
});

// ── Create & Manage ─────────────────────────────────────────────────────────

test("Create & Manage keeps every existing category and its canonical routes", () => {
  const cards = MC.managementCards(BIZ);
  assert.deepEqual(cards.map((c) => c.title), ["Events", "Locations", "Products", "QR Codes", "Moments", "Targets"]);
  const by = (k) => cards.find((c) => c.key === k);
  assert.equal(by("events").addHref, L.managerHref(BIZ, "add-event"));
  assert.equal(by("events").viewHref, L.managerHref(BIZ, "findmi-here"));
  assert.equal(by("locations").addHref, `/account/location/new?business_id=${BIZ}`);
  assert.equal(by("locations").viewHref, L.managerHref(BIZ, "our-locations"));
  assert.equal(by("products").viewHref, L.managerHref(BIZ, "products"));
  assert.equal(by("targets").addHref, L.managerHref(BIZ, "add-target"));
  for (const c of cards) {
    assert.ok(c.description.length > 0, `${c.key} has a short description`);
    assert.match(c.addLabel, /^Add /);
    assert.match(c.viewLabel, /^View All /);
  }
});

test("Create & Manage cards are landscape: ~2.3 per row at 390px, both actions on one row, no dots or arrows", () => {
  assert.match(CARDS, /className="w-\[44%\] min-w-0 shrink-0 snap-start/);
  assert.match(CARDS, /snap-x snap-mandatory/);
  assert.match(CARDS, /<div className="mt-auto flex gap-1\.5 pt-2">/);
  assert.match(CARDS, /aria-label=\{c\.addLabel\}/);
  assert.match(CARDS, /aria-label=\{c\.viewLabel\}/);
  assert.doesNotMatch(CARDS, /aria-label="(Previous|Next)"|Go to slide|setInterval/);
});

// ── Coming Up ───────────────────────────────────────────────────────────────

const H = 3600e3;
const at = (h) => new Date(Date.now() + h * H).toISOString();
const appearance = ({ id, startH, durH = 3, eventId = null }) => {
  const startAt = at(startH);
  const endAt = at(startH + durH);
  return {
    id, title: id, startAt, endAt, eventId, venueName: "Venue", geographyLabel: null, city: null, state: null,
    participationStatus: null, statusLabel: "Confirmed", temporal: getTemporalLabel(startAt, endAt),
    managementHref: `/account/business/biz?tab=findmi-here&editing=${id}`, displayImageUrl: null,
  };
};
const hosted = ({ eventId, dates }) => ({
  eventId, name: eventId, where: "Hall", statusLabel: null, imageUrl: null, href: `/account/event/${eventId}?business_id=biz`,
  dates: dates.map((s) => ({ startAt: at(s), endAt: at(s + 2) })),
});

test("Coming Up is chronological, excludes past dates, and keeps a multi-date Event as ONE item at its next date", () => {
  const r = BD.buildHomeComingUp(
    [appearance({ id: "late", startH: 200 }), appearance({ id: "soon", startH: 5 })],
    [hosted({ eventId: "series", dates: [-30, 48, 72, 96] })],
    undefined,
    6
  );
  assert.deepEqual(r.comingUp.map((i) => i.title), ["soon", "series", "late"]);
  const series = r.comingUp.find((i) => i.title === "series");
  assert.ok(Math.abs(Date.parse(series.startAt) - (Date.now() + 48 * H)) < 60e3, "next not-yet-started date, never the past one");
  assert.equal(series.moreDates, 2);
  assert.ok(r.comingUp.every((i) => Date.parse(i.startAt) > Date.now()));
});

test("Coming Up renders as a horizontal rail of up to six, with a useful empty state", () => {
  assert.match(PAGE, /countUpcomingDatesPerPreviewGroup\(allScheduleRows, eventIdsWithOccurrenceProjections\),\s*\/\/[^\n]*\n\s*6\s*\)/);
  // Compact landscape schedule cards: ~1.6 visible at 390px, three across on desktop.
  // Dense landscape schedule cards: ~2 visible at 390px, four across on desktop.
  assert.match(HOME, /data-coming-up-card className="w-\[50%\] min-w-0 shrink-0 snap-start sm:w-\[34%\] lg:w-\[calc\(\(100%-1\.125rem\)\/4\)\]"/);
  assert.match(HOME, /relative flex h-10 w-10 shrink-0/, "compact thumbnail");
  assert.match(HOME, /\{a\.moreDates === 1 \? "\+ 1 More Date" : `\+ \$\{a\.moreDates\} More Dates`\}/);
  assert.match(HOME, /href=\{managerHref\(businessId, "add-event"\)\}/);
  // ended Appearances never reach Home: the schedule read is upcoming-only
  assert.match(PAGE, /\.gt\("end_at", nowIso\)/);
});

// ── Inbox / Follow-Ups ──────────────────────────────────────────────────────

const conv = (id, o = {}) => ({
  id, otherPartyLabel: o.label ?? id, subjectType: o.type ?? "commercial_inquiry", subjectId: "x", lastMessageBody: o.body ?? "Hello",
  lastActivityAt: o.at ?? new Date().toISOString(), productName: null, unread: Boolean(o.unread), myKeys: o.keys ?? [`business:${BIZ}`],
});
const fu = (key, due) => ({ key, title: key, meta: due === "overdue" ? "In Conversation · Overdue" : "Target · Follow Up Oct 30", detail: "Next step", due, href: `/fu/${key}` });
const rq = (key) => ({ key, title: key, meta: "Inquiry · Pop-Up · Response Requested", detail: null, href: `/rq/${key}`, actionLabel: "Review Inquiry" });

test("Inbox ranks overdue → unread → needs response → upcoming follow-ups → recent activity", () => {
  const { items, actionableCount } = HI.buildHomeInbox({
    businessId: BIZ,
    followUps: [fu("overdue-1", "overdue"), fu("later-1", "later")],
    requests: [rq("inquiry-1")],
    conversations: [conv("read-1", { unread: false }), conv("unread-1", { unread: true })],
    threadHref: (id) => `/t/${id}`,
  });
  assert.deepEqual(items.map((i) => i.key), ["overdue-1", "conversation:unread-1", "inquiry-1", "later-1", "conversation:read-1"]);
  assert.deepEqual(items.map((i) => i.tone), ["overdue", "new", "respond", "upcoming", "recent"]);
  assert.equal(actionableCount, 4, "recent read threads are context, not attention");
  assert.equal(items[1].href, "/t/unread-1");
  assert.equal(items[0].href, "/fu/overdue-1", "rows open the canonical record");
});

test("Inbox uses the canonical Business Inbox scope: this Business's threads only, no Event-participation note threads, recent window bounded", () => {
  const old = new Date(Date.now() - 40 * 24 * H).toISOString();
  const { items } = HI.buildHomeInbox({
    businessId: BIZ,
    followUps: [],
    requests: [],
    conversations: [
      conv("other-biz", { unread: true, keys: [`business:${OTHER}`] }),
      conv("personal", { unread: true, keys: ["personal:u1"] }),
      conv("note", { unread: true, type: "opportunity" }),
      conv("stale", { unread: false, at: old }),
      conv("mine", { unread: true }),
    ],
    threadHref: (id) => `/t/${id}`,
  });
  assert.deepEqual(items.map((i) => i.key), ["conversation:mine"]);
});

test("Inbox preview reads the ONE conversation system through the authorized manager context, never a second messaging model", () => {
  assert.match(INBOX, /const \{ admin, user \} = await getManagerCore\(businessId\);/);
  assert.match(INBOX, /listConversationsForUser\(admin, user\.id\)/);
  assert.match(INBOX, /threadHref: \(cid\) => managerThreadHref\(businessId, cid\)/);
  assert.match(HOME, /viewAllHref=\{managerHref\(businessId, "inbox"\)\}/, "routes into the canonical Inbox");
  assert.match(read(`${B}/v2/NeedsAttentionBar.tsx`), /<Link href=\{viewAllHref\}[^>]*>\s*View All/);
  assert.match(INBOX, /Nothing needs your attention/);
  assert.doesNotMatch(read("src/lib/home-inbox.ts"), /from\(|supabase|insert|update\(/i, "pure: nothing stored, no new status");
});

// ── Growth Manager ──────────────────────────────────────────────────────────

test("Growth Manager: three tiles (Goals · Opportunities · Ideas) routed to their existing destinations with real statuses", () => {
  const tiles = GROWTH.match(/HOME_GROWTH_TILES[^=]*= \[([\s\S]*?)\];/)[1];
  assert.match(tiles, /key: "goals", label: "Goals"[\s\S]*key: "opportunities", label: "Opportunities"[\s\S]*key: "ideas", label: "Ideas"/);
  assert.doesNotMatch(tiles, /targets/);
  assert.equal(G.growthHref("/b", "goals"), "/b?tab=growth");
  assert.equal(G.growthHref("/b", "opportunities"), "/b?tab=opportunities");
  assert.equal(G.growthHref("/b", "ideas"), "/b?tab=growth&view=ideas");
  const none = G.summarizeGrowth({ audit: null, activeGoalCount: 0, matchesAwaitingResponse: 0, matchesInProgress: 0 });
  assert.equal(G.growthDestinationStatus(none, "ideas").value, "Personalize", "nothing fabricated when there is nothing yet");
});

// ── Performance ─────────────────────────────────────────────────────────────

test("Performance: four existing headline metrics; change labels Pro-only; Performance tab query stays Pro-gated", () => {
  assert.match(PERF, /\{ key: "impressions", label: "Impressions", metric: headline\.impressions \}/);
  assert.match(PERF, /const \{ admin, pro \} = await getManagerCore\(businessId\);/);
  assert.match(PERF, /const change = pro \? metric\.changeLabel : null;/);
  assert.match(PAGE, /whenP\(onPerformance && pro, \(\) => getOwnerBusinessPerformance\(admin, id, perfRange\)/);
  assert.match(HOME, /linkLabel=\{pro \? "View All" : "Unlock Full Analytics"\}/);
});

// ── Loading / performance architecture ─────────────────────────────────────

test("Home never waits on the Inbox or the analytics read: each streams behind its own module-sized boundary", () => {
  assert.match(HOME, /<Suspense fallback=\{<HomeInboxSkeleton \/>\}>\s*<HomeInboxRows /);
  assert.match(HOME, /<Suspense fallback=\{<HomePerformanceSkeleton \/>\}>\s*<HomePerformanceTiles /);
  // The page itself still has no page-level Suspense fallback.
  assert.doesNotMatch(PAGE, /<Suspense/);
  // Home no longer puts Performance or Moments into its one blocking Promise.all.
  assert.doesNotMatch(PAGE, /\|\| onHome, \(\) => getOwnerBusinessPerformance/);
  assert.match(PAGE, /activeTab === "moments",\s*\(\) => getBusinessMoments\(/);
  // Failures stay inside their module.
  assert.match(INBOX, /\} catch \{\s*inboxFailed = true;/);
  assert.match(PERF, /\} catch \{\s*data = null;/);
});

test("manager authorization stays intact: every Home read is scoped to the authorized Business", () => {
  assert.match(PAGE, /const \{ user, admin, membershipRole, isAdminElevated, business \} = await getManagerCore\(id\);/);
  assert.match(read(`${B}/managerContext.ts`), /export const getManagerCore = cache\(/, "per-request cached: streamed modules reuse it, no second auth or Business read");
  assert.match(read(`${B}/managerContext.ts`), /requireBusinessMember\(id\)/);
});
