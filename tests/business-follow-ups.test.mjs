// Business Home → Follow-Ups (lib/business-follow-ups.ts + the bounded Targets
// read in lib/business-targets.ts): this Business's own Target next steps — of
// every kind (Place, Business, Event) — nothing else, private to it, absent when
// there are none. No network, no production DB. `npm test`.
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

const F = await import("../src/lib/business-follow-ups.ts");
const L = await import("../src/lib/business-targets.ts");
const R = await import("../src/lib/business-relationships.ts");
const DASH = await import("../src/lib/business-dashboard.ts");
const read = (p) => readFileSync(p, "utf8");
const HOME = read("src/app/(public)/account/business/[id]/v2/BusinessHome.tsx");
const PAGE = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
const LIB = read("src/lib/business-follow-ups.ts");
const INBOX_VIEW = read("src/app/(public)/account/business/[id]/v2/HomeInbox.tsx");
const INBOX_LIB = read("src/lib/home-inbox.ts");

const BASE = "/account/business/biz";
const TODAY = "2026-10-22";
const place = (id, o = {}) => ({ targetId: `t-${id}`, kind: "location", locationId: id, title: `Place ${id}`, status: "in_conversation", nextAction: "Send samples", nextActionAt: null, ...o });
const build = (targets, today = TODAY) => F.buildFollowUps({ basePath: BASE, targets, today });

// ── Placement follow-ups ────────────────────────────────────────────────────

test("Mocktail-style: the Babylist Soho follow-up appears, opening the relationship workspace by Location", () => {
  const items = build([place("babylist", { title: "Babylist Soho", nextAction: "Find contact info for partnerships director", nextActionAt: "2026-10-23" })]);
  assert.deepEqual(items, [
    {
      key: "target:t-babylist",
      title: "Babylist Soho",
      meta: "In Conversation · Follow Up Tomorrow",
      detail: "Find contact info for partnerships director",
      due: "soon",
      href: `${BASE}?tab=growth&view=targets&loc=babylist`,
    },
  ]);
  // Home's Inbox / Follow-Ups row opens exactly that href (lib/home-inbox.ts).
  assert.match(INBOX_LIB, /href: f\.href,/);
});

test("Passed is excluded, and a Target with no step and no date is not a follow-up", () => {
  const items = build([
    place("passed", { status: "passed", nextActionAt: "2026-10-20" }),
    place("empty", { nextAction: "   ", nextActionAt: null }),
    place("dated-only", { nextAction: null, nextActionAt: "2026-10-24" }),
  ]);
  assert.deepEqual(items.map((i) => i.key), ["target:t-dated-only"]);
  assert.equal(items[0].detail, null);
});

test("ordering is unchanged: overdue → today → due soon → undated → later; stable ties", () => {
  const items = build([
    place("later", { nextActionAt: "2026-11-20" }),
    place("undated", { nextActionAt: null }),
    place("soon-b", { title: "B", nextActionAt: "2026-10-25" }),
    place("soon-a", { title: "A", nextActionAt: "2026-10-25" }),
    place("today", { nextActionAt: TODAY }),
    place("tomorrow", { nextActionAt: "2026-10-23" }),
    place("overdue", { nextActionAt: "2026-10-01" }),
  ]);
  assert.deepEqual(items.map((i) => i.key), ["target:t-overdue", "target:t-today", "target:t-tomorrow", "target:t-soon-a", "target:t-soon-b", "target:t-undated", "target:t-later"]);
  const shuffled = build([place("soon-b", { title: "B", nextActionAt: "2026-10-25" }), place("soon-a", { title: "A", nextActionAt: "2026-10-25" })]);
  assert.deepEqual(shuffled.map((i) => i.key), ["target:t-soon-a", "target:t-soon-b"]);
});

test("date labels and the app calendar day are unchanged", () => {
  assert.equal(F.followUpDateLabel("2026-10-21", TODAY), "Overdue");
  assert.equal(F.followUpDateLabel(TODAY, TODAY), "Today");
  assert.equal(F.followUpDateLabel("2026-10-23", TODAY), "Tomorrow");
  assert.equal(F.followUpDateLabel("2026-10-27", TODAY), "Oct 27");
  const meta = (d) => build([place("x", { nextActionAt: d })])[0].meta;
  assert.equal(meta("2026-10-20"), "In Conversation · Overdue");
  assert.equal(meta(TODAY), "In Conversation · Due Today");
  assert.equal(meta("2026-11-02"), "In Conversation · Follow Up Nov 2");
  const evening = R.followUpToday(new Date("2026-10-23T03:30:00Z")); // 11:30 PM Oct 22, New York
  assert.equal(build([place("x", { nextActionAt: "2026-10-22" })], evening)[0].due, "today");
  assert.match(PAGE, /today: followUpToday\(\)/);
});

// ── Only Target follow-ups ──────────────────────────────────────────────────

test("Business and Event Targets' next steps join the same Follow-Ups, opening their own Target workspace", () => {
  const items = build([
    place("babylist-soho", { title: "Babylist Soho", nextAction: "Contact partnerships director", nextActionAt: "2026-10-24" }),
    { targetId: "t-biz", kind: "business", locationId: null, title: "Babylist", status: "target", nextAction: "Send wholesale deck", nextActionAt: "2026-10-23" },
    { targetId: "t-evt", kind: "event", locationId: null, title: "Jersey City Night Market", status: "in_conversation", nextAction: null, nextActionAt: "2026-10-22" },
    { targetId: "t-passed", kind: "business", locationId: null, title: "Old Lead", status: "passed", nextAction: "x", nextActionAt: "2026-10-22" },
  ]);
  assert.deepEqual(items.map((i) => [i.title, i.detail, i.href]), [
    ["Jersey City Night Market", null, `${BASE}?tab=growth&view=targets&tgt=t-evt`],
    ["Babylist", "Send wholesale deck", `${BASE}?tab=growth&view=targets&tgt=t-biz`],
    ["Babylist Soho", "Contact partnerships director", `${BASE}?tab=growth&view=targets&loc=babylist-soho`],
  ]);
  assert.equal(items[0].meta, "In Conversation · Due Today");
});

test("commercial Opportunities never enter Follow-Ups (nor Appearances, Find Us Here, orders or invitations)", () => {
  assert.doesNotMatch(LIB, /opportunit|appearance|availability|order|invitation/i);
  assert.match(PAGE, /buildFollowUps\(\{ basePath: `\/account\/business\/\$\{id\}`, targets: followUpTargets, today: followUpToday\(\) \}\)/, "Targets are the only input");
  assert.doesNotMatch(PAGE, /buildBusinessNext/);
});

// ── Home rendering ──────────────────────────────────────────────────────────

test("follow-ups render as rows of Home's one ranked Inbox / Follow-Ups list; the first few, then Show More (URL state, no new destination)", () => {
  assert.equal(F.FOLLOW_UPS_INITIAL_LIMIT, 3);
  assert.match(INBOX_VIEW, /const shown = expanded \? items : items\.slice\(0, HOME_INBOX_LIMIT\);/);
  // Stacked rows inside ONE Inbox / Follow-Ups panel (BusinessHome owns the container).
  assert.match(HOME, /data-inbox-panel className="mt-1\.5 divide-y [^"]*"/, "stacked rows, never a carousel");
  assert.match(INBOX_VIEW, /shown\.map\(\(item\) => <InboxRow key=\{item\.key\} item=\{item\} \/>\)/);
  assert.doesNotMatch(INBOX_VIEW, /overflow-x|snap-|carousel/);
  assert.match(INBOX_VIEW, /href=\{expanded \? `\$\{basePath\}#home-inbox` : `\$\{basePath\}\?inbox=all#home-inbox`\}/);
  // The older ?followups=all link still expands the same list.
  assert.match(PAGE, /inboxExpanded=\{\[rawSearchParams\.inbox, rawSearchParams\.followups, rawSearchParams\.requests\]\.includes\("all"\)\}/);
});

test("zero follow-ups: no section of their own; the Inbox / Follow-Ups module shows one clean empty state when nothing at all needs attention", () => {
  assert.doesNotMatch(HOME, /function FollowUpsSection|title="Follow-Ups"/);
  assert.match(INBOX_VIEW, /items\.length === 0 \?/);
  assert.match(INBOX_VIEW, /Nothing needs your attention/);
  assert.doesNotMatch(HOME, /All Caught Up|title="Next"|>\s*Next\s*</);
  assert.doesNotMatch(HOME + PAGE, /business-next|NextSection|nextExpanded/);
});

test("Home order around Follow-Ups: Coming Up → Inbox / Follow-Ups → Growth Manager → Performance", () => {
  const at = (m) => HOME.indexOf(m);
  const order = ['aria-labelledby="happening-now"', 'aria-labelledby="coming-up"', 'aria-labelledby="home-inbox-title"', "<NeedsAttentionBar items={needsAttention} titleId=\"home-inbox-title\"", "<HomeInboxRows", "<GrowthPanel", 'aria-labelledby="performance-snapshot"', 'aria-labelledby="findmi-link"'].map(at);
  assert.ok(order.every((i) => i > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

// ── Privacy: a Target is private to the Business tracking it ────────────────

function targetsDb(rows) {
  const filters = [];
  const q = {
    select: (cols) => (filters.push(["select", cols]), q),
    eq: (c, v) => (filters.push([c, v]), q),
    neq: (c, v) => (filters.push([c, `!${v}`]), q),
    or: () => q,
    order: () => q,
    limit: () => Promise.resolve({ data: rows.filter((r) => filters.filter(([c]) => c !== "select").every(([c, v]) => (v.startsWith?.("!") ? r[c] !== v.slice(1) : r[c] === v))), error: null }),
  };
  return { filters, from: () => q };
}

test("Babylist's Home never sees Mocktail Mart's private Target / follow-up for Babylist Soho", async () => {
  const rows = [{ id: "t1", business_id: "mocktail", target_location_id: "babylist-soho", target_business_id: null, target_event_id: null, status: "in_conversation", next_action: "Find contact info for partnerships director", next_action_at: "2026-10-23", internal_notes: "secret", location: { name: "Babylist Soho" } }];
  const asBabylist = targetsDb(rows);
  assert.deepEqual(await L.getFollowUpTargets(asBabylist, "babylist"), [], "another Business's Target never reaches Babylist");
  assert.deepEqual(asBabylist.filters[1], ["business_id", "babylist"], "scoped to the OWNER Business whose Home it is — never the counterparty");
  const asMocktail = targetsDb(rows);
  const mine = await L.getFollowUpTargets(asMocktail, "mocktail");
  assert.deepEqual(mine, [{ targetId: "t1", kind: "location", locationId: "babylist-soho", title: "Babylist Soho", status: "in_conversation", nextAction: "Find contact info for partnerships director", nextActionAt: "2026-10-23" }], "no internal notes");
  const lib = read("src/lib/business-targets.ts");
  const reader = lib.slice(lib.indexOf("export async function getFollowUpTargets"), lib.indexOf("export async function getTargetPursuit"));
  assert.match(reader, /\.eq\("business_id", businessId\)/);
  assert.doesNotMatch(reader, /\.eq\("target_|internal_notes|activit/, "never read by counterparty, never notes or Activity");
  assert.match(PAGE, /whenP\(onHome, \(\) => getFollowUpTargets\(admin, id\)/, "the managed Business only");
});

// ── Neighbours unchanged ────────────────────────────────────────────────────

test("Needs Attention is unchanged: exceptions only, never Target follow-ups, hidden at zero", () => {
  const base = { businessId: "biz", hasPrimaryMarket: true, pendingMarketRequestText: null, upcomingAppearances: [], newOrderCount: 0, profileIncomplete: false };
  assert.deepEqual(DASH.buildNeedsAttentionItems(base), []);
  const ids = DASH.buildNeedsAttentionItems({ ...base, profileIncomplete: true, dueTargets: { count: 1, first: { locationId: "l1", name: "Cafe", nextAction: "x", overdue: true } } }).map((i) => i.id);
  assert.deepEqual(ids, ["incomplete-profile"]);
  assert.match(read("src/app/(public)/account/business/[id]/v2/NeedsAttentionBar.tsx"), /const count = items\.length;[\s\S]*\{count > 0 && \([\s\S]*\{count > 0 && open && \(/);
});

test("Growth Opportunity counts and Coming Up / Opportunities / Performance / management cards are unchanged", () => {
  const view = read("src/app/(public)/account/business/[id]/v2/GrowthView.tsx");
  assert.match(view, /matchesAwaitingResponse: opportunityItems\.filter\(\(i\) => i\.view\.group === "for_you"\)\.length,/);
  assert.match(view, /matchesInProgress: opportunityItems\.filter\(\(i\) => i\.view\.group === "confirmed" \|\| i\.view\.group === "interested"\)\.length,/);
  assert.match(HOME, /comingUp\.map\(\(item\) => \(/);
  assert.match(HOME, /<GrowthPanel basePath=\{basePath\} summary=\{growth\} \/>/);
  assert.match(HOME, /linkLabel=\{pro \? "View All" : "Unlock Full Analytics"\}/);
  assert.match(HOME, /<ManagementCards businessId=\{businessId\} \/>/);
});
