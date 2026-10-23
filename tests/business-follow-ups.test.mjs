// Business Home → Follow-Ups (lib/business-follow-ups.ts + the bounded Targets
// read in lib/business-placements.ts): this Business's own Target next steps —
// nothing else, private to it, absent when there are none. No network, no
// production DB. `npm test`.
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
const L = await import("../src/lib/business-placements.ts");
const R = await import("../src/lib/business-relationships.ts");
const DASH = await import("../src/lib/business-dashboard.ts");
const read = (p) => readFileSync(p, "utf8");
const HOME = read("src/app/(public)/account/business/[id]/v2/BusinessHome.tsx");
const PAGE = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
const LIB = read("src/lib/business-follow-ups.ts");
const SECTION = HOME.slice(HOME.indexOf("function FollowUpsSection"), HOME.indexOf("/** Short chip labels"));

const BASE = "/account/business/biz";
const TODAY = "2026-10-22";
const place = (id, o = {}) => ({ locationId: id, locationName: `Place ${id}`, status: "in_conversation", nextAction: "Send samples", nextActionAt: null, ...o });
const build = (placements, today = TODAY) => F.buildFollowUps({ basePath: BASE, placements, today });

// ── Placement follow-ups ────────────────────────────────────────────────────

test("Mocktail-style: the Babylist Soho follow-up appears, opening the relationship workspace by Location", () => {
  const items = build([place("babylist", { locationName: "Babylist Soho", nextAction: "Find contact info for partnerships director", nextActionAt: "2026-10-23" })]);
  assert.deepEqual(items, [
    {
      key: "placement:babylist",
      title: "Babylist Soho",
      meta: "In Conversation · Follow Up Tomorrow",
      detail: "Find contact info for partnerships director",
      due: "soon",
      href: `${BASE}?tab=growth&view=targets&loc=babylist`,
    },
  ]);
  assert.match(SECTION, /Open Relationship/);
});

test("Passed is excluded, and a Target with no step and no date is not a follow-up", () => {
  const items = build([
    place("passed", { status: "passed", nextActionAt: "2026-10-20" }),
    place("empty", { nextAction: "   ", nextActionAt: null }),
    place("dated-only", { nextAction: null, nextActionAt: "2026-10-24" }),
  ]);
  assert.deepEqual(items.map((i) => i.key), ["placement:dated-only"]);
  assert.equal(items[0].detail, null);
});

test("ordering is unchanged: overdue → today → due soon → undated → later; stable ties", () => {
  const items = build([
    place("later", { nextActionAt: "2026-11-20" }),
    place("undated", { nextActionAt: null }),
    place("soon-b", { locationName: "B", nextActionAt: "2026-10-25" }),
    place("soon-a", { locationName: "A", nextActionAt: "2026-10-25" }),
    place("today", { nextActionAt: TODAY }),
    place("tomorrow", { nextActionAt: "2026-10-23" }),
    place("overdue", { nextActionAt: "2026-10-01" }),
  ]);
  assert.deepEqual(items.map((i) => i.key), ["placement:overdue", "placement:today", "placement:tomorrow", "placement:soon-a", "placement:soon-b", "placement:undated", "placement:later"]);
  const shuffled = build([place("soon-b", { locationName: "B", nextActionAt: "2026-10-25" }), place("soon-a", { locationName: "A", nextActionAt: "2026-10-25" })]);
  assert.deepEqual(shuffled.map((i) => i.key), ["placement:soon-a", "placement:soon-b"]);
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

test("commercial Opportunities never enter Follow-Ups (nor Events, Appearances, Find Us Here, orders or invitations)", () => {
  assert.doesNotMatch(LIB, /opportunit|appearance|event|availability|order|invitation/i);
  assert.match(PAGE, /buildFollowUps\(\{ basePath: `\/account\/business\/\$\{id\}`, placements: followUpPlacements, today: followUpToday\(\) \}\)/, "placements are the only input");
  assert.doesNotMatch(PAGE, /buildBusinessNext|recommendedOpportunities\.active\.map/);
});

// ── Home rendering ──────────────────────────────────────────────────────────

test("1–3 follow-ups render as stacked cards; more than 3 shows the first 3 + See All (URL state, no new destination)", () => {
  assert.equal(F.FOLLOW_UPS_INITIAL_LIMIT, 3);
  assert.match(SECTION, /const shown = expanded \? items : items\.slice\(0, FOLLOW_UPS_INITIAL_LIMIT\);/);
  assert.match(SECTION, /<ul className="mt-2\.5 flex flex-col gap-2">/, "stacked, never a carousel");
  assert.doesNotMatch(SECTION, /overflow-x|snap-|carousel/);
  assert.match(SECTION, /href=\{expanded \? `\$\{basePath\}#home-follow-ups` : `\$\{basePath\}\?followups=all#home-follow-ups`\}/);
  assert.match(SECTION, /linkLabel=\{expanded \? "Show Less" : `See All \$\{items\.length\}`\}/);
  assert.match(PAGE, /followUpsExpanded=\{rawSearchParams\.followups === "all"\}/);
});

test("zero follow-ups render nothing — no heading, no empty state; the generic Next and “All Caught Up” are gone", () => {
  assert.match(SECTION, /^function FollowUpsSection[^\n]*\n\s*if \(items\.length === 0\) return null;/);
  assert.match(SECTION, /title="Follow-Ups"/);
  assert.doesNotMatch(HOME, /All Caught Up|Nothing needs your attention|title="Next"|>\s*Next\s*</);
  assert.doesNotMatch(HOME + PAGE, /business-next|NextSection|nextExpanded/);
});

test("Home order is unchanged around Follow-Ups", () => {
  const at = (m) => HOME.indexOf(m);
  const order = ["<NeedsAttentionBar items={attention} />", "<FollowUpsSection", 'aria-labelledby="happening-now"', 'aria-labelledby="coming-up"', "<MomentsStrip", "<GrowthPanel", 'aria-labelledby="performance-snapshot"', 'aria-labelledby="quick-create"', 'aria-labelledby="findmi-link"'].map(at);
  assert.ok(order.every((i) => i > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

// ── Privacy: a Target is private to the Business tracking it ────────────────

function placementsDb(rows) {
  const filters = [];
  const q = {
    select: () => q,
    eq: (c, v) => (filters.push([c, v]), q),
    neq: (c, v) => (filters.push([c, `!${v}`]), q),
    or: () => q,
    order: () => q,
    limit: () => Promise.resolve({ data: rows.filter((r) => filters.every(([c, v]) => (v.startsWith?.("!") ? r[c] !== v.slice(1) : r[c] === v))), error: null }),
  };
  return { filters, from: () => q };
}

test("Babylist's Home never sees Mocktail Mart's private Target / follow-up for Babylist Soho", async () => {
  const rows = [{ business_id: "mocktail", location_id: "babylist-soho", status: "in_conversation", next_action: "Find contact info for partnerships director", next_action_at: "2026-10-23", internal_notes: "secret", locations: { name: "Babylist Soho" } }];
  const asBabylist = placementsDb(rows);
  assert.deepEqual(await L.getFollowUpPlacements(asBabylist, "babylist"), [], "another Business's Target never reaches Babylist");
  assert.deepEqual(asBabylist.filters[0], ["business_id", "babylist"], "scoped to the Business whose Home it is");
  const asMocktail = placementsDb(rows);
  const mine = await L.getFollowUpPlacements(asMocktail, "mocktail");
  assert.deepEqual(mine, [{ locationId: "babylist-soho", locationName: "Babylist Soho", status: "in_conversation", nextAction: "Find contact info for partnerships director", nextActionAt: "2026-10-23" }], "no internal notes");
  const lib = read("src/lib/business-placements.ts");
  const reader = lib.slice(lib.indexOf("export async function getFollowUpPlacements"), lib.indexOf("export async function getPlacementPursuit"));
  assert.match(reader, /\.select\("location_id, status, next_action, next_action_at, locations!inner\(name\)"\)/);
  assert.doesNotMatch(reader, /\.eq\("location_id"|internal_notes|activit/, "never read by place, never notes or Activity");
  assert.match(PAGE, /whenP\(onHome, \(\) => getFollowUpPlacements\(admin, id\)/, "the managed Business only");
});

// ── Neighbours unchanged ────────────────────────────────────────────────────

test("Needs Attention is unchanged: exceptions only, never Target follow-ups, hidden at zero", () => {
  const base = { businessId: "biz", hasPrimaryMarket: true, pendingMarketRequestText: null, upcomingAppearances: [], newOrderCount: 0, profileIncomplete: false };
  assert.deepEqual(DASH.buildNeedsAttentionItems(base), []);
  const ids = DASH.buildNeedsAttentionItems({ ...base, newOrderCount: 1, dueTargets: { count: 1, first: { locationId: "l1", name: "Cafe", nextAction: "x", overdue: true } } }).map((i) => i.id);
  assert.deepEqual(ids, ["new-orders"]);
  assert.match(read("src/app/(public)/account/business/[id]/v2/NeedsAttentionBar.tsx"), /if \(items\.length === 0\) return null;/);
});

test("Growth Opportunity counts and Coming Up / Growth / Performance / Quick Create are unchanged", () => {
  const view = read("src/app/(public)/account/business/[id]/v2/GrowthView.tsx");
  assert.match(view, /matchesAwaitingResponse: opportunityItems\.filter\(\(i\) => i\.view\.group === "for_you"\)\.length,/);
  assert.match(view, /matchesInProgress: opportunityItems\.filter\(\(i\) => i\.view\.group === "confirmed" \|\| i\.view\.group === "interested"\)\.length,/);
  assert.match(HOME, /comingUp\.map\(\(item\) => \(/);
  assert.match(HOME, /<GrowthPanel basePath=\{basePath\} summary=\{growth\} \/>/);
  assert.match(HOME, /linkLabel=\{pro \? "View Performance" : "Unlock Full Analytics"\}/);
  assert.match(HOME, /const quick = \[create\.where, create\.event, create\.product, create\.qr\];/);
});
