// Opportunities — Commercial Terms Admin Builder UX pass. Live tests of the
// builder's pure state module (src/lib/opportunity-commercial-terms-
// builder.ts) run against the REAL domain validators, plus static guards
// over the React builder / OpportunityForm / server actions for what can't
// be exercised without a browser. No database, no production writes.
// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONTRIBUTION_UNITS,
  IN_KIND_PROVIDERS,
  MONETARY_COMPONENT_TYPES,
  validateComponent,
  validateOption,
  validateQuantityUnit,
} from "../src/lib/opportunity-commercial-terms-domain.ts";
import { parsePriceToCents } from "../src/lib/opportunity-listings-domain.ts";
import {
  DEFAULT_IN_KIND_PROVIDER,
  DOMAIN_ERROR_FIELDS,
  MONETARY_HEADINGS,
  VALUE_PER_UNIT_NEEDS_PAIR,
  amountFieldsFor,
  clearQuantityUnit,
  closeCover,
  collectCommercialTermsIssues,
  componentToState,
  defaultInKindComponent,
  defaultMonetaryComponent,
  defaultOptionState,
  hasQuantityUnit,
  openValuation,
  optionChrome,
  optionToState,
  parseQuantityInput,
  removeValuation,
  selectValuation,
  submittedComponentValues,
  submittedOptionValues,
  toComponentInput,
} from "../src/lib/opportunity-commercial-terms-builder.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const BUILDER = read("src/app/admin/(protected)/opportunities/CommercialTermsBuilder.tsx");
const BUILDER_STATE = read("src/lib/opportunity-commercial-terms-builder.ts");
const DOMAIN = read("src/lib/opportunity-commercial-terms-domain.ts");
const FORM_MODULE = read("src/lib/opportunity-commercial-terms-form.ts");
const OPPORTUNITY_FORM = read("src/app/admin/(protected)/opportunities/OpportunityForm.tsx");
const ACTIONS = read("src/app/admin/(protected)/opportunities/actions.ts");
const SUBMIT_BAR = read("src/components/admin/SubmitBar.tsx");

const DEPS = { validateQuantityUnit, validateComponent, validateOption, parseMoney: parsePriceToCents };
let seq = 0;
const key = () => `t${++seq}`;
const apply = (c, patch) => ({ ...c, ...patch });
const option = (components, over = {}) => ({ ...defaultOptionState(key()), components, ...over });
const issuesFor = (opts) => collectCommercialTermsIssues(opts, DEPS);
const inKind = (over = {}) => apply(defaultInKindComponent(true, key()), { in_kind_category: "product_samples", ...over });
const fee = (over = {}) => apply(defaultMonetaryComponent("participation_fee", key()), { amount_min: "750", ...over });

const stored = (over = {}) => ({
  component_type: "in_kind",
  amount_mode: null,
  amount_min_cents: null,
  amount_max_cents: null,
  currency: null,
  in_kind_category: "product_samples",
  in_kind_description: "Bottles of Tost",
  in_kind_provider: "findmi",
  in_kind_required: true,
  estimated_value_cents: null,
  quantity: null,
  unit: null,
  custom_unit_label: null,
  unit_value_cents: null,
  ...over,
});

// ---------------------------------------------------------------- In-Kind provider default

test("UX / 1. a NEW In-Kind term defaults Provider to Business (recipient_business), visibly, and posts it", () => {
  const c = defaultInKindComponent(true, key());
  assert.equal(DEFAULT_IN_KIND_PROVIDER, "recipient_business");
  assert.equal(c.in_kind_provider, "recipient_business");
  assert.equal(submittedComponentValues(c, "structured").in_kind_provider, "recipient_business");
  assert.ok(IN_KIND_PROVIDERS.includes(c.in_kind_provider));
  // The Business-facing label for that stored value is unchanged.
  assert.match(DOMAIN, /recipient_business: "Business"/);
});

test("UX / 2. an EXISTING term keeps its stored provider — never re-defaulted to Business", () => {
  for (const p of ["findmi", "organizer", "other", "recipient_business"]) {
    assert.equal(componentToState(stored({ in_kind_provider: p }), key()).in_kind_provider, p);
  }
});

test("UX / 3. Category is never inferred or defaulted, and stays required (the domain still rejects a missing one)", () => {
  const c = defaultInKindComponent(true, key());
  assert.equal(c.in_kind_category, "");
  const issues = issuesFor([option([c])]);
  assert.deepEqual(issues.map((i) => [i.field, i.message]), [["in_kind_category", "Choose an In-Kind category."]]);
  assert.equal(issues[0].immediate, false, "a still-empty required field is shown after a Save attempt, not while typing");
  // Category stays a <select>, not a chip wall.
  assert.match(BUILDER, /<select\s*\n\s*id=\{fieldId\(prefix, "in_kind_category"\)\}/);
});

// ---------------------------------------------------------------- In-Kind valuation (the fresh-term bug)

test("UX / 4. fresh In-Kind: no value by default and nothing posted — '+ Add Estimated Value' reveals the two methods with NEITHER chosen", () => {
  const c = defaultInKindComponent(true, key());
  assert.equal(c.valuation, "none");
  assert.equal(c.valuation_open, false);
  const opened = apply(c, openValuation());
  assert.equal(opened.valuation_open, true);
  assert.equal(opened.valuation, "none");
  const v = submittedComponentValues(opened, "structured");
  assert.equal(v.estimated_value, "");
  assert.equal(v.unit_value, "");
});

test("UX / 5. (bug fix) fresh In-Kind: Estimated Total CAN be selected while its input is still empty — the choice is real state, not derived from text", () => {
  const c = apply(apply(defaultInKindComponent(true, key()), openValuation()), selectValuation("total"));
  assert.equal(c.estimated_value, "");
  assert.equal(c.valuation, "total", "selected even though the value field is empty");
  // The builder renders the input from the chosen mode, never from field emptiness.
  assert.match(BUILDER, /\{component\.valuation === "total" && \(/);
  assert.equal(/valuationModeOf/.test(BUILDER), false, "the old derive-mode-from-text helper is gone");
  const typed = apply(c, { estimated_value: "2500" });
  assert.equal(submittedComponentValues(typed, "structured").estimated_value, "2500");
  assert.ok(validateComponent(toComponentInput(apply(typed, { in_kind_category: "space_venue" }), "structured", parsePriceToCents)).ok);
});

test("UX / 6. (bug fix) fresh In-Kind: Value Per Unit can be selected once quantity+unit exist, and is gated (with a visible note) until they do", () => {
  let c = inKind({ in_kind_description: "Tost" });
  assert.equal(hasQuantityUnit(c), false);
  assert.match(BUILDER, /disabled=\{!pairReady && component\.valuation !== "per_unit"\}/);
  assert.match(BUILDER, /Value Per Unit needs an Amount and unit above\./);
  c = apply(c, { quantity: "24", unit: "custom", custom_unit_label: "Bottles" });
  assert.equal(hasQuantityUnit(c), true);
  c = apply(apply(c, openValuation()), selectValuation("per_unit"));
  assert.equal(c.valuation, "per_unit");
  assert.equal(c.unit_value, "", "selected while still empty");
  assert.match(BUILDER, /\{component\.valuation === "per_unit" && \(/);
  c = apply(c, { unit_value: "2" });
  const r = validateComponent(toComponentInput(c, "structured", parsePriceToCents));
  assert.ok(r.ok);
  assert.equal(r.value.unit_value_cents, 200);
  assert.equal(r.value.estimated_value_cents, null);
});

test("UX / 7. switching valuation method clears the other value (exactly one, or none); Remove Value collapses back to no value", () => {
  let c = apply(inKind({ quantity: "24", unit: "units" }), selectValuation("total"));
  c = apply(c, { estimated_value: "50" });
  c = apply(c, selectValuation("per_unit"));
  assert.equal(c.estimated_value, "");
  c = apply(c, { unit_value: "2" });
  c = apply(c, selectValuation("total"));
  assert.equal(c.unit_value, "");
  c = apply(c, removeValuation());
  assert.deepEqual([c.valuation, c.valuation_open, c.estimated_value, c.unit_value], ["none", false, "", ""]);
});

test("UX / 8. a stored valuation re-opens in its own method", () => {
  assert.equal(componentToState(stored({ estimated_value_cents: 250000 }), key()).valuation, "total");
  const perUnit = componentToState(stored({ quantity: 24, unit: "units", unit_value_cents: 200 }), key());
  assert.equal(perUnit.valuation, "per_unit");
  assert.equal(perUnit.valuation_open, true);
  assert.equal(componentToState(stored(), key()).valuation_open, false);
});

test("UX / 9. Value Per Unit with the pair cleared afterwards is flagged inline straight away, using the domain's own wording", () => {
  const c = apply(apply(inKind({ quantity: "24", unit: "units" }), selectValuation("per_unit")), { unit_value: "2" });
  const cleared = apply(c, clearQuantityUnit());
  const issues = issuesFor([option([cleared])]);
  const vpu = issues.find((i) => i.field === "unit_value");
  assert.ok(vpu);
  assert.equal(vpu.message, VALUE_PER_UNIT_NEEDS_PAIR);
  assert.equal(vpu.immediate, true);
  assert.ok(DOMAIN.includes(`"${VALUE_PER_UNIT_NEEDS_PAIR}"`));
});

// ---------------------------------------------------------------- monetary

test("UX / 10. a Fixed (or Starting At) monetary term shows ONE amount input — no irrelevant To field; Range shows From+To; Undisclosed shows none", () => {
  assert.deepEqual(amountFieldsFor("fixed"), { min: true, max: false, minLabel: "Amount" });
  assert.deepEqual(amountFieldsFor("starting_at"), { min: true, max: false, minLabel: "Amount" });
  assert.deepEqual(amountFieldsFor("range"), { min: true, max: true, minLabel: "From" });
  assert.deepEqual(amountFieldsFor("undisclosed"), { min: false, max: false, minLabel: "" });
  assert.match(BUILDER, /\{fields\.max && \(/);
  assert.equal(/disabled=\{component\.amount_mode !== "range"\}/.test(BUILDER), false, "the old always-rendered disabled To input is gone");
});

test("UX / 11. a stale Range 'To' (or any amount on Undisclosed) is never posted after switching mode", () => {
  const ranged = fee({ amount_mode: "range", amount_min: "1000", amount_max: "2000" });
  assert.equal(submittedComponentValues(ranged, "structured").amount_max, "2000");
  const fixed = apply(ranged, { amount_mode: "fixed" });
  assert.equal(submittedComponentValues(fixed, "structured").amount_max, "");
  assert.ok(validateComponent(toComponentInput(fixed, "structured", parsePriceToCents)).ok);
  const undisclosed = apply(ranged, { amount_mode: "undisclosed" });
  const v = submittedComponentValues(undisclosed, "structured");
  assert.deepEqual([v.amount_min, v.amount_max], ["", ""]);
  assert.ok(validateComponent(toComponentInput(undisclosed, "structured", parsePriceToCents)).ok);
});

test("UX / 12. monetary headings read naturally: Business Pays / Business Receives / Project Budget", () => {
  assert.deepEqual(MONETARY_HEADINGS, { participation_fee: "Business Pays", compensation: "Business Receives", project_budget: "Project Budget" });
  assert.deepEqual(Object.keys(MONETARY_HEADINGS).sort(), [...MONETARY_COMPONENT_TYPES].sort());
});

test("UX / 13. USD stays the default and is still posted on the normal path (Currency collapsed to 'USD · Change'); a stored non-USD currency opens the editor", () => {
  const c = fee();
  assert.equal(c.currency_open, false);
  assert.equal(submittedComponentValues(c, "structured").currency, "USD");
  assert.equal(submittedComponentValues(apply(c, { currency: "" }), "structured").currency, "USD");
  assert.match(BUILDER, />\s*Change\s*</);
  const eur = componentToState(stored({ component_type: "participation_fee", amount_mode: "fixed", amount_min_cents: 50000, currency: "EUR", in_kind_category: null, in_kind_description: null, in_kind_provider: null }), key());
  assert.equal(eur.currency_open, true);
  assert.equal(submittedComponentValues(eur, "structured").currency, "EUR");
});

test("UX / 14. 'What Does This Cover?' is collapsed when nothing is stored, opens for a stored pair, and Remove clears the pair", () => {
  assert.equal(fee().cover_open, false);
  const storedFee = componentToState(
    stored({ component_type: "participation_fee", amount_mode: "fixed", amount_min_cents: 75000, currency: "USD", in_kind_category: null, in_kind_description: null, in_kind_provider: null, quantity: 3, unit: "appearances" }),
    key()
  );
  assert.equal(storedFee.cover_open, true);
  const closed = apply(storedFee, closeCover());
  assert.deepEqual([closed.cover_open, closed.quantity, closed.unit], [false, "", ""]);
  // A collapsed section never posts a stray half-pair.
  const v = submittedComponentValues(apply(fee(), { quantity: "3" }), "structured");
  assert.deepEqual([v.quantity, v.unit], ["", ""]);
  assert.match(BUILDER, /\+ What Does This Cover\?/);
});

test("UX / 15. $750 Fixed Participation Fee covering 3 Appearances is clean and validates exactly as the server will", () => {
  const c = fee({ cover_open: true, quantity: "3", unit: "appearances" });
  assert.deepEqual(issuesFor([option([c])]), []);
  const r = validateComponent(toComponentInput(c, "structured", parsePriceToCents));
  assert.ok(r.ok);
  assert.deepEqual([r.value.amount_min_cents, r.value.currency, r.value.quantity, r.value.unit], [75000, "USD", 3, "appearances"]);
});

// ---------------------------------------------------------------- quantity + unit as one pair

test("UX / 16. quantity WITHOUT unit is caught before submission, inline and immediately, pointing at the unit — never a guessed unit", () => {
  for (const c of [inKind({ quantity: "3" }), fee({ cover_open: true, quantity: "3" })]) {
    const issues = issuesFor([option([c])]);
    assert.equal(issues.length, 1);
    assert.deepEqual([issues[0].field, issues[0].message, issues[0].immediate], ["unit", "Choose a unit.", true]);
    assert.equal(issues[0].id, "ct_0_c_0__unit");
  }
  assert.equal(defaultInKindComponent(true, key()).unit, "", "no unit is ever pre-filled");
});

test("UX / 17. unit WITHOUT quantity is caught before submission, pointing at the quantity", () => {
  const issues = issuesFor([option([inKind({ unit: "samples" })])]);
  assert.equal(issues.length, 1);
  assert.deepEqual([issues[0].field, issues[0].message, issues[0].immediate], ["quantity", "Enter both a quantity and a unit, or leave both blank.", true]);
});

test("UX / 18. quantity <= 0 and a non-numeric quantity are caught before submission", () => {
  for (const q of ["0", "-2", "abc"]) {
    const issues = issuesFor([option([inKind({ quantity: q, unit: "hours" })])]);
    assert.equal(issues.length, 1, q);
    assert.deepEqual([issues[0].field, issues[0].message], ["quantity", "Enter a quantity greater than 0."]);
  }
  assert.ok(Number.isNaN(parseQuantityInput("abc")));
  assert.equal(parseQuantityInput("  "), null);
  assert.equal(parseQuantityInput("2.5"), 2.5);
});

test("UX / 19. a Custom unit requires its label", () => {
  const issues = issuesFor([option([inKind({ quantity: "24", unit: "custom" })])]);
  assert.equal(issues.length, 1);
  assert.deepEqual([issues[0].field, issues[0].message, issues[0].immediate], ["custom_unit_label", "Describe the custom unit.", true]);
  assert.deepEqual(issuesFor([option([inKind({ quantity: "24", unit: "custom", custom_unit_label: "Bottles" })])]), []);
  assert.ok(CONTRIBUTION_UNITS.includes("custom"));
});

test("UX / 20. both blank and both filled are valid; the pair clears together", () => {
  assert.deepEqual(issuesFor([option([inKind()])]), []);
  assert.deepEqual(issuesFor([option([inKind({ quantity: "3", unit: "locations" })])]), []);
  assert.deepEqual(clearQuantityUnit(), { quantity: "", unit: "", custom_unit_label: "" });
});

test("UX / 21. real-world In-Kind terms all enter cleanly: 24 Bottles of Tost, 1 Brand Ambassador, 3 Locations, 2.5 Hours of Services, Venue Space with no quantity", () => {
  const cases = [
    inKind({ in_kind_description: "Tost", quantity: "24", unit: "custom", custom_unit_label: "Bottles" }),
    inKind({ in_kind_category: "staffing", in_kind_description: "Brand Ambassador", quantity: "1", unit: "staff" }),
    inKind({ in_kind_category: "space_venue", in_kind_description: "Retail placement", quantity: "3", unit: "locations" }),
    inKind({ in_kind_category: "services", in_kind_description: "Bartending", quantity: "2.5", unit: "hours" }),
    inKind({ in_kind_category: "space_venue", in_kind_description: "Venue Space" }),
  ];
  for (const c of cases) assert.deepEqual(issuesFor([option([c])]), [], c.in_kind_description);
});

test("UX / 22. every field-mapped domain message really exists in the domain module — the client never invents its own rule wording", () => {
  for (const message of Object.keys(DOMAIN_ERROR_FIELDS)) assert.ok(DOMAIN.includes(`"${message}"`), message);
  assert.match(DOMAIN, /export function validateQuantityUnit\(/);
});

test("UX / 23. Option-level rules surface only once the terms themselves are clean (e.g. a Structured Option with only optional In-Kind)", () => {
  const optionalOnly = inKind({ in_kind_required: false });
  const issues = issuesFor([option([optionalOnly])]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].field, "option");
  assert.equal(issues[0].id, "ct_0__option");
  assert.match(issues[0].message, /Structured Option needs a monetary term or a required contribution from the Business/);
});

test("UX / 24. (bug fix) a Custom terms note left behind after switching to Structured is never posted (it used to fail the whole save)", () => {
  const o = option([fee()], { commercial_mode: "custom", custom_terms_note: "Negotiating" });
  assert.equal(submittedOptionValues(o).custom_terms_note, "Negotiating");
  const switched = { ...o, commercial_mode: "structured" };
  assert.equal(submittedOptionValues(switched).custom_terms_note, "");
  assert.deepEqual(issuesFor([switched]), []);
});

test("UX / 25. the client-side submitted-value mapping mirrors the server parser: same field suffixes, same quantity parse", () => {
  const fields = Object.keys(submittedComponentValues(fee(), "structured"));
  for (const f of fields) assert.ok(FORM_MODULE.includes(`\`\${prefix}_${f}\``), `parseCommercialTermsForm reads ${f}`);
  assert.match(FORM_MODULE, /const n = Number\(raw\.trim\(\)\);\s*\n\s*return Number\.isFinite\(n\) \? n : Number\.NaN;/);
  assert.match(BUILDER_STATE, /const n = Number\(raw\.trim\(\)\);\s*\n\s*return Number\.isFinite\(n\) \? n : Number\.NaN;/);
  for (const f of ["id", "name", "description", "commercial_mode", "custom_terms_note"]) {
    assert.ok(FORM_MODULE.includes(`\`\${prefix}_${f}\``), `parseCommercialTermsForm reads option ${f}`);
  }
});

test("UX / 26. Complimentary still forces In-Kind optional on what is posted", () => {
  const c = inKind({ in_kind_required: true });
  assert.equal(submittedComponentValues(c, "complimentary").in_kind_required, "");
  assert.equal(submittedComponentValues(c, "structured").in_kind_required, "on");
});

// ---------------------------------------------------------------- Option chrome

test("UX / 27. a single Option shows no management chrome — no Move Up/Down, Duplicate, Remove, or 'Option 1' header — just a quiet '+ Add Another Option'", () => {
  // With packages enabled (the eventual behavior); the temporary single-package limit is covered in tests/opportunity-package-policy.test.mjs.
  assert.deepEqual(optionChrome(1, true), { showHeader: false, showMove: false, showDuplicate: false, showRemove: false, showAdd: true, addLabel: "+ Add Another Option" });
  assert.match(BUILDER, /\{chrome\.showMove && \(/);
  assert.match(BUILDER, /\{chrome\.showDuplicate && \(/);
  assert.match(BUILDER, /\{chrome\.showRemove && \(/);
  assert.match(BUILDER, /\{chrome\.showHeader && \(/);
});

test("UX / 28. multiple Options keep every management capability (Move Up/Down, Duplicate, Remove, naming); Duplicate still makes a new, id-less copy", () => {
  assert.deepEqual(optionChrome(2, true), { showHeader: true, showMove: true, showDuplicate: true, showRemove: true, showAdd: true, addLabel: "+ Add Option" });
  for (const label of ["Move Up", "Move Down", "Duplicate Option", "Remove Option"]) assert.match(BUILDER, new RegExp(`>\\s*${label}\\s*<`));
  assert.match(BUILDER, /key: newKey\(\), id: null, components: prev\[idx\]\.components\.map\(\(c\) => \(\{ \.\.\.c, key: newKey\(\) \}\)\)/);
});

test("UX / 29. stable Option ids are still posted for every Option (ct_{i}_id), single or multiple", () => {
  const o = optionToState({ id: "11111111-1111-1111-1111-111111111111", name: null, description: null, commercial_mode: "structured", custom_terms_note: null, components: [] }, key);
  assert.equal(submittedOptionValues(o).id, "11111111-1111-1111-1111-111111111111");
  assert.match(BUILDER, /<Hidden name=\{`\$\{prefix\}_id`\} value=\{submitted\.id\} \/>/);
  assert.match(BUILDER, /<Hidden name="ct_count" value=\{options\.length\} \/>/);
});

// ---------------------------------------------------------------- pre-submit gate + failed-save state preservation

test("UX / 30. Save never proceeds with known Commercial Terms problems: OpportunityForm asks the builder first, which shows every issue and focuses the first", () => {
  const submit = OPPORTUNITY_FORM.match(/function handleSubmit[\s\S]*?\n  \}/)[0];
  const gate = submit.indexOf("validateForSubmit()");
  const dispatchIdx = submit.indexOf("dispatch(formData)");
  assert.ok(gate > -1 && dispatchIdx > gate, "the builder check runs before anything is sent");
  assert.match(BUILDER, /setShowAll\(true\);/);
  assert.match(BUILDER, /el\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(BUILDER, /scrollIntoView\(\{ block: "center"/);
});

test("UX / 31. a failed save keeps everything on screen: no <form action> reset, no redirect back to a form rebuilt from the database", () => {
  assert.match(OPPORTUNITY_FORM, /<form onSubmit=\{handleSubmit\}/);
  assert.equal(/<form action=/.test(OPPORTUNITY_FORM), false, "the form action prop would trigger React's automatic form reset");
  assert.match(OPPORTUNITY_FORM, /e\.preventDefault\(\);/);
  assert.match(OPPORTUNITY_FORM, /useActionState<SaveState, FormData>/);
  assert.match(OPPORTUNITY_FORM, /startTransition\(\(\) => dispatch\(formData\)\)/);
  assert.match(OPPORTUNITY_FORM, /role="alert"/);
  assert.match(SUBMIT_BAR, /const pending = pendingOverride \?\? status\.pending;/);
  assert.match(OPPORTUNITY_FORM, /<SubmitBar cancelHref=\{cancelHref\} saveLabel=\{saveLabel\} pending=\{pending\} \/>/);
});

test("UX / 32. createOpportunity/saveOpportunity RETURN rejections ({ error }) instead of redirecting; success still redirects; nothing is written before validation passes", () => {
  for (const name of ["createOpportunity", "saveOpportunity"]) {
    const fn = ACTIONS.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n}\\n`))[0];
    assert.equal(/\bfail\(/.test(fn), false, `${name} never redirects a rejection back to a DB-rebuilt form`);
    assert.match(fn, /return \{ error: /);
    assert.match(fn, /redirect\(`\$\{detail\((data\.)?id\)\}\?saved=/);
  }
  const create = ACTIONS.match(/export async function createOpportunity[\s\S]*?\n}\n/)[0];
  assert.ok(create.indexOf("if (!terms.ok) return { error: terms.error };") < create.indexOf(".insert("));
  const save = ACTIONS.match(/export async function saveOpportunity[\s\S]*?\n}\n/)[0];
  assert.ok(save.indexOf("if (!terms.ok) return { error: terms.error };") < save.indexOf(".update(fields)"));
  // Commercial Terms still go through the one atomic RPC (no partial Options on failure).
  assert.equal((ACTIONS.match(/\.rpc\("replace_opportunity_options"/g) ?? []).length, 1);
});
