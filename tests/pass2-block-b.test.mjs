// Pass 2 Block B — one Business ↔ Location relationship, many views.
// Pure rules (geography scope, footprint / growth activity, relevant Opportunities),
// the additive Opportunity-geography migration, admin validation, and the
// workspace / Growth / Needs Attention wiring. No network.
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

const S = await import("../src/lib/geography-scope.ts");
const R = await import("../src/lib/business-relationships.ts");
const O = await import("../src/lib/relevant-opportunities-domain.ts");
const RO = await import("../src/lib/relevant-opportunities.ts");
const LD = await import("../src/lib/opportunity-listings-domain.ts");
const DASH = await import("../src/lib/business-dashboard.ts");
const read = (p) => readFileSync(p, "utf8");

const V2 = "src/app/(public)/account/business/[id]/v2";
const PAGE = "src/app/(public)/account/business/[id]/(manager)/page.tsx";
const BIZ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// ── Geography scope ─────────────────────────────────────────────────────────

const catalog = {
  markets: [
    { id: "m-nj", name: "North Jersey", slug: "north-jersey", sort_order: 1 },
    { id: "m-nyc", name: "New York City", slug: "nyc", sort_order: 2 },
  ],
  areas: [
    { id: "a-jc", name: "Jersey City", display_name: null, slug: "jersey-city", market_id: "m-nj", parent_area_id: null },
    { id: "a-dt", name: "Downtown", display_name: "Downtown JC", slug: "downtown", market_id: "m-nj", parent_area_id: "a-jc" },
    { id: "a-paulus", name: "Paulus Hook", display_name: null, slug: "paulus-hook", market_id: "m-nj", parent_area_id: "a-dt" },
    { id: "a-hob", name: "Hoboken", display_name: null, slug: "hoboken", market_id: "m-nj", parent_area_id: null },
    { id: "a-soho", name: "SoHo", display_name: null, slug: "soho", market_id: "m-nyc", parent_area_id: null },
  ],
};

test("an Area scope includes every descendant Area, and nothing else", () => {
  assert.deepEqual(S.areaWithDescendants("a-jc", catalog.areas), ["a-jc", "a-dt", "a-paulus"]);
  assert.deepEqual(S.areaWithDescendants("a-hob", catalog.areas), ["a-hob"]);
  // A cycle in bad data never loops forever.
  assert.deepEqual(S.areaWithDescendants("x", [{ id: "y", parent_area_id: "x" }, { id: "x", parent_area_id: "y" }]).sort(), ["x", "y"]);
});

test("scopes built from the catalog: Market, Area (+ descendants), labels, keys", () => {
  const m = S.scopeFromCatalog(catalog, "m-nj");
  assert.equal(m.kind, "market");
  assert.equal(m.label, "North Jersey");
  assert.equal(m.key, "north-jersey");
  const a = S.scopeFromCatalog(catalog, "m-nj", "a-dt");
  assert.equal(a.kind, "area");
  assert.equal(a.label, "Downtown JC", "display_name wins");
  assert.equal(a.context, "North Jersey");
  assert.deepEqual(a.areaIds, ["a-dt", "a-paulus"]);
  assert.equal(a.key, "north-jersey/downtown");
  assert.equal(S.scopeFromCatalog(catalog, "m-nj", "a-soho"), null, "an Area of another Market is not a scope");
  assert.equal(S.scopeFromCatalog(catalog, "nope"), null);
  assert.equal(S.cleanSlug("Jersey-City'; drop"), "jersey-citydrop");
});

test("one scope rule: in memory and pushed into the query agree", () => {
  const jc = S.scopeFromCatalog(catalog, "m-nj", "a-jc");
  const nj = S.scopeFromCatalog(catalog, "m-nj");
  assert.equal(S.locationInScope({ market_id: "m-nj", market_area_id: "a-paulus" }, jc), true);
  assert.equal(S.locationInScope({ market_id: "m-nj", market_area_id: "a-hob" }, jc), false);
  assert.equal(S.locationInScope({ market_id: "m-nj", market_area_id: null }, jc), false);
  assert.equal(S.locationInScope({ market_id: "m-nj", market_area_id: null }, nj), true);
  const calls = [];
  const q = { eq: (c, v) => (calls.push(["eq", c, v]), q), in: (c, v) => (calls.push(["in", c, v]), q) };
  S.scopeLocationFilter(q, jc, "locations.");
  S.scopeLocationFilter(q, nj);
  assert.deepEqual(calls, [["in", "locations.market_area_id", ["a-jc", "a-dt", "a-paulus"]], ["eq", "market_id", "m-nj"]]);
});

// ── Footprint / Growth Activity ─────────────────────────────────────────────

const place = (id) => ({ id, name: id, slug: id, city: null, state: null, imageUrl: null, unlisted: false, marketId: "m-nj", areaId: "a-jc" });
const row = (id, o = {}) => ({ place: place(id), ours: false, presence: null, placement: null, ...o });
const pres = (status, isPublic) => ({ status, relationships: ["sold_here"], public: isPublic });

test("public presence = live AND in date; pending / declined / out-of-date never are", () => {
  const today = "2026-10-22";
  assert.equal(R.isPublicPresence({ status: "live", startsOn: null, endsOn: null }, today), true);
  assert.equal(R.isPublicPresence({ status: "live", startsOn: "2026-10-22", endsOn: "2026-10-22" }, today), true);
  assert.equal(R.isPublicPresence({ status: "live", startsOn: "2026-10-23", endsOn: null }, today), false);
  assert.equal(R.isPublicPresence({ status: "live", startsOn: null, endsOn: "2026-10-21" }, today), false);
  assert.equal(R.isPublicPresence({ status: "pending", startsOn: null, endsOn: null }, today), false);
  assert.equal(R.isPublicPresence({ status: "declined", startsOn: null, endsOn: null }, today), false);
});

test("Current Footprint = Our Locations ∪ live in-date Find Us Here; Targets alone never count; no double count", () => {
  const rows = [
    row("ours", { ours: true }),
    row("ours+live", { ours: true, presence: pres("live", true) }),
    row("live", { presence: pres("live", true) }),
    row("live-expired", { presence: pres("live", false) }),
    row("pending", { presence: pres("pending", false), placement: { status: "placement_pending", nextAction: null, nextActionAt: null } }),
    row("declined", { presence: pres("declined", false) }),
    row("target", { placement: { status: "target", nextAction: null, nextActionAt: null } }),
    row("talking", { placement: { status: "in_conversation", nextAction: null, nextActionAt: null } }),
    row("active+live", { presence: pres("live", true), placement: { status: "active", nextAction: null, nextActionAt: null } }),
    row("passed", { placement: { status: "passed", nextAction: null, nextActionAt: null } }),
  ];
  const c = R.countRelationships(rows);
  assert.equal(c.footprint, 4, "ours, ours+live, live, active+live");
  assert.equal(c.ours, 2);
  assert.equal(c.publicPresence, 3);
  assert.equal(c.pendingReview, 1);
  assert.equal(c.pursuing, 4, "Growth Activity excludes Passed");
  assert.deepEqual(c.byStatus, { target: 1, in_conversation: 1, placement_pending: 1, active: 1, passed: 1 });
  assert.deepEqual(rows.filter(R.isFootprint).map((r) => r.place.id), ["ours", "ours+live", "live", "active+live"]);
  assert.deepEqual(R.countRelationships([]).footprint, 0);
});

test("the relationship reader is derived, bounded, and never reads internal notes or bd.*", () => {
  const src = read("src/lib/business-relationships.ts");
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /internal_notes/);
  assert.doesNotMatch(src, /schema\("bd"\)|\bbd\./);
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/, "read-only");
  assert.match(src, /const MAX_PAGES = 20;/);
  assert.match(src, /export const GEOGRAPHY_LIST_LIMIT = 50;/);
  for (const t of ["business_locations", "business_location_availability", "business_location_placements"]) assert.match(src, new RegExp(`from\\("${t}"\\)`));
  // No stored counters: no new table, and every count comes from countRelationships.
  assert.doesNotMatch(src, /from\("business_relationships"\)/);
  assert.match(src, /export const isFootprint = \(r: RelationshipRow\) => r\.ours \|\| Boolean\(r\.presence\?\.public\);/);
});

// ── Relevant Opportunities ──────────────────────────────────────────────────

const geo = (o = {}) => ({ locationId: null, marketId: null, areaId: null, areaName: null, marketName: null, ...o });
const locScope = { kind: "location", locationId: "l-cafe", marketId: "m-nj", areaAncestors: ["a-paulus", "a-dt", "a-jc"] };
const jcScope = { kind: "area", marketId: "m-nj", areaIds: ["a-jc", "a-dt", "a-paulus"], label: "Jersey City" };
const njScope = { kind: "market", marketId: "m-nj", label: "North Jersey" };

test("geography reasons: at the place, in an ancestor Area, in the Market — never elsewhere", () => {
  assert.equal(O.geographyReason(geo({ locationId: "l-cafe", marketId: "m-nj", areaId: "a-paulus" }), locScope), "At This Place");
  assert.equal(O.geographyReason(geo({ locationId: "l-other", marketId: "m-nj", areaId: "a-paulus" }), locScope), null, "another place in the same Area is not 'here'");
  assert.equal(O.geographyReason(geo({ areaId: "a-jc", areaName: "Jersey City", marketId: "m-nj" }), locScope), "In Jersey City");
  assert.equal(O.geographyReason(geo({ areaId: "a-hob", marketId: "m-nj" }), locScope), null);
  assert.equal(O.geographyReason(geo({ marketId: "m-nj", marketName: "North Jersey" }), locScope), "In North Jersey");
  assert.equal(O.geographyReason(geo({ marketId: "m-nyc" }), locScope), null);
  assert.equal(O.geographyReason(geo(), locScope), null, "no geography → not relevant to a place");

  assert.equal(O.geographyReason(geo({ locationId: "x", marketId: "m-nj", areaId: "a-dt" }), jcScope), "In Jersey City");
  assert.equal(O.geographyReason(geo({ marketId: "m-nj", marketName: "North Jersey" }), jcScope), "In North Jersey", "Market-wide covers the Area");
  assert.equal(O.geographyReason(geo({ areaId: "a-hob", marketId: "m-nj" }), jcScope), null);
  assert.equal(O.geographyReason(geo({ areaId: "a-hob", marketId: "m-nj" }), njScope), "In North Jersey");
  assert.equal(O.geographyReason(geo({ marketId: "m-nyc" }), njScope), null);
});

test("context reasons are plain, checkable labels — no scores or percentages", () => {
  const ctx = { priorityMarketIds: new Set(["m-nj"]), priorityAreaIds: new Set(), interests: new Set(["sampling_demos"]) };
  assert.deepEqual(O.contextReasons({ type: "sampling_demo", geo: geo({ marketId: "m-nj" }), sentToYou: true }, ctx), ["Sent To You", "Priority Market", "Matches Sampling & Demos Interest"]);
  assert.deepEqual(O.contextReasons({ type: "vending", geo: geo({ marketId: "m-nyc" }), sentToYou: false }, ctx), []);
  const areaCtx = { priorityMarketIds: new Set(), priorityAreaIds: new Set(["a-dt"]), interests: new Set() };
  assert.deepEqual(O.contextReasons({ type: "vending", geo: geo({ areaId: "a-dt", marketId: "m-nj" }), sentToYou: false }, areaCtx), ["Priority Market"]);
  const src = read("src/lib/relevant-opportunities-domain.ts") + read("src/lib/relevant-opportunities.ts");
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /score|percent|rank|openai|anthropic/i);
});

test("selection: in-scope only, Sent To You first, then soonest deadline; links to the Business's own pages", () => {
  const ctx = { priorityMarketIds: new Set(), priorityAreaIds: new Set(), interests: new Set() };
  const c = (id, o) => ({ listingId: id, title: id, type: "sampling_demo", placeName: null, startsAt: null, responseDeadline: null, recipientId: null, geo: geo({ marketId: "m-nj" }), ...o });
  const out = RO.selectRelevantOpportunities(BIZ, [
    c("open-late", { responseDeadline: "2026-12-01T00:00:00Z" }),
    c("open-soon", { responseDeadline: "2026-11-01T00:00:00Z" }),
    c("sent", { recipientId: "r1", responseDeadline: "2026-12-30T00:00:00Z" }),
    c("elsewhere", { geo: geo({ marketId: "m-nyc" }) }),
  ], njScope, ctx);
  assert.deepEqual(out.map((o) => o.listingId), ["sent", "open-soon", "open-late"]);
  assert.equal(out[0].path, `/account/business/${BIZ}/opportunities/r1`);
  assert.equal(out[1].path, `/account/business/${BIZ}/opportunities/explore/open-soon`);
  assert.deepEqual(out[0].reasons, ["In North Jersey", "Sent To You"]);
  assert.equal(RO.selectRelevantOpportunities(BIZ, [c("a"), c("b"), c("c")], njScope, ctx, 2).length, 2, "bounded");
});

test("candidates come only from opportunity_listings under the existing visibility rules", async () => {
  const src = read("src/lib/relevant-opportunities.ts");
  assert.doesNotMatch(src, /from\("opportunities"\)/, "never public.opportunities");
  assert.match(src, /getBusinessVisibility\(listing\.status, r\.status\) !== "active"/);
  assert.match(src, /isExplorable\(/);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /internal_notes/);

  // Behaviour against a fake client: a withdrawn/closed recipient never shows; a draft
  // discoverable listing never shows; geography falls back when the columns are missing.
  const calls = [];
  const rows = {
    opportunity_recipients: [
      { id: "r-open", status: "offered", listing: { id: "L1", status: "open", opportunity_type: "vending", title: "Sent", location_id: null, starts_at: null, response_deadline: null, market_id: "m-nj", market_area_id: null, location: null, market: { name: "North Jersey" }, area: null } },
      { id: "r-closed", status: "offered", listing: { id: "L2", status: "closed", opportunity_type: "vending", title: "Closed", location_id: null, starts_at: null, response_deadline: null, location: null } },
    ],
    opportunity_listings: [
      { id: "L3", status: "open", visibility: "discoverable", opportunity_type: "content", title: "Explore", location_id: "l-cafe", starts_at: null, response_deadline: null, location: { id: "l-cafe", name: "Cafe", market_id: "m-nj", market_area_id: "a-paulus" } },
      { id: "L1", status: "open", visibility: "discoverable", opportunity_type: "vending", title: "Sent", location_id: null, starts_at: null, response_deadline: null, market_id: "m-nj", location: null },
    ],
  };
  const fake = {
    from(table) {
      calls.push(table);
      const q = { select: () => q, eq: () => q, neq: () => q, order: () => q, limit: () => Promise.resolve({ data: rows[table], error: null }) };
      return q;
    },
  };
  const out = await RO.getOpportunityCandidates(fake, BIZ, new Date("2026-10-22T00:00:00Z"));
  assert.deepEqual(new Set(calls), new Set(["opportunity_recipients", "opportunity_listings"]));
  const visible = LD.getBusinessVisibility("closed", "offered");
  assert.deepEqual(out.map((o) => o.listingId).sort(), (visible === "active" ? ["L1", "L2", "L3"] : ["L1", "L3"]).sort());
  const sent = out.find((o) => o.listingId === "L1");
  assert.equal(sent.recipientId, "r-open", "a sent listing is not duplicated as an Explore one");
  assert.deepEqual(sent.geo, { locationId: null, marketId: "m-nj", areaId: null, areaName: null, marketName: "North Jersey" });
  assert.deepEqual(out.find((o) => o.listingId === "L3").geo.areaId, "a-paulus", "a Location's geography comes from the Location");
});

// ── Migration ───────────────────────────────────────────────────────────────

test("Opportunity geography migration: additive, nullable, ON DELETE SET NULL, no policy or grant changes", () => {
  const body = read("supabase/migrations/20261104000000_opportunity_listings_geography.sql").replace(/--.*$/gm, "").replace(/\bis not null\b/g, "");
  assert.doesNotMatch(body, /\bdrop\b|\bdelete\s+from|\btruncate\b|\bupdate\s+public\.|\bnot\s+null\b|\bdefault\b/i);
  assert.doesNotMatch(body, /create\s+policy|\bgrant\b|\brevoke\b|disable row level security/i);
  assert.doesNotMatch(body, /public\.opportunities\b/, "only the commercial table");
  assert.doesNotMatch(body, /\bbd\./);
  assert.match(body, /add column if not exists market_id uuid\s+constraint opportunity_listings_market_id_fkey references public\.markets\(id\) on delete set null/);
  assert.match(body, /add column if not exists market_area_id uuid\s+constraint opportunity_listings_market_area_id_fkey references public\.market_areas\(id\) on delete set null/);
  assert.match(body, /create index if not exists opportunity_listings_market_id_idx/);
  assert.match(body, /create index if not exists opportunity_listings_market_area_id_idx/);
});

// ── Admin create / edit ─────────────────────────────────────────────────────

test("admin validation: a Location clears the Market / Area; otherwise they are kept", () => {
  const base = { opportunity_type: "sampling_demo", title: "Sampling series", pricing_mode: "complimentary", price: "", currency: "USD" };
  const withLoc = LD.validateListingInput({ ...base, location_id: "l1", market_id: "m-nj", market_area_id: "a-jc" });
  assert.equal(withLoc.ok, true, withLoc.error);
  assert.equal(withLoc.value.market_id, null);
  assert.equal(withLoc.value.market_area_id, null);
  const areaWide = LD.validateListingInput({ ...base, location_id: "", market_id: "m-nj", market_area_id: "a-jc" });
  assert.equal(areaWide.value.market_id, "m-nj");
  assert.equal(areaWide.value.market_area_id, "a-jc");
  const none = LD.validateListingInput({ ...base });
  assert.equal(none.value.market_id, null);
  assert.equal(none.value.market_area_id, null);
});

test("admin actions validate the Area belongs to the Market, and the form offers both (optional)", () => {
  const actions = read("src/app/admin/(protected)/opportunities/actions.ts");
  assert.match(actions, /market_area_id/);
  assert.match(actions, /market_id/);
  const form = read("src/app/admin/(protected)/opportunities/OpportunityForm.tsx");
  assert.match(form, /Market \(optional\)/);
  assert.match(form, /Area \(optional\)/);
  for (const p of ["src/app/admin/(protected)/opportunities/new/page.tsx", "src/app/admin/(protected)/opportunities/[id]/edit/page.tsx"]) {
    assert.match(read(p), /markets=\{await getActiveMarketsWithAreaOptions\(\)\}/);
  }
});

// ── Relationship workspace ──────────────────────────────────────────────────

test("the workspace is addressed by Location; legacy `pt` resolves to it", () => {
  const page = read(PAGE);
  assert.match(page, /const requestedLoc = workspaceDoor && typeof rawSearchParams\.loc === "string" \? rawSearchParams\.loc : "";/);
  assert.match(page, /const legacyPt = workspaceDoor && !requestedLoc && typeof rawSearchParams\.pt === "string" \? rawSearchParams\.pt : "";/);
  assert.match(page, /const locationId = requestedLoc \|\| \(await getBusinessPlacement\(admin, id, legacyPt\)\)\?\.locationId \|\| "";/);
  assert.match(page, /getRelationshipWorkspace\(admin, id, locationId\)/);
  const list = read(`${V2}/TargetsView.tsx`);
  assert.match(list, /href\(\{ loc: i\.locationId, pt: null \}\)/, "Target rows open the workspace by place");
  assert.doesNotMatch(list, /function TargetDetail/);
  assert.match(read(`${V2}/GeographyViews.tsx`), /href\(\{ loc/);
});

test("workspace hierarchy and removed clutter", () => {
  const w = read(`${V2}/RelationshipWorkspace.tsx`);
  const body = w.slice(w.indexOf("export default function RelationshipWorkspace"), w.indexOf("// ── Status"));
  const order = ["<StatusControl", "<NextCard", "<SummaryBlock", "<ActivityFeed", "<Presence", "<OpportunityCards", "Appearances Here", "<InternalNotes"];
  const at = order.map((o) => body.indexOf(o));
  assert.ok(at.every((i) => i > 0), "every section present");
  assert.deepEqual([...at].sort((a, b) => a - b), at, "Primary → Next → Summary → Activity → Presence → Opportunities → Appearances → Findmi Internal");
  assert.doesNotMatch(w, /Notes are kept in order/);
  assert.match(w, /<details/, "Findmi Internal is collapsed");
  assert.match(w, /Add a note/i, "compact composer");
  // Status hints live in the picker, not as permanent text.
  assert.doesNotMatch(read(`${V2}/TargetsView.tsx`), /Notes are kept in order/);
});

test("Active → Add To Find Us Here reuses the existing editor and review; no auto-publish, no duplicates", () => {
  const w = read(`${V2}/RelationshipWorkspace.tsx`);
  assert.match(w, /const canAdd = canEdit && !presence && placement\?\.status === "active";/, "only Active, only when not already on Find Us Here");
  assert.match(w, /<PlaceForm [^>]*fixedPlace=\{fixedPlace\}/);
  assert.doesNotMatch(w, /requestAvailabilityAction|updateAvailabilityAction|business_location_availability/, "the editor owns the save path");
  assert.doesNotMatch(w, /status: "live"|"live" as/, "never publishes");
  const form = read(`${V2}/AvailableAtView.tsx`);
  assert.match(form, /fixedPlace\?: Place/);
  assert.match(form, /await requestAvailabilityAction\(businessId, \{ locationId: place\.id, \.\.\.fields \}\)/, "same moderated request path");
  // No lifecycle tie: Placement writes never touch Find Us Here.
  for (const f of ["src/lib/business-placements.ts", "src/app/(public)/account/business/[id]/placement-actions.ts"]) {
    assert.doesNotMatch(read(f), /business_location_availability/);
  }
});

test("appearance context reads exclude canceled appearances", () => {
  const src = read("src/lib/business-relationships.ts");
  assert.match(src, /from\("appearances"\)/);
  assert.match(src, /\.neq\("status", "canceled"\)/);
});

// ── Growth progressive disclosure ───────────────────────────────────────────

test("Growth: the full framework on Goals only; a compact expandable overview elsewhere", () => {
  const nav = read(`${V2}/GrowthNav.tsx`);
  assert.match(nav, /Growth Overview ▾/);
  assert.match(nav, /<details/);
  assert.match(nav, /active !== "goals"|active === "goals"/);
  assert.match(read(PAGE), /getGrowingIn\(/, "contextual Growing In links, no Markets destination");
});

// ── Needs Attention ─────────────────────────────────────────────────────────

test("Needs Attention: Target next steps due, and Opportunities awaiting a response", () => {
  const base = { businessId: BIZ, hasPrimaryMarket: true, pendingMarketRequestText: null, upcomingAppearances: [], newOrderCount: 0, profileIncomplete: false };
  const none = DASH.buildNeedsAttentionItems({ ...base });
  assert.equal(none.some((i) => i.id === "targets-due" || i.id === "opportunities-awaiting"), false);
  const one = DASH.buildNeedsAttentionItems({ ...base, dueTargets: { count: 1, first: { locationId: "l1", name: "Cafe", nextAction: "Send samples", overdue: true } }, opportunitiesAwaitingResponse: 2 });
  const due = one.find((i) => i.id === "targets-due");
  assert.equal(due.title, "Follow Up");
  assert.match(due.message, /Cafe: Send samples is overdue\./);
  assert.match(due.actionHref, /loc=l1/);
  const opp = one.find((i) => i.id === "opportunities-awaiting");
  assert.equal(opp.title, "2 Opportunities Need Response");
  assert.match(opp.actionHref, /tab=opportunities/);
  const many = DASH.buildNeedsAttentionItems({ ...base, dueTargets: { count: 3, first: { locationId: "l1", name: "Cafe", nextAction: null, overdue: false } } });
  assert.equal(many.find((i) => i.id === "targets-due").title, "3 Follow-Ups Due");
  assert.match(many.find((i) => i.id === "targets-due").actionHref, /view=targets/);
});

// ── Follow-up "today" is the app calendar day, not UTC ─────────────────────

function dueDb(rows) {
  const seen = {};
  const q = {
    select: () => q,
    eq: () => q,
    neq: () => q,
    lte: (c, v) => ((seen.lte = v), q),
    order: () => q,
    limit: () => {
      const hit = rows.filter((r) => r.next_action_at <= seen.lte).sort((a, b) => a.next_action_at.localeCompare(b.next_action_at));
      return Promise.resolve({ data: hit.slice(0, 1), count: hit.length, error: null });
    },
  };
  return { seen, from: () => q };
}
const dueRow = (d) => ({ location_id: "l1", next_action: "Send samples", next_action_at: d, locations: { name: "Cafe" } });

test("follow-up day: UTC past midnight is still the previous day in the app calendar (EDT and EST)", () => {
  // 10:30 PM Oct 21 in New York (EDT, UTC-4) is already Oct 22 in UTC.
  assert.equal(R.followUpToday(new Date("2026-10-22T02:30:00Z")), "2026-10-21");
  assert.equal(R.followUpToday(new Date("2026-10-22T04:00:00Z")), "2026-10-22", "midnight New York");
  // 11:30 PM Dec 1 in New York (EST, UTC-5).
  assert.equal(R.followUpToday(new Date("2026-12-02T04:30:00Z")), "2026-12-01");
  assert.equal(R.followUpToday(new Date("2026-12-02T05:00:00Z")), "2026-12-02");
});

test("a Next Action dated Oct 22 is not due on the evening of Oct 21, is due on Oct 22, overdue on Oct 23", async () => {
  const at = async (iso) => {
    const db = dueDb([dueRow("2026-10-22")]);
    const r = await R.getDueNextActions(db, BIZ, R.followUpToday(new Date(iso)));
    return { r, lte: db.seen.lte };
  };
  const eve = await at("2026-10-22T02:30:00Z"); // Oct 21, 10:30 PM New York
  assert.equal(eve.lte, "2026-10-21");
  assert.deepEqual(eve.r, { count: 0, first: null }, "not due early because UTC crossed midnight");
  const day = await at("2026-10-22T15:00:00Z");
  assert.equal(day.r.count, 1);
  assert.equal(day.r.first.overdue, false, "due today");
  const lateNight = await at("2026-10-23T03:30:00Z"); // still Oct 22, 11:30 PM New York
  assert.equal(lateNight.r.first.overdue, false, "still 'due today' until the app day ends");
  const next = await at("2026-10-23T12:00:00Z");
  assert.equal(next.r.first.overdue, true);
});

test("getDueNextActions defaults to the app calendar day", () => {
  const src = read("src/lib/business-relationships.ts");
  assert.match(src, /export async function getDueNextActions\(admin: SupabaseClient, businessId: string, today = followUpToday\(\)\)/);
  assert.match(src, /export const followUpToday = \(now: Date = new Date\(\)\) => todayIn\(undefined, now\);/);
});
