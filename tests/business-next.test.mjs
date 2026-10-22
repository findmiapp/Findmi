// Business Home → Next (lib/business-next.ts + the bounded Targets read in
// lib/business-placements.ts): a derived read of what THIS Business can act
// on — never a task system. No network, no production DB. `npm test`.
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

const N = await import("../src/lib/business-next.ts");
const L = await import("../src/lib/business-placements.ts");
const R = await import("../src/lib/business-relationships.ts");
const DASH = await import("../src/lib/business-dashboard.ts");
const read = (p) => readFileSync(p, "utf8");
const HOME = read("src/app/(public)/account/business/[id]/v2/BusinessHome.tsx");
const PAGE = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
const NEXT_SRC = read("src/lib/business-next.ts");

const BASE = "/account/business/biz";
const TODAY = "2026-10-22";
const place = (id, o = {}) => ({ locationId: id, locationName: `Place ${id}`, status: "in_conversation", nextAction: "Send samples", nextActionAt: null, ...o });
const opp = (id, group, o = {}) => ({ recipientId: id, title: `Opportunity ${id}`, group, responseDeadline: null, ...o });
const build = (placements = [], opportunities = [], today = TODAY) => N.buildBusinessNext({ basePath: BASE, placements, opportunities, today });

// ── Placement next actions ──────────────────────────────────────────────────

test("a Target's next step appears, opening the relationship workspace by Location", () => {
  const [item] = build([place("babylist", { locationName: "Babylist Soho", nextAction: "Find contact info for partnerships director", nextActionAt: "2026-10-23" })]);
  assert.equal(item.title, "Babylist Soho");
  assert.equal(item.meta, "In Conversation · Follow Up Tomorrow");
  assert.equal(item.detail, "Find contact info for partnerships director");
  assert.equal(item.actionLabel, "Open Relationship");
  assert.equal(item.href, `${BASE}?tab=growth&view=targets&loc=babylist`, "addressed by the place, never a Target id");
});

test("Passed is excluded, and a Target with no step and no date is not actionable", () => {
  const items = build([
    place("passed", { status: "passed", nextActionAt: "2026-10-20" }),
    place("empty", { nextAction: "   ", nextActionAt: null }),
    place("dated-only", { nextAction: null, nextActionAt: "2026-10-24" }),
  ]);
  assert.deepEqual(items.map((i) => i.key), ["placement:dated-only"]);
  assert.equal(items[0].detail, null);
});

test("ordering: overdue → today → soon → Opportunity needing a response → undated step → later; stable ties", () => {
  const items = build(
    [
      place("later", { nextActionAt: "2026-11-20" }),
      place("undated", { nextActionAt: null }),
      place("soon-b", { locationName: "B", nextActionAt: "2026-10-25" }),
      place("soon-a", { locationName: "A", nextActionAt: "2026-10-25" }),
      place("today", { nextActionAt: TODAY }),
      place("tomorrow", { nextActionAt: "2026-10-23" }),
      place("overdue", { nextActionAt: "2026-10-01" }),
    ],
    [opp("in-progress", "interested"), opp("respond", "for_you")]
  );
  assert.deepEqual(items.map((i) => i.key), [
    "placement:overdue",
    "placement:today",
    "placement:tomorrow",
    "placement:soon-a",
    "placement:soon-b",
    "opportunity:respond",
    "placement:undated",
    "placement:later",
  ]);
  // Same input in another order → same output.
  const shuffled = build([place("soon-b", { locationName: "B", nextActionAt: "2026-10-25" }), place("soon-a", { locationName: "A", nextActionAt: "2026-10-25" })]);
  assert.deepEqual(shuffled.map((i) => i.key), ["placement:soon-a", "placement:soon-b"]);
});

test("date labels are human and never shifted by a time zone: Overdue · Today · Tomorrow · Oct 27", () => {
  assert.equal(N.nextDateLabel("2026-10-21", TODAY), "Overdue");
  assert.equal(N.nextDateLabel(TODAY, TODAY), "Today");
  assert.equal(N.nextDateLabel("2026-10-23", TODAY), "Tomorrow");
  assert.equal(N.nextDateLabel("2026-10-27", TODAY), "Oct 27");
  const meta = (d) => build([place("x", { nextActionAt: d })])[0].meta;
  assert.equal(meta("2026-10-20"), "In Conversation · Overdue");
  assert.equal(meta(TODAY), "In Conversation · Due Today");
  assert.equal(meta("2026-11-02"), "In Conversation · Follow Up Nov 2");
  assert.equal(build([place("x", { nextActionAt: null })])[0].meta, "In Conversation");
});

test("the app calendar day decides: a step dated Oct 22 is not overdue on the evening of Oct 22 in New York", () => {
  const evening = R.followUpToday(new Date("2026-10-23T03:30:00Z")); // 11:30 PM Oct 22, New York
  assert.equal(evening, "2026-10-22");
  assert.equal(build([place("x", { nextActionAt: "2026-10-22" })], [], evening)[0].due, "today");
  const nextDay = R.followUpToday(new Date("2026-10-23T12:00:00Z"));
  assert.equal(build([place("x", { nextActionAt: "2026-10-22" })], [], nextDay)[0].due, "overdue");
});

// ── Commercial Opportunities ────────────────────────────────────────────────

test("an Opportunity still waiting on this Business's response appears in Next with Respond", () => {
  const [respond, ...rest] = build([], [opp("r1", "for_you", { title: "Hotel Lobby Sampling", responseDeadline: "2026-10-27T23:00:00Z" })]);
  assert.equal(respond.key, "opportunity:r1");
  assert.equal(respond.title, "Hotel Lobby Sampling");
  assert.equal(respond.meta, "Opportunity · Respond By Oct 27");
  assert.equal(respond.actionLabel, "Respond");
  assert.equal(respond.href, `${BASE}/opportunities/r1`);
  assert.equal(rest.length, 0);
  assert.equal(build([], [opp("r9", "for_you")])[0].meta, "Opportunity · Waiting On Your Response");
});

test("answered Opportunities (Interested, Confirmed, Past) never appear in Next — not even as a passive summary", () => {
  assert.deepEqual(build([], [opp("r2", "interested"), opp("r3", "confirmed"), opp("r4", "past")]), []);
  assert.doesNotMatch(NEXT_SRC, /Review Opportunities|Relevant opportunities|"interested"|"confirmed"/);
  // Mocktail Mart today: the Babylist step + two Opportunities already marked Interested.
  const items = build(
    [place("babylist", { locationName: "Babylist Soho", nextAction: "Find contact info for partnerships director", nextActionAt: "2026-10-23" })],
    [opp("tabli", "interested", { title: "Tabli Resident Demo — Jersey City" }), opp("test", "interested", { title: "Test" })]
  );
  assert.deepEqual(items.map((i) => [i.title, i.meta, i.detail, i.actionLabel]), [["Babylist Soho", "In Conversation · Follow Up Tomorrow", "Find contact info for partnerships director", "Open Relationship"]]);
  // Once answered, the same Opportunity leaves Next.
  assert.equal(build([], [opp("r1", "for_you")]).length, 1);
  assert.equal(build([], [opp("r1", "interested")]).length, 0);
});

test("Growth keeps counting answered Opportunities exactly as before (Next does not change Growth)", () => {
  const view = read("src/app/(public)/account/business/[id]/v2/GrowthView.tsx");
  assert.match(view, /matchesAwaitingResponse: opportunityItems\.filter\(\(i\) => i\.view\.group === "for_you"\)\.length,/);
  assert.match(view, /matchesInProgress: opportunityItems\.filter\(\(i\) => i\.view\.group === "confirmed" \|\| i\.view\.group === "interested"\)\.length,/);
  assert.match(PAGE, /opportunityItems: \[\.\.\.recommendedOpportunities\.active, \.\.\.recommendedOpportunities\.past\],/);
});

test("commercial only: Next reads opportunity_listings via the Business's own recipients — never event-participation public.opportunities", () => {
  assert.doesNotMatch(NEXT_SRC, /from\(/, "the builder reads nothing itself");
  assert.match(PAGE, /opportunities: recommendedOpportunities\.active\.map\(\(i\) => \(\{/);
  assert.match(PAGE, /whenP\(needsGrowth, \(\) => getBusinessOpportunityItems\(id\)/);
  const reader = read("src/lib/opportunity-listings.ts");
  const fn = reader.slice(reader.indexOf("export async function getBusinessOpportunityItems"), reader.indexOf("export async function getBusinessOpportunityItem("));
  assert.match(fn, /\.from\("opportunity_recipients"\)/);
  assert.match(fn, /listing:opportunity_listings!inner/);
  assert.doesNotMatch(fn + NEXT_SRC, /from\("opportunities"\)/);
});

// ── What Next is not ────────────────────────────────────────────────────────

test("ordinary Appearances / Events stay in Coming Up, and passive Find Us Here or Pending Review never reach Next", () => {
  assert.doesNotMatch(NEXT_SRC, /appearance|event_occurrences|business_location_availability|pending_review|publication_status/i);
  const fn = read("src/lib/business-placements.ts");
  const reader = fn.slice(fn.indexOf("export async function getNextPlacementActions"), fn.indexOf("export async function getPlacementPursuit"));
  assert.doesNotMatch(reader, /appearances|business_location_availability/);
  assert.match(HOME, /comingUp\.map\(\(item\) => \(/, "Coming Up still renders its own upcoming content");
});

test("not a task system: no checkboxes, completion, assignees, priorities or stored items", () => {
  assert.doesNotMatch(NEXT_SRC + HOME.slice(HOME.indexOf("function NextSection"), HOME.indexOf("/** Short chip labels")), /type="checkbox"|complete|assignee|priority|insert\(|update\(/i);
});

// ── The bounded read ────────────────────────────────────────────────────────

function recorder(rows) {
  const ops = [];
  let table = null;
  const q = new Proxy({}, {
    get(_, name) {
      if (name === "then") return (res) => res({ data: rows, error: null });
      return (...args) => { ops.push([name, ...args]); return q; };
    },
  });
  return { ops, tables: () => table, from: (t) => ((table = t), q) };
}

test("getNextPlacementActions: one bounded read of this Business's non-Passed Targets with a step — no Activity, no internal notes", async () => {
  const db = recorder([{ location_id: "l1", status: "in_conversation", next_action: "Send samples", next_action_at: "2026-10-23", locations: { name: "Cafe" } }]);
  const rows = await L.getNextPlacementActions(db, "biz");
  assert.equal(db.tables(), "business_location_placements");
  const op = (name) => db.ops.filter((o) => o[0] === name);
  assert.match(op("select")[0][1], /^location_id, status, next_action, next_action_at, locations!inner\(name\)$/);
  assert.doesNotMatch(op("select")[0][1], /internal_notes|notes|activit/);
  assert.deepEqual(op("eq")[0], ["eq", "business_id", "biz"]);
  assert.deepEqual(op("neq")[0], ["neq", "status", "passed"]);
  assert.deepEqual(op("or")[0], ["or", "next_action.not.is.null,next_action_at.not.is.null"]);
  assert.deepEqual(op("limit")[0], ["limit", N.NEXT_PLACEMENT_READ_LIMIT]);
  assert.deepEqual(rows, [{ locationId: "l1", locationName: "Cafe", status: "in_conversation", nextAction: "Send samples", nextActionAt: "2026-10-23" }]);
  assert.match(PAGE, /const nextPlacementsPromise = whenP\(onHome, \(\) => getNextPlacementActions\(admin, id\)/, "Home only; one call per page, never per card");
});

// ── Home ────────────────────────────────────────────────────────────────────

test("Home shows at most three, See All via URL state (no new destination), and a compact empty state", () => {
  assert.equal(N.NEXT_INITIAL_LIMIT, 3);
  const section = HOME.slice(HOME.indexOf("function NextSection"), HOME.indexOf("/** Short chip labels"));
  assert.match(section, /const shown = expanded \? items : items\.slice\(0, NEXT_INITIAL_LIMIT\);/);
  assert.match(section, /href=\{expanded \? `\$\{basePath\}#home-next` : `\$\{basePath\}\?next=all#home-next`\}/);
  assert.match(PAGE, /nextExpanded=\{rawSearchParams\.next === "all"\}/);
  assert.match(section, /You&rsquo;re All Caught Up/);
  assert.match(section, /Nothing needs your attention right now\./);
});

test("Quick Create keeps exactly its four actions, now below Performance; Growth and Performance unchanged", () => {
  assert.match(HOME, /const quick = \[create\.where, create\.event, create\.product, create\.qr\];/);
  assert.ok(HOME.indexOf('aria-labelledby="performance-snapshot"') < HOME.indexOf('aria-labelledby="quick-create"'));
  assert.match(HOME, /<GrowthPanel basePath=\{basePath\} summary=\{growth\} \/>/);
  assert.match(HOME, /linkLabel=\{pro \? "View Performance" : "Unlock Full Analytics"\}/);
});

// ── Needs Attention stays for exceptions ────────────────────────────────────

test("Needs Attention keeps its exception items, never Next's actions, and renders nothing at zero", () => {
  const base = { businessId: "biz", hasPrimaryMarket: true, pendingMarketRequestText: null, upcomingAppearances: [], newOrderCount: 0, profileIncomplete: false };
  assert.deepEqual(DASH.buildNeedsAttentionItems(base), [], "nothing wrong → no items");
  const ids = DASH.buildNeedsAttentionItems({
    ...base,
    newOrderCount: 2,
    hasPrimaryMarket: false,
    pendingMarketRequestText: "Montclair",
    upcomingAppearances: [{ id: "a1", title: "Night Market", hasImage: false, hasVenue: false, editHref: "/edit" }],
    dueTargets: { count: 1, first: { locationId: "l1", name: "Cafe", nextAction: "Send samples", overdue: true } },
    opportunitiesAwaitingResponse: 2,
  }).map((i) => i.id);
  assert.ok(ids.includes("new-orders") && ids.includes("pending-market") && ids.includes("missing-image-a1") && ids.includes("missing-venue-a1"));
  assert.equal(ids.some((id) => id === "targets-due" || id === "opportunities-awaiting"), false);
  const bar = read("src/app/(public)/account/business/[id]/v2/NeedsAttentionBar.tsx");
  assert.match(bar, /if \(items\.length === 0\) return null;/, "no fake “0 Needs Attention”");
});
