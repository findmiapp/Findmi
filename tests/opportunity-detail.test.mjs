// Opportunities — Admin detail / command center. Pure domain functions
// plus static guards over the route sources. No database. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OPPORTUNITY_SECTION_LABELS,
  canManageRecipients,
  canSendOpportunity,
  emptyRecipientCounts,
  getOpportunityLifecycle,
  opportunityPriceParts,
  toPresentableOpportunity,
} from "../src/lib/opportunity-listings-domain.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const DETAIL = read("src/app/admin/(protected)/opportunities/[id]/page.tsx");
const EDIT = read("src/app/admin/(protected)/opportunities/[id]/edit/page.tsx");
const PRESENTATION = read("src/components/opportunities/OpportunityPresentation.tsx");
const ACTIONS = read("src/app/admin/(protected)/opportunities/actions.ts");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const counts = (over = {}) => ({ ...emptyRecipientCounts(), ...over });
const states = (steps) => steps.map((s) => `${s.key}:${s.state}`).join(" ");

// ---------------------------------------------------------------- routes
test("detail route is a read-only presentation, not the form", () => {
  assert.equal(/OpportunityForm/.test(stripComments(DETAIL)), false);
  assert.match(DETAIL, /from "@\/components\/opportunities\/OpportunityPresentation"/);
  assert.match(DETAIL, /<OpportunityHero/);
  assert.match(DETAIL, /<OpportunityMainSections/);
});

test("Edit Opportunity links to the edit route", () => {
  assert.match(DETAIL, /const editHref = `\/admin\/opportunities\/\$\{listing\.id\}\/edit`/);
  assert.match(DETAIL, /href=\{editHref\}[^>]*>\s*Edit Opportunity/);
});

test("edit route uses the existing form and returns to the detail page", () => {
  assert.match(EDIT, /import OpportunityForm from "\.\.\/\.\.\/OpportunityForm"/);
  assert.match(EDIT, /<OpportunityForm/);
  assert.match(EDIT, /action=\{saveOpportunity\.bind\(null, listing\.id\)\}/);
  assert.match(ACTIONS, /redirect\(`\$\{detail\(id\)\}\?saved=updated`\)/);
});

// ---------------------------------------------------------------- privacy
test("the shared presentation can never carry internal notes", () => {
  const row = {
    id: "x", status: "draft", opportunity_type: "sampling_demo", title: "T", summary: null, description: null, image_url: null,
    location_id: "loc", place_text: null, host_name: null, event_id: null, starts_at: null, ends_at: null, timing_note: null,
    response_deadline: null, pricing_mode: "fixed", price_cents: 75000, currency: "USD", credits_eligible: true,
    whats_included: null, requirements: null, internal_notes: "SECRET", created_at: "a", updated_at: "b",
  };
  const p = toPresentableOpportunity(row);
  assert.equal("internal_notes" in p, false);
  assert.equal(JSON.stringify(p).includes("SECRET"), false);
  for (const k of ["id", "status", "created_at", "updated_at", "location_id", "event_id"]) assert.equal(k in p, false, k);
  assert.equal(/internal_notes/.test(stripComments(PRESENTATION)), false);
  // The detail page only hands the presentation the presentable shape.
  assert.match(DETAIL, /const o = toPresentableOpportunity\(listing\)/);
  assert.equal(/<Opportunity(Hero|MainSections|AsideSections)[^>]*o=\{listing\}/.test(DETAIL), false);
});

// ---------------------------------------------------------------- labels
test("display labels for whats_included and requirements", () => {
  assert.equal(OPPORTUNITY_SECTION_LABELS.whats_included, "What Findmi Provides");
  assert.equal(OPPORTUNITY_SECTION_LABELS.requirements, "What Your Brand Provides");
  assert.match(PRESENTATION, /OPPORTUNITY_SECTION_LABELS\.whats_included\}>\s*<Prose text=\{o\.whats_included\}/);
  assert.match(PRESENTATION, /OPPORTUNITY_SECTION_LABELS\.requirements\}>\s*<Prose text=\{o\.requirements\}/);
});

test("price parts", () => {
  assert.deepEqual(opportunityPriceParts({ pricing_mode: "fixed", price_cents: 75000, currency: "USD" }), { amount: "$750", qualifier: "Fixed" });
  assert.deepEqual(opportunityPriceParts({ pricing_mode: "starting_at", price_cents: 150000, currency: "USD" }), { amount: "$1,500", qualifier: "Starting At" });
  assert.deepEqual(opportunityPriceParts({ pricing_mode: "complimentary", price_cents: null, currency: "USD" }), { amount: "Complimentary", qualifier: null });
  assert.deepEqual(opportunityPriceParts({ pricing_mode: "custom", price_cents: null, currency: "USD" }), { amount: "Contact Findmi", qualifier: "Custom" });
});

// ---------------------------------------------------------------- lifecycle
test("lifecycle: draft is always at Draft", () => {
  assert.equal(states(getOpportunityLifecycle("draft", counts())), "draft:current open:upcoming responses:upcoming confirmed:upcoming completed:upcoming");
  // Even with stray counts, a draft never advances.
  assert.equal(getOpportunityLifecycle("draft", counts({ confirmed: 2 }))[0].state, "current");
});

test("lifecycle: open with no responses is at Open", () => {
  assert.equal(states(getOpportunityLifecycle("open", counts())), "draft:done open:current responses:upcoming confirmed:upcoming completed:upcoming");
  assert.equal(states(getOpportunityLifecycle("open", counts({ offered: 3 }))), "draft:done open:current responses:upcoming confirmed:upcoming completed:upcoming");
});

test("lifecycle: a Business response moves to Responses", () => {
  assert.equal(getOpportunityLifecycle("open", counts({ offered: 2, interested: 1 })).find((s) => s.state === "current").key, "responses");
  assert.equal(getOpportunityLifecycle("open", counts({ not_interested: 1 })).find((s) => s.state === "current").key, "responses");
});

test("lifecycle: confirmed and completed progress", () => {
  assert.equal(states(getOpportunityLifecycle("open", counts({ interested: 1, confirmed: 1 }))), "draft:done open:done responses:done confirmed:current completed:upcoming");
  assert.equal(states(getOpportunityLifecycle("closed", counts({ confirmed: 1, completed: 1 }))), "draft:done open:done responses:done confirmed:done completed:current");
});

test("lifecycle: archived keeps the progress it reached; never persisted", () => {
  assert.equal(getOpportunityLifecycle("archived", counts({ completed: 1 })).find((s) => s.state === "current").key, "completed");
  assert.equal(getOpportunityLifecycle("archived", counts()).find((s) => s.state === "current").key, "open");
  assert.equal(/getOpportunityLifecycle|lifecycle/.test(stripComments(ACTIONS)), false, "lifecycle is never written");
});

// ---------------------------------------------------------------- recipient availability
test("recipient sending: unavailable on Draft/Closed/Archived, available on Open", () => {
  assert.equal(canSendOpportunity("draft"), false);
  assert.equal(canSendOpportunity("closed"), false);
  assert.equal(canSendOpportunity("archived"), false);
  assert.equal(canSendOpportunity("open"), true);
  assert.equal(canManageRecipients("archived"), false);
  assert.match(DETAIL, /\{canSend \? \(\s*<div[\s\S]*?<RecipientSender/);
  assert.match(DETAIL, /This Opportunity is currently a Draft\. Open it to send to Businesses\./);
});
