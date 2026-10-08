// Business-Facing Opportunities V1 — Business-safe state, permissions and
// privacy. Pure domain functions plus static guards over the Business
// route sources. No database. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUSINESS_RECIPIENT_COLUMNS,
  BUSINESS_RECIPIENT_LABELS,
  LISTING_STATUSES,
  RECIPIENT_STATUSES,
  canMemberRespond,
  checkBusinessResponse,
  getBusinessOpportunityState,
  getBusinessVisibility,
  isBusinessResponseStatus,
  toBusinessOpportunityView,
} from "../src/lib/opportunity-listings-domain.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const B = "src/app/(public)/account/business/[id]";
const DETAIL = read(`${B}/opportunities/[recipientId]/page.tsx`);
const ACTION = read(`${B}/opportunities/actions.ts`);
const VIEW = read(`${B}/v2/OpportunitiesView.tsx`);
const CARD = read("src/components/opportunities/BusinessOpportunityCard.tsx");
const LIB = read("src/lib/opportunity-listings.ts");

// ---------------------------------------------------------------- labels / states
test("offered is presented to the Business as Recommended", () => {
  assert.equal(BUSINESS_RECIPIENT_LABELS.offered, "Recommended");
  assert.equal(getBusinessOpportunityState("open", "offered").label, "Recommended");
});

test("Recommended on an open listing offers I'm Interested and Not Interested", () => {
  const s = getBusinessOpportunityState("open", "offered");
  assert.deepEqual(s.choices, ["interested", "not_interested"]);
  assert.equal(s.answerable, true);
});

test("Interested / Not Interested can change their mind only while open; no Withdraw", () => {
  assert.deepEqual(getBusinessOpportunityState("open", "interested").choices, ["not_interested"]);
  assert.deepEqual(getBusinessOpportunityState("open", "not_interested").choices, ["interested"]);
  for (const st of RECIPIENT_STATUSES) for (const ls of LISTING_STATUSES) {
    assert.equal(getBusinessOpportunityState(ls, st).choices.includes("withdrawn"), false);
  }
});

test("Confirmed / Completed / Cancelled are terminal for the Business (no self-confirm)", () => {
  for (const st of ["confirmed", "completed", "cancelled"]) {
    for (const ls of LISTING_STATUSES) assert.deepEqual(getBusinessOpportunityState(ls, st).choices, [], `${ls}/${st}`);
  }
  assert.equal(getBusinessOpportunityState("open", "confirmed").label, "Confirmed");
  assert.equal(getBusinessOpportunityState("closed", "completed").label, "Completed");
});

test("closed / archived after being offered: no longer answerable", () => {
  assert.equal(getBusinessOpportunityState("closed", "offered").label, "No Longer Available");
  assert.deepEqual(getBusinessOpportunityState("closed", "offered").choices, []);
  assert.deepEqual(getBusinessOpportunityState("archived", "interested").choices, []);
  // and the visibility rule still hides unresolved offers on archived listings
  assert.equal(getBusinessVisibility("archived", "offered"), "hidden");
  assert.equal(getBusinessVisibility("open", "withdrawn"), "hidden");
});

test("every offered choice is one the server would accept for an owner", () => {
  for (const ls of LISTING_STATUSES) for (const st of RECIPIENT_STATUSES) {
    for (const choice of getBusinessOpportunityState(ls, st).choices) {
      const check = checkBusinessResponse({ role: "owner", listingStatus: ls, currentStatus: st, nextStatus: choice });
      assert.equal(check.ok, true, `${ls}/${st} -> ${choice}`);
    }
  }
});

// ---------------------------------------------------------------- permissions
test("owner and manager may respond; staff and Admin Manage-As may not", () => {
  assert.equal(canMemberRespond("owner"), true);
  assert.equal(canMemberRespond("manager"), true);
  assert.equal(canMemberRespond("staff"), false);
  assert.equal(canMemberRespond("owner", true), false);
  // server rule agrees
  assert.equal(checkBusinessResponse({ role: "staff", listingStatus: "open", currentStatus: "offered", nextStatus: "interested" }).ok, false);
  assert.equal(checkBusinessResponse({ role: "manager", listingStatus: "open", currentStatus: "offered", nextStatus: "interested" }).ok, true);
});

test("the response action only accepts the two Business responses and defers to the canonical write", () => {
  assert.equal(isBusinessResponseStatus("interested"), true);
  assert.equal(isBusinessResponseStatus("not_interested"), true);
  for (const bad of ["confirmed", "withdrawn", "completed", "offered", ""]) assert.equal(isBusinessResponseStatus(bad), false);
  assert.match(ACTION, /respondToOpportunityListing\(\{ businessId, recipientId, response \}\)/);
  assert.equal(/getAdminSupabase|\.update\(|\.insert\(/.test(strip(ACTION)), false, "no direct writes in the action");
});

test("Opportunities Cleanup Pass A — a response notifies Admin (never the Business) via the canonical notifyAdmin, not a new email path", () => {
  // The ACTION/DETAIL files themselves stay thin — the notification lives
  // in the canonical LIB write path, same layering as every other
  // responsibility of respondToOpportunityListing/expressExploreInterest.
  for (const src of [ACTION, DETAIL]) assert.equal(/resend|sendEmail|sendProductNotification/i.test(strip(src)), false);
  assert.match(LIB, /import \{ notifyAdmin \} from "@\/lib\/notifications\/adminNotify";/);
  const respond = LIB.slice(LIB.indexOf("export async function respondToOpportunityListing("), LIB.indexOf("\n}\n", LIB.indexOf("export async function respondToOpportunityListing(")));
  const explore = LIB.slice(LIB.indexOf("export async function expressExploreInterest("), LIB.indexOf("\n}\n", LIB.indexOf("export async function expressExploreInterest(")));
  for (const [name, body] of [["respondToOpportunityListing", respond], ["expressExploreInterest", explore]]) {
    assert.match(body, /await notifyAdmin\(\{/, name);
    assert.equal(/sendProductNotification|getEntityManagerEmails/.test(body), false, `${name} never emails the Business`);
  }
});

// ---------------------------------------------------------------- privacy
test("the Business view model carries no Admin-only or private fields", () => {
  const view = toBusinessOpportunityView(
    { id: "r1", status: "offered", fit_note: "Fit", offered_at: "t", responded_at: null, internal_notes: "SECRET", responded_by_user_id: "u", listing_id: "L", business_id: "b" },
    {
      id: "L", status: "open", internal_notes: "SECRET", created_at: "c", updated_at: "u", location_id: "loc", event_id: "ev",
      opportunity_type: "sampling_demo", title: "T", summary: null, description: null, image_url: null, place_text: null, host_name: null,
      starts_at: null, ends_at: null, timing_note: null, response_deadline: null, pricing_mode: "fixed", price_cents: 75000, currency: "USD",
      credits_eligible: true, whats_included: null, requirements: null,
    }
  );
  const json = JSON.stringify(view);
  assert.equal(json.includes("SECRET"), false);
  for (const k of ["fit_note", "fitNote", "internal_notes", "responded_by_user_id", "listing_id", "business_id", "location_id", "event_id", "created_at", "updated_at"]) {
    assert.equal(json.includes(`"${k}"`), false, k);
  }
  assert.equal("status" in view.opportunity, false, "listing status is not exposed");
  assert.deepEqual(Object.keys(view).sort(), ["group", "offeredAt", "opportunity", "recipientId", "respondedAt", "state", "status"]);
  assert.equal(json.includes("Fit"), false, "fit note text never carried");
});

test("Business reads are scoped to the Business and use explicit safe columns", () => {
  const fn = (name) => { const at = LIB.indexOf(`export async function ${name}(`); return LIB.slice(at, LIB.indexOf("\n}\n", at)); };
  for (const name of ["getBusinessOpportunityItems", "getBusinessOpportunityItem"]) {
    const body = fn(name);
    assert.match(body, /await requireBusinessMember\(businessId\)/, name);
    assert.match(body, /\.eq\("business_id", businessId\)/, name);
    assert.match(body, /BUSINESS_RECIPIENT_COLUMNS/, name);
    assert.match(body, /BUSINESS_LISTING_COLUMNS/, name);
    assert.equal(/select\("\*/.test(body), false, name);
  }
  assert.match(fn("getBusinessOpportunityItem"), /\.eq\("id", recipientId\)/);
  const embeds = LIB.match(/const BUSINESS_CONTEXT_EMBEDS = "([^"]+)"/)[1];
  assert.equal(/internal|notes|\*/.test(embeds), false);
});

test("Business files never touch Admin-only data or Admin reads", () => {
  for (const src of [DETAIL, VIEW, CARD, ACTION]) {
    assert.equal(/internal_notes|getAdminOpportunity|requireAdmin|recipient_count|counts\b/.test(strip(src)), false);
  }
  assert.match(DETAIL, /getBusinessOpportunityItem\(id, recipientId\)/);
  assert.match(DETAIL, /if \(!item\) notFound\(\)/);
});

test("credits are informational only, and removed entirely from business-facing presentation", () => {
  for (const src of [DETAIL, VIEW, CARD]) assert.equal(/balance|deduct|redeem|checkout|ledger/i.test(strip(src)), false);
  // Opportunities Cleanup Pass A — "Credits Eligible" is dormant
  // infrastructure with no working redemption mechanism; the business
  // detail/explore pages opt out of the shared component's Credits fact
  // via showCredits={false}, and the business-only card component never
  // renders it at all (CreditIcon import removed entirely).
  const EXPLORE_DETAIL = read(`${B}/opportunities/explore/[listingId]/page.tsx`);
  for (const src of [DETAIL, EXPLORE_DETAIL]) assert.match(src, /showCredits=\{false\}/);
  assert.equal(/Credits Eligible|CreditIcon/.test(CARD), false);
});

// ---------------------------------------------------------------- event participation preserved
test("Opportunities Cleanup Pass A — commercial Opportunities no longer embed Event Invitations & Applications", () => {
  // That section (and respondToEventInvitation) used to be rendered
  // unconditionally at the bottom of every commercial Opportunities view —
  // removed per the Product Decision that Event participation is not a
  // commercial "Opportunity." The underlying Event-participation system
  // (lib/opportunities.ts, event_businesses/event_occurrence_businesses,
  // and the Inbox's own Event Invitations filter) is untouched — only this
  // view no longer renders it.
  assert.equal(/Event Invitations/.test(strip(VIEW)), false);
  assert.equal(/respondToEventInvitation/.test(strip(VIEW)), false);
  assert.equal(/EventParticipationSection/.test(VIEW), false);
  assert.match(VIEW, /Recommended For You/);
  assert.equal(/from\("opportunities"\)/.test(LIB), false);
});

// ---------------------------------------------------------------- fit note is Admin-only
test("fit_note is never selected, modelled or rendered for a Business", () => {
  const cols = BUSINESS_RECIPIENT_COLUMNS.split(",").map((c) => c.trim());
  assert.equal(cols.includes("fit_note"), false);
  for (const src of [DETAIL, VIEW, CARD, ACTION]) {
    assert.equal(/fit_note|fitNote|Why Findmi Recommended/i.test(strip(src)), false);
  }
  // Business server reads only ever use the explicit Business column list.
  const businessFns = ["getBusinessOpportunityItems", "getBusinessOpportunityItem", "getBusinessOpportunities", "getBusinessOpportunity"];
  for (const name of businessFns) {
    const at = LIB.indexOf(`export async function ${name}(`);
    const body = LIB.slice(at, LIB.indexOf("\n}\n", at));
    assert.equal(/fit_note/.test(body), false, name);
  }
  // The Business recipient interface has no fit_note; only the Admin one does.
  const bizIface = LIB.slice(LIB.indexOf("export interface BusinessOpportunityRecipient"), LIB.indexOf("}", LIB.indexOf("export interface BusinessOpportunityRecipient")));
  assert.equal(/fit_note/.test(bizIface), false);
  const adminIface = LIB.slice(LIB.indexOf("export interface AdminOpportunityRecipient"), LIB.indexOf("}", LIB.indexOf("export interface AdminOpportunityRecipient")));
  assert.match(adminIface, /fit_note/);
});
