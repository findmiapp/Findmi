// Opportunities V2 — Business goals, Explore discoverability, the
// Opportunities IA and Home/Add entry points. Pure domain functions plus
// static guards over sources and the (unapplied) migration. No database.
// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GOAL_BUDGET,
  GOAL_BUDGET_BANDS,
  GOAL_INTERESTS,
  GOAL_OBJECTIVES,
  GOAL_STATUSES,
  GOAL_TIMINGS,
  canGoalTransition,
  canManageGoals,
  formatGoalTiming,
  suggestGoalTitle,
  validateGoalInput,
} from "../src/lib/opportunity-goals-domain.ts";
import {
  BUSINESS_LISTING_COLUMNS,
  LISTING_VISIBILITIES,
  businessOpportunityGroup,
  checkExploreInterest,
  isExplorable,
  matchesExploreFilters,
} from "../src/lib/opportunity-listings-domain.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const MIGRATION = read("supabase/migrations/20261007000000_opportunity_goals_and_discoverability.sql");
const GOALS_LIB = read("src/lib/opportunity-goals.ts");
const LISTINGS_LIB = read("src/lib/opportunity-listings.ts");
const B = "src/app/(public)/account/business/[id]";
const VIEW = read(`${B}/v2/OpportunitiesView.tsx`);
const HOME = read(`${B}/v2/BusinessHome.tsx`);
const ADD = read(`${B}/v2/AddToPresence.tsx`);
const EXPLORE_PAGE = read(`${B}/opportunities/explore/[listingId]/page.tsx`);
const WIZARD = read(`${B}/opportunities/goals/GoalWizard.tsx`);
const DASHBOARD = read("src/lib/business-dashboard.ts");
const NOW = new Date("2026-10-07T12:00:00Z");
const MARKETS = new Set(["m-nyc", "m-nj"]);

const goal = (over = {}) => ({
  title: "Holiday Tabli Sales",
  objectives: ["drive_sales", "product_sampling"],
  opportunity_interests: ["residential", "retail", "sampling_demos"],
  audience_text: "Apartment residents",
  market_ids: ["m-nyc", "m-nj"],
  markets_text: null,
  budget_band: "1k_2_5k",
  timing: "specific_dates",
  starts_on: "2026-10-01",
  ends_on: "2026-12-31",
  notes: null,
  ...over,
});

// ---------------------------------------------------------------- goal validation
test("goal: a valid payload normalizes, with a derived budget range", () => {
  const r = validateGoalInput(goal(), MARKETS);
  assert.equal(r.ok, true);
  assert.equal(r.value.budget_min_cents, 100_000);
  assert.equal(r.value.budget_max_cents, 250_000);
  assert.deepEqual(r.value.market_ids, ["m-nyc", "m-nj"]);
  assert.equal("status" in r.value, false, "status is never taken from the form");
  assert.equal("business_id" in r.value, false, "business_id is never taken from the form");
  assert.equal("created_by_user_id" in r.value, false);
});

test("goal: multiple selections required and validated", () => {
  assert.equal(validateGoalInput(goal({ objectives: [] }), MARKETS).ok, false);
  assert.equal(validateGoalInput(goal({ opportunity_interests: [] }), MARKETS).ok, false);
  assert.equal(validateGoalInput(goal({ objectives: ["world_domination"] }), MARKETS).ok, false);
  assert.equal(validateGoalInput(goal({ opportunity_interests: ["event_invitation"] }), MARKETS).ok, false);
  assert.equal(validateGoalInput(goal({ market_ids: ["m-unknown"] }), MARKETS).ok, false);
  assert.equal(validateGoalInput(goal({ budget_band: "lots" }), MARKETS).ok, false);
  assert.equal(validateGoalInput(goal({ timing: "someday" }), MARKETS).ok, false);
  // duplicates collapse
  assert.deepEqual(validateGoalInput(goal({ objectives: ["drive_sales", "drive_sales"] }), MARKETS).value.objectives, ["drive_sales"]);
});

test("goal: dates only for Specific Dates, start required, end not before start", () => {
  assert.equal(validateGoalInput(goal({ starts_on: "" }), MARKETS).ok, false);
  assert.equal(validateGoalInput(goal({ starts_on: "2026-12-31", ends_on: "2026-10-01" }), MARKETS).ok, false);
  const ongoing = validateGoalInput(goal({ timing: "ongoing" }), MARKETS);
  assert.equal(ongoing.ok, true);
  assert.equal(ongoing.value.starts_on, null);
  assert.equal(ongoing.value.ends_on, null);
});

test("goal: open-ended budgets store null bounds", () => {
  for (const band of ["flexible", "not_sure"]) {
    const r = validateGoalInput(goal({ budget_band: band }), MARKETS);
    assert.equal(r.value.budget_min_cents, null);
    assert.equal(r.value.budget_max_cents, null);
  }
  assert.equal(validateGoalInput(goal({ budget_band: "10k_plus" }), MARKETS).value.budget_max_cents, null);
});

test("goal: title is editable, suggested when blank, length-limited", () => {
  assert.equal(validateGoalInput(goal({ title: "  " }), MARKETS).value.title, "Drive Sales · Residential");
  assert.equal(validateGoalInput(goal({ title: "x".repeat(121) }), MARKETS).ok, false);
  assert.equal(suggestGoalTitle(["something_else"], ["open_to_ideas"]), "Something Else · Open To Ideas");
  assert.equal(formatGoalTiming({ timing: "ongoing", starts_on: null, ends_on: null }), "Ongoing");
  assert.equal(formatGoalTiming({ timing: "specific_dates", starts_on: "2026-10-01", ends_on: "2026-12-31" }), "Oct 1, 2026 – Dec 31, 2026");
});

test("goal: status transitions (pause/resume/close/reopen) and never delete", () => {
  assert.ok(canGoalTransition("active", "paused"));
  assert.ok(canGoalTransition("paused", "active"));
  assert.ok(canGoalTransition("active", "closed"));
  assert.ok(canGoalTransition("closed", "active"));
  assert.equal(canGoalTransition("closed", "paused"), false);
  assert.equal(canGoalTransition("active", "active"), false);
  assert.equal(/\.delete\(/.test(GOALS_LIB), false);
});

test("goal permissions: owner/manager manage; staff and Admin Manage-As don't", () => {
  assert.equal(canManageGoals("owner"), true);
  assert.equal(canManageGoals("manager"), true);
  assert.equal(canManageGoals("staff"), false);
  assert.equal(canManageGoals("owner", true), false);
});

// ---------------------------------------------------------------- goal privacy
test("goal reads/writes are authorized and scoped to the Business", () => {
  const fn = (name) => {
    const at = GOALS_LIB.indexOf(`export async function ${name}(`);
    return GOALS_LIB.slice(at, GOALS_LIB.indexOf("\n}\n", at));
  };
  for (const name of ["getBusinessGoals", "getBusinessGoal"]) {
    assert.match(fn(name), /await requireBusinessMember\(businessId\)/, name);
    assert.match(fn(name), /\.eq\("business_id", businessId\)/, name);
  }
  for (const name of ["createBusinessGoal", "updateBusinessGoal", "setBusinessGoalStatus"]) {
    assert.match(fn(name), /await authorizeManage\(businessId\)/, name);
  }
  assert.match(fn("updateBusinessGoal"), /\.eq\("business_id", businessId\)/);
  assert.match(fn("setBusinessGoalStatus"), /\.eq\("business_id", businessId\)/);
  assert.match(fn("createBusinessGoal"), /business_id: businessId/);
  assert.match(fn("getAdminBusinessGoals"), /await requireAdmin\(\)/);
  assert.match(GOALS_LIB.slice(GOALS_LIB.indexOf("async function authorizeManage")), /canManageGoals\(membership\.role, membership\.viaAdmin\)/);
  const cols = GOALS_LIB.match(/const GOAL_COLUMNS =\s*"([^"]+)"/)[1];
  assert.equal(cols.includes("created_by_user_id"), false, "author id is not part of the Business shape");
});

// ---------------------------------------------------------------- migration
test("migration: additive, private by default, server-only goals table", () => {
  assert.match(MIGRATION, /add column if not exists visibility text not null default 'private'/);
  assert.match(MIGRATION, /alter table public\.business_opportunity_goals enable row level security/);
  assert.match(MIGRATION, /revoke all on public\.business_opportunity_goals from anon, authenticated/);
  assert.equal(/create policy/i.test(MIGRATION), false, "no client policies");
  assert.equal(/\bdrop table\b|\bdelete from\b|\btruncate\b|drop column/i.test(MIGRATION), false, "nothing destructive");
  assert.match(MIGRATION, /references public\.businesses \(id\) on delete cascade/);
});

test("migration CHECK lists match the domain constants", () => {
  const list = (re) => [...MIGRATION.match(re)[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(list(/visibility in \(([^)]*)\)/), [...LISTING_VISIBILITIES]);
  assert.deepEqual(list(/status in \(([^)]*)\)/), [...GOAL_STATUSES]);
  assert.deepEqual(list(/objectives <@ array\[([^\]]*)\]/), [...GOAL_OBJECTIVES]);
  assert.deepEqual(list(/opportunity_interests <@ array\[([^\]]*)\]/), [...GOAL_INTERESTS]);
  assert.deepEqual(list(/budget_band in \(([^)]*)\)/), [...GOAL_BUDGET_BANDS]);
  assert.deepEqual(list(/timing in \(([^)]*)\)/), [...GOAL_TIMINGS]);
  assert.deepEqual(Object.keys(GOAL_BUDGET), [...GOAL_BUDGET_BANDS]);
});

// ---------------------------------------------------------------- explore
const listing = (over = {}) => ({
  visibility: "discoverable",
  status: "open",
  response_deadline: null,
  opportunity_type: "sampling_demo",
  title: "Lobby Sampling",
  summary: "Coffee sampling",
  place_text: "Hoboken, NJ",
  host_name: "Harbor Lofts",
  starts_at: null,
  pricing_mode: "fixed",
  price_cents: 75_000,
  location: null,
  ...over,
});

test("explore: only explicitly discoverable, open, not-expired listings", () => {
  assert.equal(isExplorable(listing(), NOW), true);
  assert.equal(isExplorable(listing({ visibility: "private" }), NOW), false);
  assert.equal(isExplorable(listing({ visibility: undefined }), NOW), false, "pre-migration rows are private");
  for (const status of ["draft", "closed", "archived"]) assert.equal(isExplorable(listing({ status }), NOW), false, status);
  assert.equal(isExplorable(listing({ response_deadline: "2026-10-01T00:00:00Z" }), NOW), false);
  assert.equal(isExplorable(listing({ response_deadline: "2026-10-30T00:00:00Z" }), NOW), true);
});

test("explore: filters", () => {
  const f = (filters, over) => matchesExploreFilters(listing(over), filters, NOW);
  assert.equal(f({ type: "vending" }), false);
  assert.equal(f({ type: "sampling_demo" }), true);
  assert.equal(f({ q: "coffee" }), true);
  assert.equal(f({ q: "tea" }), false);
  assert.equal(f({ where: "hoboken" }), true);
  assert.equal(f({ where: "boston" }), false);
  assert.equal(f({ where: "jersey" }, { place_text: null, location: { name: "3 Acres", city: "Jersey City", state: "NJ" } }), true);
  assert.equal(f({ timing: "flexible" }), true);
  assert.equal(f({ timing: "next_30_days" }), false);
  assert.equal(f({ timing: "next_30_days" }, { starts_at: "2026-10-20T00:00:00Z" }), true);
  assert.equal(f({ timing: "next_30_days" }, { starts_at: "2026-12-20T00:00:00Z" }), false);
  // Pass 3 — commercial-terms filtering (Participation Cost) moved entirely
  // to matchesParticipationCost() in opportunity-participation-cost.ts;
  // matchesExploreFilters no longer inspects pricing_mode/price_cents at
  // all (see tests/opportunity-business-commercial-terms.test.mjs).
});

test("explore interest: owner/manager only, explorable, no existing relationship", () => {
  assert.equal(checkExploreInterest({ role: "owner", explorable: true, alreadyLinked: false }).ok, true);
  assert.equal(checkExploreInterest({ role: "manager", explorable: true, alreadyLinked: false }).ok, true);
  assert.equal(checkExploreInterest({ role: "staff", explorable: true, alreadyLinked: false }).ok, false);
  assert.equal(checkExploreInterest({ role: "owner", viaAdmin: true, explorable: true, alreadyLinked: false }).ok, false);
  assert.equal(checkExploreInterest({ role: "owner", explorable: false, alreadyLinked: false }).ok, false);
  assert.equal(checkExploreInterest({ role: "owner", explorable: true, alreadyLinked: true }).ok, false);
});

test("explore reads are Business-safe and filter on visibility server-side", () => {
  const at = LISTINGS_LIB.indexOf("export async function getExploreItems(");
  const body = LISTINGS_LIB.slice(at, LISTINGS_LIB.indexOf("\n}\n", at));
  assert.match(body, /await requireBusinessMember\(businessId\)/);
  assert.match(body, /\.eq\("visibility", "discoverable"\)/);
  assert.match(body, /\.eq\("status", "open"\)/);
  assert.match(body, /isExplorable\(/);
  const cols = LISTINGS_LIB.match(/const EXPLORE_COLUMNS = `([^`]+)`/)[1];
  assert.match(cols, /BUSINESS_LISTING_COLUMNS/);
  for (const secret of ["internal_notes", "fit_note", "responded_by_user_id"]) {
    assert.equal(cols.includes(secret), false);
    assert.equal(BUSINESS_LISTING_COLUMNS.includes(secret), false);
  }
  const detail = LISTINGS_LIB.slice(LISTINGS_LIB.indexOf("export async function getExploreItem("));
  assert.match(detail.slice(0, detail.indexOf("\n}\n")), /if \(!isExplorable\(/);
  // linked recipient lookup is scoped to this Business
  assert.match(LISTINGS_LIB, /\.from\("opportunity_recipients"\)\.select\("id, listing_id"\)\.eq\("business_id", businessId\)/);
  assert.match(EXPLORE_PAGE, /if \(!item\) notFound\(\)/);
  for (const src of [VIEW, EXPLORE_PAGE]) assert.equal(/internal_notes|fit_note|fitNote/.test(strip(src)), false);
});

// ---------------------------------------------------------------- IA
test("business groups: For You / Interested / Confirmed / Past", () => {
  assert.equal(businessOpportunityGroup("open", "offered"), "for_you");
  assert.equal(businessOpportunityGroup("closed", "offered"), "past");
  assert.equal(businessOpportunityGroup("open", "interested"), "interested");
  assert.equal(businessOpportunityGroup("open", "confirmed"), "confirmed");
  assert.equal(businessOpportunityGroup("closed", "confirmed"), "confirmed");
  for (const s of ["not_interested", "completed", "cancelled"]) assert.equal(businessOpportunityGroup("open", s), "past", s);
});

test("Opportunities page has the four views and no longer embeds Event participation", () => {
  for (const label of ['"For You"', '"Explore"', '"Your Opportunities"', '"Your Goals"']) assert.ok(VIEW.includes(label), label);
  // Opportunities Cleanup Pass A — Event participation moved out of this
  // view entirely (it's managed from the Inbox/Event participants screen
  // instead); commercial Opportunities and Event participation are no
  // longer rendered on the same page.
  assert.equal(/Event Invitations/.test(strip(VIEW)), false);
  assert.equal(/respondToEventInvitation/.test(strip(VIEW)), false);
  assert.equal(/Event Opportunities/.test(VIEW), false);
});

// ---------------------------------------------------------------- Home + Add
test("Home: Opportunities section; no informational Needs Attention item", () => {
  assert.match(HOME, /<HomeOpportunities basePath=\{basePath\} items=\{opportunityItems\} \/>/);
  // Business Overview Information-Hierarchy pass — Opportunities moved
  // BELOW the business's own operational sections (it used to outrank
  // Needs Attention, making its own empty state the first substantive
  // section a new business saw). See tests/business-overview-hierarchy.test.mjs
  // for the full render-order regression coverage.
  assert.ok(HOME.indexOf('aria-labelledby="needs-attention"') < HOME.indexOf("<HomeOpportunities"), "Needs Attention above Opportunities");
  assert.ok(HOME.indexOf('aria-labelledby="needs-attention"') < HOME.indexOf('aria-labelledby="coming-up"'));
  assert.match(HOME, /needsAttention\.length > 0 &&/);
  assert.match(HOME, /Explore Opportunities/);
  assert.match(HOME, /Tell Findmi What You Need/);
  assert.equal(/No recommendations yet/.test(HOME), false);
  assert.equal(/Nothing happening yet/.test(DASHBOARD), false);
});

test("Add modal: six intents, canonical Moment route, Grow Your Business", () => {
  for (const t of ["Add Moment", "Host Something", "Go Somewhere", "Add A Location", "Find An Opportunity", "Tell Findmi Your Goals"]) assert.ok(ADD.includes(`"${t}"`), t);
  assert.match(ADD, /\/my-world\/journal\/new\?business=/);
  assert.match(ADD, /Grow Your Business/);
  assert.match(ADD, /\?tab=opportunities&view=explore/);
  assert.match(ADD, /\/opportunities\/goals\/new/);
});

test("Goal wizard posts every answer and never submits early", () => {
  for (const name of ["objectives", "opportunity_interests", "market_ids", "budget_band", "timing", "title"]) assert.match(WIZARD, new RegExp(`name="${name}"`));
  assert.match(WIZARD, /e\.key === "Enter" && current !== "review"/);
  assert.match(WIZARD, /Submit Goals|submitLabel/);
});
