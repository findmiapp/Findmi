// Business Home → Requests (lib/business-requests.ts): things sent TO this
// Business that wait on its response — offered commercial Opportunities,
// pending Event invitations, new paid orders — and nothing else. Composed from
// rows Home already reads; no new query, no stored records. `npm test`.
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

const Q = await import("../src/lib/business-requests.ts");
const OD = await import("../src/lib/opportunity-listings-domain.ts");
const O = await import("../src/lib/business-orders.ts");
const DASH = await import("../src/lib/business-dashboard.ts");
const read = (p) => readFileSync(p, "utf8");
const HOME = read("src/app/(public)/account/business/[id]/v2/BusinessHome.tsx");
const PAGE = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
const LIB = read("src/lib/business-requests.ts");
const CODE = LIB.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const SECTION = HOME.slice(HOME.indexOf("function RequestsSection"), HOME.indexOf("/** Short chip labels"));

const BASE = "/account/business/biz";
// An Opportunity item as Home has it: its group is the canonical businessOpportunityGroup.
const opp = (id, listingStatus, recipientStatus, o = {}) => ({ recipientId: id, title: `Opportunity ${id}`, group: OD.businessOpportunityGroup(listingStatus, recipientStatus), placeName: null, offeredAt: "2026-10-20T12:00:00Z", ...o });
const inv = (id, o = {}) => ({ id, type: "event_invitation", status: "pending", eventName: `Event ${id}`, occurrenceStartAt: null, occurrenceLocationName: null, createdAt: "2026-10-20T12:00:00Z", ...o });
const build = ({ opportunities = [], invitations = [], newOrderCount = 0 } = {}) => Q.buildBusinessRequests({ basePath: BASE, opportunities, invitations, newOrderCount });

// ── Commercial Opportunities ────────────────────────────────────────────────

test("an Opportunity offered on an open listing is a Request: Response Requested → Review its detail page", () => {
  const [r] = build({ opportunities: [opp("r1", "open", "offered", { title: "Hotel Lobby Sampling", placeName: "The Grove Hotel" })] });
  assert.deepEqual(r, { key: "opportunity:r1", title: "Hotel Lobby Sampling", meta: "Opportunity · Response Requested", detail: "The Grove Hotel", href: `${BASE}/opportunities/r1`, actionLabel: "Review" });
});

test("Interested, Not Interested, Confirmed, and an offer on a closed listing are not Requests", () => {
  for (const [listing, recipient] of [["open", "interested"], ["open", "not_interested"], ["open", "confirmed"], ["closed", "offered"], ["archived", "offered"], ["open", "completed"]]) {
    assert.deepEqual(build({ opportunities: [opp("x", listing, recipient)] }), [], `${listing}/${recipient}`);
  }
  // Responding moves the same Opportunity out of Requests (it stays in Growth).
  assert.equal(build({ opportunities: [opp("r1", "open", "offered")] }).length, 1);
  assert.equal(build({ opportunities: [opp("r1", "open", "interested")] }).length, 0);
});

// ── Event invitations ───────────────────────────────────────────────────────

test("a pending Event invitation is a Request with its date and place → the Inbox's Event destination", () => {
  const [r] = build({ invitations: [inv("o1", { eventName: "Jersey City Night Market", occurrenceStartAt: "2026-10-25T22:00:00Z", occurrenceLocationName: "Grove Street PATH Plaza" })] });
  assert.equal(r.key, "invitation:o1");
  assert.equal(r.title, "Jersey City Night Market");
  assert.equal(r.meta, "Event Invitation · Response Requested");
  assert.equal(r.detail, "Sun, Oct 25 · Grove Street PATH Plaza", "app time zone (6 PM New York)");
  assert.equal(r.href, "/account/messages?filter=opportunities");
});

test("an application this Business sent, and accepted / declined invitations, are not Requests", () => {
  assert.deepEqual(build({ invitations: [inv("a", { type: "event_application" }), inv("b", { status: "accepted" }), inv("c", { status: "declined" }), inv("d", { status: "withdrawn" })] }), []);
  const reader = read("src/lib/opportunities.ts");
  const fn = reader.slice(reader.indexOf("export async function getPendingInvitationsForBusiness"), reader.indexOf("export async function getApplicationsForBusiness"));
  assert.match(fn, /\.eq\("business_id", businessId\)\s*\.eq\("type", "event_invitation"\)\s*\.eq\("status", "pending"\)/);
});

// ── Orders ──────────────────────────────────────────────────────────────────

function ordersDb(rows) {
  const q = { select: () => q, eq: (c, v) => ((q.biz = v), q), then: (res) => res({ data: rows.filter((r) => r.business_id === q.biz), error: null }) };
  return { from: () => q };
}

test("new paid orders become one Request using the canonical order summary; unpaid or moved-on orders do not", async () => {
  const rows = [
    { order_id: "o1", business_id: "biz", fulfillment_status: "new", orders: { payment_status: "paid" } },
    { order_id: "o2", business_id: "biz", fulfillment_status: "new", orders: { payment_status: "paid" } },
    { order_id: "o3", business_id: "biz", fulfillment_status: "new", orders: { payment_status: "pending" } },
    { order_id: "o4", business_id: "biz", fulfillment_status: "confirmed", orders: { payment_status: "paid" } },
    { order_id: "o5", business_id: "other", fulfillment_status: "new", orders: { payment_status: "paid" } },
  ];
  const summary = await O.getBusinessOrderSummary(ordersDb(rows), "biz");
  assert.equal(summary.newCount, 2, "paid + new, this Business only");
  assert.deepEqual(build({ newOrderCount: summary.newCount }), [{ key: "orders:new", title: "2 New Orders", meta: "Orders need your attention", detail: null, href: `${BASE}?tab=orders`, actionLabel: "View Orders" }]);
  assert.equal(build({ newOrderCount: 1 })[0].title, "1 New Order");
  assert.deepEqual(build({ newOrderCount: 0 }), []);
  assert.match(PAGE, /newOrderCount: orderSummary\.newCount,/, "the page's existing summary, not a second definition");
});

test("order: new orders → Event invitations (soonest first) → Opportunities (oldest offer first)", () => {
  const items = build({
    newOrderCount: 1,
    invitations: [inv("late", { occurrenceStartAt: "2026-11-01T22:00:00Z" }), inv("undated"), inv("soon", { occurrenceStartAt: "2026-10-24T22:00:00Z" })],
    opportunities: [opp("newer", "open", "offered", { offeredAt: "2026-10-21T00:00:00Z" }), opp("older", "open", "offered", { offeredAt: "2026-10-19T00:00:00Z" })],
  });
  assert.deepEqual(items.map((i) => i.key), ["orders:new", "invitation:soon", "invitation:late", "invitation:undated", "opportunity:older", "opportunity:newer"]);
});

// ── Only these three ────────────────────────────────────────────────────────

test("never Conversations, Messages, inquiries, bookings, Targets / Follow-Ups, Find Us Here, Appearances, setup or Area requests", () => {
  // The one allowed mention: the invitation's existing destination page.
  assert.doesNotMatch(CODE.replace('"/account/messages?filter=opportunities"', ""), /conversation|message|inquir|booking|placement|follow|availability|appearance|market|profile|from\(/i);
  const call = PAGE.slice(PAGE.indexOf("buildBusinessRequests({"), PAGE.indexOf(": [];", PAGE.indexOf("buildBusinessRequests({")));
  assert.deepEqual([...call.matchAll(/^\s{8}(\w+):/gm)].map((m) => m[1]), ["basePath", "opportunities", "invitations", "newOrderCount"], "exactly three inputs");
});

test("no new reads: Requests compose rows Home already loads", () => {
  assert.match(PAGE, /whenP\(onHome \|\| onOrders \|\| \(onMore && pro\), \(\) => getBusinessOrderSummary\(admin, id\)/);
  assert.match(PAGE, /whenP\(onHome, \(\) => getPendingInvitationsForBusiness\(admin, id\)/);
  assert.match(PAGE, /whenP\(needsGrowth, \(\) => getBusinessOpportunityItems\(id\)/);
  assert.match(PAGE, /opportunities: recommendedOpportunities\.active\.map\(\(i\) => \(\{/);
});

// ── Privacy ─────────────────────────────────────────────────────────────────

test("every source is this Business's own: another Business's state, or a private Target, never becomes a Request", () => {
  const listings = read("src/lib/opportunity-listings.ts");
  const items = listings.slice(listings.indexOf("export async function getBusinessOpportunityItems"), listings.indexOf("export async function getBusinessOpportunityItem("));
  assert.match(items, /await requireBusinessMember\(businessId\);/);
  assert.match(items, /\.from\("opportunity_recipients"\)[\s\S]*?\.eq\("business_id", businessId\)/);
  // Orders: proven by the summary test above (another Business's paid "new" item is not counted).
  // Mocktail Mart tracking Babylist Soho writes only its own Target rows — no shared table.
  const placements = read("src/lib/business-targets.ts") + read("src/app/(public)/account/business/[id]/target-actions.ts");
  assert.doesNotMatch(placements, /from\("(opportunities|opportunity_recipients|conversations|conversation_messages|orders|order_items|event_businesses)"\)/);
});

// ── Home rendering ──────────────────────────────────────────────────────────

test("zero Requests render nothing; 1–3 stack; more than 3 shows the first 3 + See All (URL state); never a carousel", () => {
  assert.match(SECTION, /^function RequestsSection[^\n]*\n\s*if \(items\.length === 0\) return null;/);
  assert.doesNotMatch(SECTION, /All Caught Up|Nothing needs|empty/i);
  assert.equal(Q.REQUESTS_INITIAL_LIMIT, 3);
  assert.match(SECTION, /const shown = expanded \? items : items\.slice\(0, REQUESTS_INITIAL_LIMIT\);/);
  assert.match(SECTION, /<ul className="mt-2\.5 flex flex-col gap-2">/);
  assert.doesNotMatch(SECTION, /overflow-x|snap-|carousel/);
  assert.match(SECTION, /href=\{expanded \? `\$\{basePath\}#home-requests` : `\$\{basePath\}\?requests=all#home-requests`\}/);
  assert.match(SECTION, /linkLabel=\{expanded \? "Show Less" : `See All \$\{items\.length\}`\}/);
  assert.match(SECTION, /title="Requests"/);
  assert.doesNotMatch(SECTION, /"Inbox"/, "the account Inbox keeps its name");
  assert.match(PAGE, /requestsExpanded=\{rawSearchParams\.requests === "all"\}/);
});

test("Home order: Needs Attention → Requests → Follow-Ups → Happening Now → Coming Up → … ", () => {
  const order = ["<NeedsAttentionBar items={needsAttention} />", "<RequestsSection", "<FollowUpsSection", 'aria-labelledby="happening-now"', 'aria-labelledby="coming-up"', "<MomentsStrip", "<GrowthPanel", 'aria-labelledby="performance-snapshot"', 'aria-labelledby="quick-create"', 'aria-labelledby="findmi-link"'].map((m) => HOME.indexOf(m));
  assert.ok(order.every((i) => i > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

// ── Needs Attention: exceptions only ────────────────────────────────────────

test("Needs Attention no longer carries Event Invitations, New Orders or the Findmi Area request; real exceptions remain", () => {
  const base = { businessId: "biz", upcomingAppearances: [], profileIncomplete: false };
  assert.deepEqual(DASH.buildNeedsAttentionItems({ ...base, newOrderCount: 3, hasPrimaryMarket: false, pendingMarketRequestText: "Hudson Valley" }), []);
  assert.doesNotMatch(HOME, /event-invitations|pendingInvitationCount/);
  assert.doesNotMatch(read("src/lib/business-dashboard.ts"), /pending-market|new-orders|Findmi Area Requested/);
  const ids = DASH.buildNeedsAttentionItems({ ...base, profileIncomplete: true, upcomingAppearances: [{ id: "a1", title: "Night Market", hasImage: false, hasVenue: false, editHref: "/edit" }] }).map((i) => i.id);
  assert.deepEqual(ids, ["missing-image-a1", "missing-venue-a1", "incomplete-profile"]);
  assert.match(read("src/app/(public)/account/business/[id]/v2/NeedsAttentionBar.tsx"), /if \(items\.length === 0\) return null;/);
});

// ── Neighbours unchanged ────────────────────────────────────────────────────

test("Growth counts, Coming Up and Follow-Ups are unchanged", () => {
  const view = read("src/app/(public)/account/business/[id]/v2/GrowthView.tsx");
  assert.match(view, /matchesAwaitingResponse: opportunityItems\.filter\(\(i\) => i\.view\.group === "for_you"\)\.length,/);
  assert.match(view, /matchesInProgress: opportunityItems\.filter\(\(i\) => i\.view\.group === "confirmed" \|\| i\.view\.group === "interested"\)\.length,/);
  assert.match(HOME, /comingUp\.map\(\(item\) => \(/);
  assert.match(PAGE, /comingUp=\{homeActivities\.comingUp\}/);
  assert.match(PAGE, /buildFollowUps\(\{ basePath: `\/account\/business\/\$\{id\}`, targets: followUpTargets, today: followUpToday\(\) \}\)/);
  assert.match(HOME, /<FollowUpsSection basePath=\{basePath\} items=\{followUps\} expanded=\{followUpsExpanded\} \/>/);
});
