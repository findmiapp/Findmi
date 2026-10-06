// Opportunities V1 domain rules — run with `npm test`
// (node --experimental-strip-types --test tests/*.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPPORTUNITY_TYPES,
  isOpportunityType,
  validatePricing,
  formatOpportunityPrice,
  checkBusinessResponse,
  canAdminTransition,
  getBusinessVisibility,
} from "../src/lib/opportunity-listings-domain.ts";

// ---------------------------------------------------------------- pricing
test("pricing: fixed and starting_at require a positive amount", () => {
  assert.equal(validatePricing({ pricing_mode: "fixed", price_cents: 75000, credits_eligible: true }), null);
  assert.ok(validatePricing({ pricing_mode: "fixed", price_cents: null, credits_eligible: false }));
  assert.ok(validatePricing({ pricing_mode: "fixed", price_cents: 0, credits_eligible: false }));
  assert.equal(validatePricing({ pricing_mode: "starting_at", price_cents: 150000, credits_eligible: false }), null);
  assert.ok(validatePricing({ pricing_mode: "starting_at", price_cents: null, credits_eligible: false }));
});

test("pricing: complimentary and custom reject an amount", () => {
  assert.equal(validatePricing({ pricing_mode: "complimentary", price_cents: null, credits_eligible: false }), null);
  assert.ok(validatePricing({ pricing_mode: "complimentary", price_cents: 100, credits_eligible: false }));
  assert.equal(validatePricing({ pricing_mode: "custom", price_cents: null, credits_eligible: true }), null);
  assert.ok(validatePricing({ pricing_mode: "custom", price_cents: 100, credits_eligible: false }));
});

test("pricing: complimentary can't be credit eligible", () => {
  assert.ok(validatePricing({ pricing_mode: "complimentary", price_cents: null, credits_eligible: true }));
});

test("pricing: display strings", () => {
  assert.equal(formatOpportunityPrice({ pricing_mode: "fixed", price_cents: 75000, currency: "USD" }), "$750");
  assert.equal(formatOpportunityPrice({ pricing_mode: "starting_at", price_cents: 150000, currency: "USD" }), "Starting at $1,500");
  assert.equal(formatOpportunityPrice({ pricing_mode: "fixed", price_cents: 74950, currency: "USD" }), "$749.50");
  assert.equal(formatOpportunityPrice({ pricing_mode: "complimentary", price_cents: null, currency: "USD" }), "Complimentary");
  assert.equal(formatOpportunityPrice({ pricing_mode: "custom", price_cents: null, currency: "USD" }), "Contact Findmi");
});

// ---------------------------------------------------------------- types
test("types: exactly the approved V1 list", () => {
  assert.deepEqual([...OPPORTUNITY_TYPES], ["activation", "sampling_demo", "vending", "sponsorship", "content", "partnership", "other"]);
  for (const t of OPPORTUNITY_TYPES) assert.ok(isOpportunityType(t));
  for (const bad of ["sampling", "demo", "pop_up", "community", "Activation", "", null]) assert.equal(isOpportunityType(bad), false);
});

// ---------------------------------------------------------------- business transitions
const base = { listingStatus: "open", viaAdmin: false };
test("business: owner/manager can answer offered -> interested / not_interested", () => {
  for (const role of ["owner", "manager"]) {
    assert.deepEqual(checkBusinessResponse({ ...base, role, currentStatus: "offered", nextStatus: "interested" }), { ok: true });
    assert.deepEqual(checkBusinessResponse({ ...base, role, currentStatus: "offered", nextStatus: "not_interested" }), { ok: true });
  }
});

test("business: can change mind while open (not_interested <-> interested)", () => {
  assert.equal(checkBusinessResponse({ ...base, role: "owner", currentStatus: "not_interested", nextStatus: "interested" }).ok, true);
  assert.equal(checkBusinessResponse({ ...base, role: "manager", currentStatus: "interested", nextStatus: "not_interested" }).ok, true);
});

test("business: staff can never respond", () => {
  assert.equal(checkBusinessResponse({ ...base, role: "staff", currentStatus: "offered", nextStatus: "interested" }).ok, false);
});

test("business: admin Manage-As can't respond as the Business", () => {
  assert.equal(checkBusinessResponse({ ...base, role: "owner", viaAdmin: true, currentStatus: "offered", nextStatus: "interested" }).ok, false);
});

test("business: listing must be open", () => {
  for (const listingStatus of ["draft", "closed", "archived"])
    assert.equal(checkBusinessResponse({ role: "owner", listingStatus, currentStatus: "offered", nextStatus: "interested" }).ok, false);
});

test("business: can't alter Findmi-controlled outcomes or pick admin statuses", () => {
  for (const currentStatus of ["confirmed", "completed", "cancelled", "withdrawn"])
    assert.equal(checkBusinessResponse({ ...base, role: "owner", currentStatus, nextStatus: "interested" }).ok, false);
  for (const nextStatus of ["confirmed", "completed", "cancelled", "withdrawn", "offered"])
    assert.equal(checkBusinessResponse({ ...base, role: "owner", currentStatus: "interested", nextStatus }).ok, false);
  assert.equal(checkBusinessResponse({ ...base, role: "owner", currentStatus: "interested", nextStatus: "interested" }).ok, false);
});

// ---------------------------------------------------------------- admin transitions
test("admin: offline confirmation straight from offered is allowed", () => {
  assert.equal(canAdminTransition("offered", "confirmed"), true);
  assert.equal(canAdminTransition("interested", "confirmed"), true);
  assert.equal(canAdminTransition("confirmed", "completed"), true);
  assert.equal(canAdminTransition("interested", "cancelled"), true);
  assert.equal(canAdminTransition("confirmed", "cancelled"), true);
  assert.equal(canAdminTransition("offered", "withdrawn"), true);
});

test("admin: never fabricates a Business response", () => {
  // Admin can't move anyone INTO a Business-chosen answer from a fresh offer.
  assert.equal(canAdminTransition("offered", "interested"), false);
  assert.equal(canAdminTransition("offered", "not_interested"), false);
  assert.equal(canAdminTransition("completed", "offered"), false);
});

// ---------------------------------------------------------------- visibility
test("visibility: drafts never visible, whatever the recipient status", () => {
  for (const s of ["offered", "interested", "not_interested", "confirmed", "completed", "cancelled", "withdrawn"])
    assert.equal(getBusinessVisibility("draft", s), "hidden");
});

test("visibility: withdrawn never visible", () => {
  for (const l of ["open", "closed", "archived"]) assert.equal(getBusinessVisibility(l, "withdrawn"), "hidden");
});

test("visibility: open offered/interested/confirmed are active", () => {
  assert.equal(getBusinessVisibility("open", "offered"), "active");
  assert.equal(getBusinessVisibility("open", "interested"), "active");
  assert.equal(getBusinessVisibility("open", "confirmed"), "active");
});

test("visibility: outcomes on an open listing are past", () => {
  for (const s of ["not_interested", "completed", "cancelled"]) assert.equal(getBusinessVisibility("open", s), "past");
});

test("visibility: closed listing — confirmed stays active, others historical", () => {
  assert.equal(getBusinessVisibility("closed", "confirmed"), "active");
  for (const s of ["offered", "interested", "not_interested", "completed", "cancelled"]) assert.equal(getBusinessVisibility("closed", s), "past");
});

test("visibility: archived keeps legitimate history, hides unresolved offers", () => {
  for (const s of ["not_interested", "confirmed", "completed", "cancelled"]) assert.equal(getBusinessVisibility("archived", s), "past");
  for (const s of ["offered", "interested"]) assert.equal(getBusinessVisibility("archived", s), "hidden");
});

// ---------------------------------------------------------------- schema <-> domain drift guard
import { readFileSync } from "node:fs";
import { LISTING_STATUSES, RECIPIENT_STATUSES, PRICING_MODES } from "../src/lib/opportunity-listings-domain.ts";

test("schema: migration CHECK lists match the domain constants", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261006044707_opportunity_listings_v1.sql", import.meta.url), "utf8");
  const listFor = (constraint) => {
    const m = sql.match(new RegExp(`${constraint}\\s+check\\s*\\(\\s*\\w+\\s+in\\s*\\(([^)]*)\\)`, "s"));
    assert.ok(m, `constraint ${constraint} not found`);
    return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
  };
  assert.deepEqual(listFor("opportunity_listings_type_check"), [...OPPORTUNITY_TYPES]);
  assert.deepEqual(listFor("opportunity_listings_status_check"), [...LISTING_STATUSES]);
  assert.deepEqual(listFor("opportunity_listings_pricing_mode_check"), [...PRICING_MODES]);
  assert.deepEqual(listFor("opportunity_recipients_status_check"), [...RECIPIENT_STATUSES]);
});
