// Opportunities — Commercial Terms classification correction (Phase 1).
// Only money (any monetary type) and contributions REQUIRED FROM THE
// RECIPIENT BUSINESS make an Option Structured; Findmi / organizer / other
// inclusions never do. A missing provider counts as the Business. Live
// tests over the real domain validator + builder state, plus static guards
// over the (not yet applied) migration. No database, no production writes.
// Trigger behavior itself was exercised against a local Postgres 16 with
// migrations 090/100/110 + this one (see the Phase 1 report).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isRequiredBrandContribution, validateOption, MONETARY_COMPONENT_TYPES, IN_KIND_PROVIDERS } from "../src/lib/opportunity-commercial-terms-domain.ts";
import { blocksComplimentary, defaultInKindComponent, isBrandItem, submittedComponentValues } from "../src/lib/opportunity-commercial-terms-builder.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const MIGRATION = read("supabase/migrations/20261012000000_commercial_terms_brand_contribution_classification.sql");
const FOUNDATION = read("supabase/migrations/20261009000000_opportunity_commercial_terms_foundation.sql");
const BUILDER = read("src/app/admin/(protected)/opportunities/CommercialTermsBuilder.tsx");
const strip = (s) => s.replace(/--.*$/gm, "");

const item = (provider, required, over = {}) => ({ component_type: "in_kind", in_kind_category: "staffing", in_kind_provider: provider, in_kind_required: required, ...over });
const money = (type) => ({ component_type: type, amount_mode: "fixed", amount_min_cents: 75000, currency: "USD" });
const ok = (mode, components) => validateOption({ commercial_mode: mode, components }).ok;

test("C / 1. the reported bug is fixed: no fee, nothing required from the Business, Findmi provides required staff + space -> Complimentary (and NOT Structured)", () => {
  const components = [item("findmi", true), item("findmi", true, { in_kind_category: "space_venue" })];
  assert.equal(ok("complimentary", components), true);
  assert.equal(ok("structured", components), false);
});

test("C / 2. every non-Business provider's REQUIRED inclusion is allowed on a Complimentary Option", () => {
  for (const provider of ["findmi", "organizer", "other"]) {
    assert.equal(ok("complimentary", [item(provider, true, { in_kind_category: "services" })]), true, provider);
    assert.equal(ok("complimentary", [item(provider, false, { in_kind_category: "services" })]), true, provider);
  }
});

test("C / 3. something REQUIRED from the Business still makes an Option Structured (never Complimentary)", () => {
  const brand = [item("recipient_business", true, { in_kind_category: "product_samples" })];
  assert.equal(ok("structured", brand), true);
  const r = validateOption({ commercial_mode: "complimentary", components: brand });
  assert.equal(r.ok, false);
  assert.match(r.error, /can't require anything from the Business/);
});

test("C / 4. OPTIONAL Business items stay Complimentary-compatible", () => {
  assert.equal(ok("complimentary", [item("recipient_business", false, { in_kind_category: "product_samples" })]), true);
  assert.equal(ok("structured", [item("recipient_business", false, { in_kind_category: "product_samples" })]), false);
});

test("C / 5. ALL three monetary types make an Option Structured and are never allowed on Complimentary", () => {
  assert.deepEqual([...MONETARY_COMPONENT_TYPES].sort(), ["compensation", "participation_fee", "project_budget"]);
  for (const type of MONETARY_COMPONENT_TYPES) {
    assert.equal(ok("structured", [money(type)]), true, type);
    assert.equal(ok("structured", [money(type), item("findmi", true)]), true, type);
    assert.equal(ok("complimentary", [money(type)]), false, type);
    assert.equal(ok("complimentary", [money(type), item("findmi", true)]), false, type);
  }
});

test("C / 6. a Structured Option needs money or a required Business contribution — inclusions alone are not enough", () => {
  const r = validateOption({ commercial_mode: "structured", components: [item("findmi", true), item("organizer", true)] });
  assert.equal(r.ok, false);
  assert.match(r.error, /monetary term or a required contribution from the Business/);
});

test("C / 7. missing provider counts as the recipient Business (strict side) in the classification helper", () => {
  assert.equal(isRequiredBrandContribution({ component_type: "in_kind", in_kind_required: true, in_kind_provider: null }), true);
  assert.equal(isRequiredBrandContribution({ component_type: "in_kind", in_kind_required: false, in_kind_provider: null }), false);
  for (const p of IN_KIND_PROVIDERS) {
    assert.equal(isRequiredBrandContribution({ component_type: "in_kind", in_kind_required: true, in_kind_provider: p }), p === "recipient_business", p);
  }
  assert.equal(isRequiredBrandContribution({ component_type: "participation_fee", in_kind_required: true, in_kind_provider: null }), false);
  // The Admin UI still requires an explicit provider: validateComponent rejects a missing one.
  const r = validateOption({ commercial_mode: "complimentary", components: [{ component_type: "in_kind", in_kind_category: "staffing", in_kind_required: false }] });
  assert.equal(r.ok, false);
  assert.match(r.error, /Choose who provides this/);
});

test("C / 8. all three EXISTING production packages (listing 'Test') remain valid Structured Options under the corrected rule", () => {
  const prod = [
    [{ component_type: "participation_fee", amount_mode: "fixed", amount_min_cents: 250000, currency: "USD", quantity: 2, unit: "staff" }],
    [{ component_type: "participation_fee", amount_mode: "fixed", amount_min_cents: 25000, currency: "USD", quantity: 50, unit: "photos" }],
    [{ component_type: "in_kind", in_kind_category: "product_samples", in_kind_provider: "recipient_business", in_kind_required: true, quantity: 24, unit: "units", unit_value_cents: 600 }],
  ];
  for (const components of prod) {
    assert.equal(ok("structured", components), true);
    assert.equal(ok("complimentary", components), false, "none of them could ever be Complimentary — unchanged");
  }
});

// ---------------------------------------------------------------- builder

test("C / 9. builder: switching to Complimentary keeps inclusions and optional Business items; drops money and required Business items", () => {
  const findmi = { ...defaultInKindComponent(true, "a"), in_kind_provider: "findmi" };
  const brandRequired = defaultInKindComponent(true, "b");
  const brandOptional = defaultInKindComponent(false, "c");
  assert.equal(blocksComplimentary(findmi), false);
  assert.equal(blocksComplimentary(brandOptional), false);
  assert.equal(blocksComplimentary(brandRequired), true);
  assert.equal(blocksComplimentary({ component_type: "participation_fee", in_kind_required: true, in_kind_provider: "" }), true);
  assert.equal(blocksComplimentary({ ...brandRequired, in_kind_provider: "" }), true, "blank provider counts as the Business");
  assert.match(BUILDER, /if \(next === "complimentary"\) return option\.components\.some\(blocksComplimentary\);/);
  assert.match(BUILDER, /components: option\.components\.filter\(\(c\) => !blocksComplimentary\(c\)\)/);
});

test("C / 10. builder: on a Complimentary Option a REQUIRED Findmi inclusion is posted as required; a Business item never is", () => {
  const findmi = { ...defaultInKindComponent(true, "a"), in_kind_provider: "findmi", in_kind_category: "staffing" };
  assert.equal(submittedComponentValues(findmi, "complimentary").in_kind_required, "on");
  assert.equal(submittedComponentValues(defaultInKindComponent(true, "b"), "complimentary").in_kind_required, "");
  assert.equal(submittedComponentValues(defaultInKindComponent(true, "b"), "structured").in_kind_required, "on");
  assert.equal(isBrandItem({ in_kind_provider: "" }), true);
  assert.equal(isBrandItem({ in_kind_provider: "organizer" }), false);
});

// ---------------------------------------------------------------- migration (static)

test("C / 11. the migration only CREATE OR REPLACEs the two existing trigger functions — no table, constraint, grant, trigger binding or data change", () => {
  const sql = strip(MIGRATION).toLowerCase();
  assert.equal((sql.match(/create or replace function public\.check_option_component_commercial_mode\(\)/g) ?? []).length, 1);
  assert.equal((sql.match(/create or replace function public\.check_option_mode_change_allowed\(\)/g) ?? []).length, 1);
  assert.equal(/\b(alter|drop|delete|update|insert|truncate|grant|revoke|create table|create trigger|create index)\b/.test(sql), false);
  assert.equal(/security definer/.test(sql), false, "same security properties as 090 (invoker)");
  assert.equal((sql.match(/set search_path = ''/g) ?? []).length, 2);
  assert.equal((sql.match(/returns trigger/g) ?? []).length, 2);
});

test("C / 12. both functions treat a missing provider as the Business via coalesce(..., 'recipient_business')", () => {
  const sql = strip(MIGRATION);
  assert.equal((sql.match(/coalesce\((new\.)?in_kind_provider, 'recipient_business'\) = 'recipient_business'/g) ?? []).length, 2);
});

test("C / 13. unrelated trigger behavior is preserved verbatim: structured early-return, custom-owns-nothing rule, unknown-option raise", () => {
  const sql = strip(MIGRATION);
  assert.equal((sql.match(/if (v_mode|new\.commercial_mode) = 'structured' then\s+return new;/g) ?? []).length, 2);
  assert.match(sql, /if new\.commercial_mode = 'custom' and exists \(\s*select 1 from public\.opportunity_option_components where option_id = new\.id\s*\) then/);
  assert.match(sql, /select commercial_mode into v_mode from public\.opportunity_options where id = new\.option_id;/);
  // 090 itself is untouched (the original rule is still visible there).
  assert.match(FOUNDATION, /new\.in_kind_required = false then/);
});
