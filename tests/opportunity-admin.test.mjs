// Opportunities V1 Pass 2 — Admin operating surface rules. Pure domain
// functions plus static guards over the Admin action source. No database,
// no production writes. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ADMIN_TRANSITIONS,
  BUSINESS_LISTING_COLUMNS,
  BUSINESS_RECIPIENT_COLUMNS,
  LISTING_STATUSES,
  LISTING_TRANSITIONS,
  RECIPIENT_STATUSES,
  adminTransitionLabel,
  buildAdminRecipientUpdate,
  canListingTransition,
  canManageRecipients,
  listingTransitionLabel,
  parsePriceToCents,
  planRecipientSend,
  summarizeRecipientCounts,
  validateListingInput,
} from "../src/lib/opportunity-listings-domain.ts";

const ACTIONS = readFileSync(new URL("../src/app/admin/(protected)/opportunities/actions.ts", import.meta.url), "utf8");
const NOW = "2026-10-06T15:00:00.000Z";

/** The real first-Opportunity shape (Tabli Resident Demo) — test data only. */
const tabli = {
  opportunity_type: "sampling_demo",
  title: "Tabli Resident Demo — Jersey City",
  summary: "Demo for residents.",
  description: null,
  image_url: null,
  location_id: null,
  place_text: "Jersey City, NJ",
  host_name: "3 Acres",
  event_id: null,
  starts_at: "2026-11-07T15:00:00.000Z",
  ends_at: "2026-11-07T19:00:00.000Z",
  timing_note: null,
  response_deadline: "2026-10-30T21:00:00.000Z",
  pricing_mode: "fixed",
  price: "750",
  currency: "USD",
  credits_eligible: true,
  whats_included: "Table, signage",
  requirements: null,
  internal_notes: "Recommended to Lavazza",
};

// ---------------------------------------------------------------- create payload
test("create: a valid payload normalizes to table-ready fields", () => {
  const r = validateListingInput(tabli);
  assert.equal(r.ok, true);
  assert.equal(r.value.price_cents, 75000);
  assert.equal(r.value.currency, "USD");
  assert.equal(r.value.credits_eligible, true);
  assert.equal(r.value.host_name, "3 Acres");
  assert.equal("status" in r.value, false, "status is never taken from the form");
});

test("create: invalid type is rejected", () => {
  assert.equal(validateListingInput({ ...tabli, opportunity_type: "event_invitation" }).ok, false);
  assert.equal(validateListingInput({ ...tabli, opportunity_type: null }).ok, false);
  assert.equal(validateListingInput({ ...tabli, title: "   " }).ok, false);
});

test("create: invalid pricing is rejected", () => {
  assert.equal(validateListingInput({ ...tabli, price: "" }).ok, false);
  assert.equal(validateListingInput({ ...tabli, price: "0" }).ok, false);
  assert.equal(validateListingInput({ ...tabli, price: "abc" }).ok, false);
  assert.equal(validateListingInput({ ...tabli, price: "1.999" }).ok, false);
  assert.equal(validateListingInput({ ...tabli, pricing_mode: "free" }).ok, false);
  assert.equal(validateListingInput({ ...tabli, currency: "usdx" }).ok, false);
  assert.equal(validateListingInput({ ...tabli, ends_at: "2026-11-06T00:00:00.000Z" }).ok, false);
});

test("create: complimentary/custom ignore any amount; complimentary is never credits eligible", () => {
  const comp = validateListingInput({ ...tabli, pricing_mode: "complimentary", price: "750", credits_eligible: true });
  assert.equal(comp.ok, true);
  assert.equal(comp.value.price_cents, null);
  assert.equal(comp.value.credits_eligible, false);
  const custom = validateListingInput({ ...tabli, pricing_mode: "custom", price: "750", credits_eligible: true });
  assert.equal(custom.value.price_cents, null);
  assert.equal(custom.value.credits_eligible, true);
});

test("price parsing", () => {
  assert.equal(parsePriceToCents("$1,500"), 150000);
  assert.equal(parsePriceToCents("750.5"), 75050);
  assert.equal(parsePriceToCents("750.05"), 75005);
  assert.equal(parsePriceToCents(""), null);
  assert.ok(Number.isNaN(parsePriceToCents("-5")));
});

// ---------------------------------------------------------------- listing transitions
test("listing transitions: the canonical lifecycle", () => {
  assert.ok(canListingTransition("draft", "open"));
  assert.ok(canListingTransition("open", "closed"));
  assert.ok(canListingTransition("closed", "open"));
  assert.ok(canListingTransition("draft", "archived"));
  assert.ok(canListingTransition("open", "archived"));
  assert.ok(canListingTransition("closed", "archived"));
  assert.ok(canListingTransition("archived", "closed"));
});

test("listing transitions: invalid moves are refused", () => {
  assert.equal(canListingTransition("draft", "closed"), false);
  assert.equal(canListingTransition("open", "draft"), false);
  assert.equal(canListingTransition("closed", "draft"), false);
  assert.equal(canListingTransition("archived", "open"), false);
  assert.equal(canListingTransition("archived", "draft"), false);
  for (const s of LISTING_STATUSES) assert.equal(canListingTransition(s, s), false);
  assert.deepEqual(Object.keys(LISTING_TRANSITIONS).sort(), [...LISTING_STATUSES].sort());
});

test("listing labels", () => {
  assert.equal(listingTransitionLabel("draft", "open"), "Open Opportunity");
  assert.equal(listingTransitionLabel("open", "closed"), "Close Opportunity");
  assert.equal(listingTransitionLabel("closed", "open"), "Reopen Opportunity");
  assert.equal(listingTransitionLabel("open", "archived"), "Archive");
});

test("archive never deletes: no delete call anywhere in the Admin actions", () => {
  assert.equal(/\.delete\s*\(/.test(ACTIONS), false);
  assert.match(ACTIONS, /update\(\{ status: next \}\)/);
});

// ---------------------------------------------------------------- send
test("send: only an open listing can be sent", () => {
  for (const status of ["draft", "closed", "archived"]) {
    const plan = planRecipientSend({ listingId: "L", listingStatus: status, businessIds: ["b1"], existingBusinessIds: [], now: NOW });
    assert.equal(plan.ok, false, status);
  }
  assert.equal(planRecipientSend({ listingId: "L", listingStatus: "open", businessIds: [], existingBusinessIds: [], now: NOW }).ok, false);
});

test("send: offered defaults and per-Business fit notes", () => {
  const plan = planRecipientSend({
    listingId: "L",
    listingStatus: "open",
    businessIds: ["lavazza", "illy"],
    existingBusinessIds: [],
    fitNotes: { lavazza: "  Great espresso fit  ", illy: "   " },
    now: NOW,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.rows.length, 2);
  for (const row of plan.rows) {
    assert.equal(row.status, "offered");
    assert.equal(row.offered_at, NOW);
    assert.equal(row.status_changed_at, NOW);
    assert.equal(row.listing_id, "L");
    assert.equal("responded_at" in row, false);
    assert.equal("responded_by_user_id" in row, false);
    assert.equal("internal_notes" in row, false);
  }
  assert.equal(plan.rows[0].fit_note, "Great espresso fit");
  assert.equal(plan.rows[1].fit_note, null);
});

test("send: duplicates are skipped and reported, never an error", () => {
  const plan = planRecipientSend({
    listingId: "L",
    listingStatus: "open",
    businessIds: ["a", "b", "a", "c"],
    existingBusinessIds: ["b"],
    now: NOW,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.rows.map((r) => r.business_id), ["a", "c"]);
  assert.deepEqual(plan.skippedBusinessIds, ["b"]);
  const all = planRecipientSend({ listingId: "L", listingStatus: "open", businessIds: ["b"], existingBusinessIds: ["b"], now: NOW });
  assert.equal(all.ok, true);
  assert.equal(all.rows.length, 0);
});

test("send: rows only ever target the selected Businesses (cross-Business isolation)", () => {
  const plan = planRecipientSend({ listingId: "L", listingStatus: "open", businessIds: ["a"], existingBusinessIds: ["x", "y"], fitNotes: { x: "not mine" }, now: NOW });
  assert.deepEqual(plan.rows.map((r) => r.business_id), ["a"]);
  assert.equal(plan.rows[0].fit_note, null);
});

test("send: the action uses the unique key so a concurrent send can't duplicate", () => {
  assert.match(ACTIONS, /onConflict: "listing_id,business_id", ignoreDuplicates: true/);
});

// ---------------------------------------------------------------- admin recipient moves
test("admin recipient moves are exactly the canonical map", () => {
  const expected = {
    offered: ["confirmed", "withdrawn"],
    interested: ["confirmed", "cancelled"],
    not_interested: ["withdrawn"],
    confirmed: ["completed", "cancelled", "interested"],
    completed: ["confirmed"],
    cancelled: ["confirmed"],
    withdrawn: ["offered"],
  };
  assert.deepEqual(ADMIN_TRANSITIONS, expected);
  for (const from of RECIPIENT_STATUSES) {
    for (const to of RECIPIENT_STATUSES) {
      const patch = buildAdminRecipientUpdate(from, to, NOW);
      if (expected[from].includes(to)) assert.deepEqual(patch, { status: to, status_changed_at: NOW });
      else assert.equal(patch, null, `${from} -> ${to}`);
    }
  }
});

test("admin recipient moves never fabricate a Business response", () => {
  for (const from of RECIPIENT_STATUSES) {
    for (const to of ADMIN_TRANSITIONS[from]) {
      const patch = buildAdminRecipientUpdate(from, to, NOW);
      assert.deepEqual(Object.keys(patch).sort(), ["status", "status_changed_at"]);
    }
  }
  // Statically: no Admin action writes response fields.
  assert.equal(/responded_at|responded_by_user_id|response_note/.test(ACTIONS.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), false);
});

test("admin recipient labels", () => {
  assert.equal(adminTransitionLabel("offered", "confirmed"), "Confirm");
  assert.equal(adminTransitionLabel("offered", "withdrawn"), "Withdraw");
  assert.equal(adminTransitionLabel("interested", "cancelled"), "Cancel");
  assert.equal(adminTransitionLabel("confirmed", "completed"), "Complete");
  assert.equal(adminTransitionLabel("confirmed", "interested"), "Set Back to Interested");
  assert.equal(adminTransitionLabel("completed", "confirmed"), "Set Back to Confirmed");
  assert.equal(adminTransitionLabel("cancelled", "confirmed"), "Set Back to Confirmed");
  assert.equal(adminTransitionLabel("withdrawn", "offered"), "Re-offer");
});

test("recipients are managed on open/closed listings only", () => {
  assert.equal(canManageRecipients("open"), true);
  assert.equal(canManageRecipients("closed"), true);
  assert.equal(canManageRecipients("draft"), false);
  assert.equal(canManageRecipients("archived"), false);
});

// ---------------------------------------------------------------- counts
test("counts: one flat read aggregates per listing and status", () => {
  const counts = summarizeRecipientCounts([
    { listing_id: "A", status: "offered" },
    { listing_id: "A", status: "interested" },
    { listing_id: "A", status: "confirmed" },
    { listing_id: "A", status: "completed" },
    { listing_id: "A", status: "cancelled" },
    { listing_id: "B", status: "not_interested" },
  ]);
  assert.deepEqual(counts.get("A"), { total: 5, offered: 1, interested: 1, not_interested: 0, confirmed: 1, completed: 1, cancelled: 1, withdrawn: 0 });
  assert.equal(counts.get("B").not_interested, 1);
  assert.equal(counts.get("B").total, 1);
  assert.equal(counts.get("C"), undefined);
});

// ---------------------------------------------------------------- admin-only shapes
test("internal notes stay in Admin-only shapes", () => {
  for (const cols of [BUSINESS_LISTING_COLUMNS, BUSINESS_RECIPIENT_COLUMNS]) {
    const list = cols.split(",").map((c) => c.trim());
    assert.equal(list.includes("internal_notes"), false);
    assert.equal(list.includes("*"), false);
  }
  assert.equal(BUSINESS_RECIPIENT_COLUMNS.includes("responded_by_user_id"), false);
});

test("every Admin action authorizes first", () => {
  const actions = [...ACTIONS.matchAll(/export async function (\w+)\([^)]*\)\s*\{\n\s*(.+)/g)];
  assert.ok(actions.length >= 6);
  for (const [, name, firstLine] of actions) assert.equal(firstLine.trim(), "await requireAdmin();", name);
});

// ---------------------------------------------------------------- event participation untouched
test("the Event participation `opportunities` table is never touched by Admin Opportunities", () => {
  assert.equal(/from\("opportunities"\)/.test(ACTIONS), false);
  const lib = readFileSync(new URL("../src/lib/opportunity-listings.ts", import.meta.url), "utf8");
  assert.equal(/from\("opportunities"\)/.test(lib), false);
  assert.equal(/lib\/opportunities"/.test(ACTIONS + lib), false);
});
