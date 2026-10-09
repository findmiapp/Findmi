// Opportunities — Commercial Terms Foundation (Schema + Domain, Pass 1)
// AND Admin Builder + Atomic Aggregate Persistence (Pass 2). Pure domain
// functions plus static guards over the migrations/domain/form/bridge
// modules and the Admin builder UI. No database, no production writes.
// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AMOUNT_MODES,
  COMPONENT_TYPES,
  CONTRIBUTION_UNITS,
  CONTRIBUTION_UNIT_LABELS,
  IN_KIND_CATEGORIES,
  IN_KIND_PROVIDERS,
  OPTION_COMMERCIAL_MODES,
  calculateInKindEstimatedValueCents,
  calculateUnitValueCents,
  countMonetaryComponents,
  formatComponentAmount,
  formatComponentSummary,
  formatMonetaryPerUnitEquivalent,
  formatOptionSummary,
  formatOptionalContributions,
  formatQuantityUnit,
  isContributionUnit,
  isMonetaryComponentType,
  summarizeOptionEstimatedInKindValue,
  summarizeOptionsForCard,
  validateComponent,
  validateOption,
} from "../src/lib/opportunity-commercial-terms-domain.ts";
import { projectSafeLegacyPricing, isLegacyUnclassified, buildDefaultOption, toCommercialTermsRpcPayload } from "../src/lib/opportunity-commercial-terms-bridge.ts";
// opportunity-commercial-terms-form.ts genuinely needs real (non-type-only)
// imports from admin/form-helpers.ts, opportunity-listings-domain.ts and
// opportunity-commercial-terms-domain.ts — importing validateOption is the
// entire point (reuse, never duplicate, Pass 1's validation). Those
// internal relative imports are extensionless (the one convention every
// file in this codebase's build already relies on), which plain Node ESM
// can't resolve directly the way it can a zero-import pure module — so,
// exactly like actions.ts/opportunity-listings.ts elsewhere in this file,
// it's covered by static source assertions below rather than a live
// import.

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/--.*$/gm, "");
const MIGRATION = read("supabase/migrations/20261009000000_opportunity_commercial_terms_foundation.sql");
const PERSISTENCE_MIGRATION = read("supabase/migrations/20261010000000_opportunity_commercial_terms_persistence.sql");
const UNIT_VALUE_MIGRATION = read("supabase/migrations/20261011000000_opportunity_commercial_terms_unit_value.sql");
const LISTINGS_DOMAIN = read("src/lib/opportunity-listings-domain.ts");
const LISTINGS_LIB = read("src/lib/opportunity-listings.ts");
const GOALS_DOMAIN = read("src/lib/opportunity-goals-domain.ts");
const LISTINGS_MIGRATION = read("supabase/migrations/20261006044707_opportunity_listings_v1.sql");
const FORM_MODULE = read("src/lib/opportunity-commercial-terms-form.ts");
const ACTIONS = read("src/app/admin/(protected)/opportunities/actions.ts");
const OPPORTUNITY_FORM = read("src/app/admin/(protected)/opportunities/OpportunityForm.tsx");
const BUILDER = read("src/app/admin/(protected)/opportunities/CommercialTermsBuilder.tsx");
const DETAIL_PAGE = read("src/app/admin/(protected)/opportunities/[id]/page.tsx");

const fee = (over = {}) => ({ component_type: "participation_fee", amount_mode: "fixed", amount_min_cents: 75000, currency: "USD", ...over });
const inKind = (over = {}) => ({ component_type: "in_kind", in_kind_category: "product_samples", in_kind_provider: "recipient_business", ...over });

// ---------------------------------------------------------------- 1-5. valid coexistence

test("1. a single structured Option with one Participation Fee component is valid", () => {
  const r = validateOption({ commercial_mode: "structured", components: [fee()] });
  assert.equal(r.ok, true);
  assert.equal(r.value.components.length, 1);
  assert.equal(r.value.components[0].component_type, "participation_fee");
});

test("2/3. Participation Fee + In-Kind coexist within one Option", () => {
  const r = validateOption({ commercial_mode: "structured", components: [fee({ amount_min_cents: 75000 }), inKind({ in_kind_description: "Product for ~200 samples" })] });
  assert.equal(r.ok, true);
  assert.equal(r.value.components.length, 2);
  assert.equal(countMonetaryComponents(r.value.components), 1);
});

test("4. Compensation + In-Kind coexist within one Option", () => {
  const r = validateOption({
    commercial_mode: "structured",
    components: [
      { component_type: "compensation", amount_mode: "fixed", amount_min_cents: 150000, currency: "USD" },
      inKind({ in_kind_category: "equipment", in_kind_provider: "recipient_business", in_kind_description: "Business provides its own equipment" }),
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.value.components.map((c) => c.component_type),
    ["compensation", "in_kind"]
  );
});

test("5. Project Budget + multiple In-Kind rows (different providers) coexist", () => {
  const r = validateOption({
    commercial_mode: "structured",
    components: [
      { component_type: "project_budget", amount_mode: "range", amount_min_cents: 500000, amount_max_cents: 1000000, currency: "USD" },
      inKind({ in_kind_category: "space_venue", in_kind_provider: "organizer", in_kind_description: "Venue provides space" }),
      inKind({ in_kind_category: "product_samples", in_kind_provider: "recipient_business", in_kind_description: "Brand supplies samples" }),
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.components.length, 3);
  assert.equal(countMonetaryComponents(r.value.components), 1);
});

// ---------------------------------------------------------------- 6. monetary exclusivity

test("6. two monetary components in one Option are rejected (every pairing)", () => {
  const monetary = [
    { component_type: "participation_fee", amount_mode: "fixed", amount_min_cents: 75000, currency: "USD" },
    { component_type: "compensation", amount_mode: "fixed", amount_min_cents: 100000, currency: "USD" },
    { component_type: "project_budget", amount_mode: "range", amount_min_cents: 500000, amount_max_cents: 1000000, currency: "USD" },
  ];
  for (let i = 0; i < monetary.length; i++) {
    for (let j = 0; j < monetary.length; j++) {
      if (i === j) continue;
      const r = validateOption({ commercial_mode: "structured", components: [monetary[i], monetary[j]] });
      assert.equal(r.ok, false, `${monetary[i].component_type} + ${monetary[j].component_type}`);
    }
  }
});

test("different Options on the same Opportunity may use different monetary component types (no cross-option state)", () => {
  const a = validateOption({ commercial_mode: "structured", components: [fee()] });
  const b = validateOption({ commercial_mode: "structured", components: [{ component_type: "compensation", amount_mode: "fixed", amount_min_cents: 150000, currency: "USD" }] });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.value.components[0].component_type, "participation_fee");
  assert.equal(b.value.components[0].component_type, "compensation");
});

// ---------------------------------------------------------------- 7-11. amount modes

test("7. Fixed: requires a positive integer min, forbids a max", () => {
  assert.equal(validateComponent(fee({ amount_mode: "fixed", amount_min_cents: 75000 })).ok, true);
  assert.equal(validateComponent(fee({ amount_mode: "fixed", amount_min_cents: null })).ok, false);
  assert.equal(validateComponent(fee({ amount_mode: "fixed", amount_min_cents: 0 })).ok, false);
  assert.equal(validateComponent(fee({ amount_mode: "fixed", amount_min_cents: 75000, amount_max_cents: 150000 })).ok, false);
});

test("8. Starting At: same shape as Fixed, labeled differently when formatted", () => {
  const r = validateComponent(fee({ amount_mode: "starting_at", amount_min_cents: 150000 }));
  assert.equal(r.ok, true);
  assert.equal(formatComponentAmount(r.value), "Starting at $1,500");
  assert.equal(validateComponent(fee({ amount_mode: "starting_at", amount_min_cents: null })).ok, false);
});

test("9. Range: requires both bounds, max >= min", () => {
  const r = validateComponent(fee({ amount_mode: "range", amount_min_cents: 500000, amount_max_cents: 1000000 }));
  assert.equal(r.ok, true);
  assert.equal(formatComponentAmount(r.value), "$5,000–$10,000");
});

test("10. invalid Range rejected: missing max, missing min, max < min", () => {
  assert.equal(validateComponent(fee({ amount_mode: "range", amount_min_cents: 500000, amount_max_cents: null })).ok, false);
  assert.equal(validateComponent(fee({ amount_mode: "range", amount_min_cents: null, amount_max_cents: 1000000 })).ok, false);
  assert.equal(validateComponent(fee({ amount_mode: "range", amount_min_cents: 1000000, amount_max_cents: 500000 })).ok, false);
});

test("11. Undisclosed: direction known, no amount at all — and rejects a stray amount", () => {
  const r = validateComponent({ component_type: "compensation", amount_mode: "undisclosed", currency: "USD" });
  assert.equal(r.ok, true);
  assert.equal(formatComponentAmount(r.value), "Amount discussed with Findmi");
  assert.equal(validateComponent({ component_type: "compensation", amount_mode: "undisclosed", amount_min_cents: 100, currency: "USD" }).ok, false);
});

test("amount modes never include a 'custom' value", () => {
  assert.deepEqual([...AMOUNT_MODES], ["fixed", "starting_at", "range", "undisclosed"]);
});

// ---------------------------------------------------------------- 12-15. In-Kind

test("12. In-Kind categories are validated against the closed list", () => {
  assert.equal(validateComponent(inKind({ in_kind_category: "product_samples" })).ok, true);
  assert.equal(validateComponent(inKind({ in_kind_category: "not_a_real_category" })).ok, false);
});

test("13. In-Kind provider semantics: recipient_business means the recipient Business, not a generic creator", () => {
  for (const provider of IN_KIND_PROVIDERS) {
    assert.equal(validateComponent(inKind({ in_kind_provider: provider, in_kind_description: "x" })).ok, true, provider);
  }
  assert.equal(validateComponent(inKind({ in_kind_provider: "vendor" })).ok, false);
  assert.ok(IN_KIND_PROVIDERS.includes("recipient_business"));
  assert.equal(IN_KIND_PROVIDERS.includes("business"), false, "the ambiguous generic 'business' value must not exist");
});

test("14. optional estimated value: never required, must be positive when present", () => {
  const none = validateComponent(inKind({ estimated_value_cents: null }));
  assert.equal(none.ok, true);
  assert.equal(none.value.estimated_value_cents, null);
  const some = validateComponent(inKind({ estimated_value_cents: 50000 }));
  assert.equal(some.ok, true);
  assert.equal(some.value.estimated_value_cents, 50000);
  assert.equal(validateComponent(inKind({ estimated_value_cents: 0 })).ok, false);
  assert.equal(validateComponent(inKind({ estimated_value_cents: -100 })).ok, false);
});

test("15. 'other' category requires a description; every other category does not", () => {
  assert.equal(validateComponent(inKind({ in_kind_category: "other", in_kind_description: null })).ok, false);
  assert.equal(validateComponent(inKind({ in_kind_category: "other", in_kind_description: "Custom signage" })).ok, true);
  for (const category of IN_KIND_CATEGORIES.filter((c) => c !== "other")) {
    assert.equal(validateComponent(inKind({ in_kind_category: category, in_kind_description: null })).ok, true, category);
  }
});

// ---------------------------------------------------------------- 16-20 (revised). Complimentary / Custom / Structured states
//
// Complimentary + optional In-Kind integrity correction: commercial_mode
// is now a true classification of the component content, not merely
// "has zero rows". STRUCTURED = monetaryCount >= 1 OR requiredInKindCount
// >= 1. COMPLIMENTARY = monetaryCount === 0 AND requiredInKindCount === 0
// (zero or more OPTIONAL In-Kind rows are explicitly fine). CUSTOM = zero
// components of any kind.

const optionalInKind = (over = {}) => inKind({ in_kind_required: false, ...over });
const requiredInKind = (over = {}) => inKind({ in_kind_required: true, ...over });

test("1/16. Complimentary with zero Components is valid", () => {
  const r = validateOption({ commercial_mode: "complimentary", components: [] });
  assert.equal(r.ok, true);
  assert.equal(formatOptionSummary(r.value), "Complimentary");
});

test("2. Complimentary + optional In-Kind is valid, and stays Complimentary", () => {
  const r = validateOption({ commercial_mode: "complimentary", components: [optionalInKind({ in_kind_description: "Product samples welcome but not required" })] });
  assert.equal(r.ok, true);
  assert.equal(r.value.components.length, 1);
  assert.equal(r.value.components[0].in_kind_required, false);
  assert.equal(formatOptionSummary(r.value), "Complimentary");
});

test("3. Complimentary + required In-Kind is rejected", () => {
  assert.equal(validateOption({ commercial_mode: "complimentary", components: [requiredInKind()] }).ok, false);
});

test("4. Complimentary + a monetary component is rejected", () => {
  assert.equal(validateOption({ commercial_mode: "complimentary", components: [fee()] }).ok, false);
  assert.equal(validateOption({ commercial_mode: "complimentary", components: [fee(), optionalInKind()] }).ok, false);
});

test("5. Structured + required In-Kind only (no monetary) is valid", () => {
  const r = validateOption({ commercial_mode: "structured", components: [requiredInKind()] });
  assert.equal(r.ok, true);
});

test("6. Structured + monetary only is valid", () => {
  const r = validateOption({ commercial_mode: "structured", components: [fee()] });
  assert.equal(r.ok, true);
});

test("7. Structured + monetary + optional AND required In-Kind is valid", () => {
  const withOptional = validateOption({ commercial_mode: "structured", components: [fee(), optionalInKind()] });
  const withRequired = validateOption({ commercial_mode: "structured", components: [fee(), requiredInKind({ in_kind_category: "staffing" })] });
  assert.equal(withOptional.ok, true);
  assert.equal(withRequired.ok, true);
});

test("8/18. Structured with only optional In-Kind (no monetary, no required In-Kind) is rejected", () => {
  const r = validateOption({ commercial_mode: "structured", components: [optionalInKind()] });
  assert.equal(r.ok, false);
  assert.match(r.error, /Complimentary instead/);
});

test("9/17/20. Custom with any Component (monetary or In-Kind, required or optional) remains rejected", () => {
  assert.equal(validateOption({ commercial_mode: "custom", components: [fee()] }).ok, false);
  assert.equal(validateOption({ commercial_mode: "custom", components: [requiredInKind()] }).ok, false);
  assert.equal(validateOption({ commercial_mode: "custom", components: [optionalInKind()] }).ok, false);
});

test("19. deliberate Custom is valid with zero Components and an optional note", () => {
  const r = validateOption({ commercial_mode: "custom", components: [], custom_terms_note: "Revenue share — discuss with Findmi" });
  assert.equal(r.ok, true);
  assert.equal(r.value.custom_terms_note, "Revenue share — discuss with Findmi");
  assert.equal(formatOptionSummary(r.value), "Custom Terms");
});

test("a custom_terms_note on a non-Custom Option is rejected", () => {
  assert.equal(validateOption({ commercial_mode: "structured", components: [fee()], custom_terms_note: "should not be here" }).ok, false);
  assert.equal(validateOption({ commercial_mode: "complimentary", components: [], custom_terms_note: "should not be here" }).ok, false);
});

// ---------------------------------------------------------------- 10. formatter truthfulness

test("10. the primary summary stays 'Complimentary' when optional In-Kind exists; detail-level formatter exposes it separately", () => {
  const bare = validateOption({ commercial_mode: "complimentary", components: [] }).value;
  const withOptional = validateOption({ commercial_mode: "complimentary", components: [optionalInKind({ in_kind_category: "product_samples" })] }).value;
  assert.equal(formatOptionSummary(bare), "Complimentary");
  assert.equal(formatOptionSummary(withOptional), "Complimentary", "must never become 'In-Kind Contribution Required' or anything else");
  assert.deepEqual(formatOptionalContributions(bare), []);
  assert.deepEqual(formatOptionalContributions(withOptional), ["Optional: Product / Samples"]);
});

test("formatOptionalContributions never lists a required In-Kind component", () => {
  const structured = validateOption({ commercial_mode: "structured", components: [fee(), requiredInKind({ in_kind_category: "staffing" }), optionalInKind({ in_kind_category: "equipment" })] }).value;
  assert.deepEqual(formatOptionalContributions(structured), ["Optional: Equipment"]);
});

// ---------------------------------------------------------------- 21. names are presentation only

test("21. option name/description never affect commercial semantics", () => {
  const a = validateOption({ name: "Resident Demo", commercial_mode: "structured", components: [fee()] });
  const b = validateOption({ name: "Featured Resident Demo", description: "Our most popular package", commercial_mode: "structured", components: [fee()] });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(formatOptionSummary(a.value), formatOptionSummary(b.value));
  assert.notEqual(a.value.name, b.value.name);
});

// ---------------------------------------------------------------- formatters / multi-option summary

test("formatters render every example from the brief", () => {
  assert.equal(formatComponentSummary(validateComponent(fee({ amount_mode: "fixed", amount_min_cents: 75000 })).value), "Participation Fee — $750");
  assert.equal(
    formatComponentSummary(validateComponent(fee({ amount_mode: "starting_at", amount_min_cents: 150000 })).value),
    "Participation Fee — Starting at $1,500"
  );
  assert.equal(
    formatComponentSummary(
      validateComponent({ component_type: "compensation", amount_mode: "range", amount_min_cents: 100000, amount_max_cents: 200000, currency: "USD" }).value
    ),
    "Compensation — $1,000–$2,000"
  );
  assert.equal(
    formatComponentSummary(validateComponent({ component_type: "compensation", amount_mode: "undisclosed", currency: "USD" }).value),
    "Compensation — Amount discussed with Findmi"
  );
  assert.equal(
    formatComponentSummary(
      validateComponent({ component_type: "project_budget", amount_mode: "range", amount_min_cents: 500000, amount_max_cents: 1000000, currency: "USD" }).value
    ),
    "Project Budget — $5,000–$10,000"
  );
  assert.equal(formatComponentSummary(validateComponent(inKind({ in_kind_category: "product_samples" })).value), "In-Kind — Product / Samples");
});

test("mixed cash + In-Kind summary joins both parts", () => {
  const option = validateOption({ commercial_mode: "structured", components: [fee({ amount_min_cents: 150000 }), inKind({ in_kind_description: "Product for ~250 samples" })] }).value;
  assert.equal(formatOptionSummary(option), "Participation Fee — $1,500 + In-Kind — Product / Samples");
});

test("multiple options: uniform single-direction fixed/starting_at amounts collapse to 'Options from $X'", () => {
  const options = [
    validateOption({ commercial_mode: "structured", components: [fee({ amount_min_cents: 75000 })] }).value,
    validateOption({ commercial_mode: "structured", components: [fee({ amount_mode: "starting_at", amount_min_cents: 150000 })] }).value,
  ];
  assert.equal(summarizeOptionsForCard(options), "Options from $750");
});

test("multiple options: mixed monetary direction never blends into one number", () => {
  const options = [
    validateOption({ commercial_mode: "structured", components: [fee({ amount_min_cents: 75000 })] }).value,
    validateOption({
      commercial_mode: "structured",
      components: [{ component_type: "compensation", amount_mode: "fixed", amount_min_cents: 150000, currency: "USD" }],
    }).value,
  ];
  assert.equal(summarizeOptionsForCard(options), "2 Options");
});

test("multiple options: any Range, Undisclosed, Complimentary, or Custom option forces the neutral 'N Options' fallback", () => {
  const base = validateOption({ commercial_mode: "structured", components: [fee({ amount_min_cents: 75000 })] }).value;
  const withRange = validateOption({
    commercial_mode: "structured",
    components: [{ component_type: "participation_fee", amount_mode: "range", amount_min_cents: 50000, amount_max_cents: 100000, currency: "USD" }],
  }).value;
  const withComplimentary = validateOption({ commercial_mode: "complimentary", components: [] }).value;
  for (const other of [withRange, withComplimentary]) {
    assert.equal(summarizeOptionsForCard([base, other]), "2 Options");
  }
});

// ---------------------------------------------------------------- legacy / untouched systems

test("23. legacy opportunity_listings pricing columns are untouched by the new migration", () => {
  assert.equal(/alter table public\.opportunity_listings/i.test(strip(MIGRATION)), false);
  assert.equal(/drop column|rename column/i.test(strip(MIGRATION)), false);
  // The original V1 migration's pricing columns/constraints are still exactly as they were.
  assert.match(LISTINGS_MIGRATION, /pricing_mode\s+text not null/);
  assert.match(LISTINGS_MIGRATION, /price_cents\s+integer/);
  assert.match(LISTINGS_MIGRATION, /credits_eligible\s+boolean not null default false/);
  assert.match(LISTINGS_DOMAIN, /export const PRICING_MODES = \["fixed", "starting_at", "complimentary", "custom"\]/);
});

test("24. no automatic legacy direction inference: nothing backfills opportunity_options rows", () => {
  const body = strip(MIGRATION);
  assert.equal(/insert into public\.opportunity_options/i.test(body), false);
  assert.equal(/insert into public\.opportunity_option_components/i.test(body), false);
  assert.equal(/\btabli\b/i.test(MIGRATION), false, "no reference to the real production listing");
});

test("25. Goals behavior is unchanged", () => {
  assert.match(GOALS_DOMAIN, /export const GOAL_BUDGET_BANDS = \[/);
  assert.equal(/opportunity_option/i.test(GOALS_DOMAIN), false, "Goals domain module has no awareness of the new tables");
});

test("26. existing Opportunities authorization is unchanged; the new tables are wired ADMIN-ONLY (Pass 2), never into a Business-facing read", () => {
  assert.match(LISTINGS_LIB, /await requireBusinessMember\(businessId\)/);
  assert.match(LISTINGS_LIB, /await requireAdmin\(\)/);
  // Pass 2 adds exactly one admin-only reader of the new tables.
  assert.match(LISTINGS_LIB, /export async function getAdminOpportunityOptions/);
  const adminFn = LISTINGS_LIB.match(/export async function getAdminOpportunityOptions[\s\S]*?\n}\n/)[0];
  assert.match(adminFn, /await requireAdmin\(\)/);
  assert.match(adminFn, /opportunity_options/);
  // Every BUSINESS-facing read function is untouched — none of them
  // mentions the new tables.
  for (const fnName of ["getBusinessOpportunities", "getBusinessOpportunity", "getBusinessOpportunityItems", "getBusinessOpportunityItem", "getExploreItems", "getExploreItem", "expressExploreInterest", "respondToOpportunityListing"]) {
    const re = new RegExp(`export async function ${fnName}\\([\\s\\S]*?\\n}\\n`);
    const m = LISTINGS_LIB.match(re);
    assert.ok(m, `${fnName} not found`);
    assert.equal(/opportunity_options|opportunity_option_components/i.test(m[0]), false, `${fnName} must not reference the new tables`);
  }
});

// ---------------------------------------------------------------- migration/domain drift guard

test("drift guard: migration CHECK lists match the domain constants exactly", () => {
  const listFor = (constraintName) => {
    const re = new RegExp(`constraint ${constraintName}[\\s\\S]*?check \\(([^)]*?in \\(([^)]*)\\))`, "m");
    const m = MIGRATION.match(re);
    assert.ok(m, `constraint ${constraintName} not found`);
    return [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  };
  assert.deepEqual(listFor("opportunity_options_commercial_mode_check"), [...OPTION_COMMERCIAL_MODES]);
  assert.deepEqual(listFor("opportunity_option_components_type_check"), [...COMPONENT_TYPES]);
  assert.deepEqual(listFor("opportunity_option_components_in_kind_category_check"), [...IN_KIND_CATEGORIES]);
  assert.deepEqual(listFor("opportunity_option_components_in_kind_provider_check"), [...IN_KIND_PROVIDERS]);
  // amount_mode's check is written as "amount_mode is null or amount_mode in (...)" — same list-extraction, different anchor.
  const amountModeMatch = MIGRATION.match(/constraint opportunity_option_components_amount_mode_check[\s\S]*?in \(([^)]*)\)/);
  assert.ok(amountModeMatch);
  const amountModes = [...amountModeMatch[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  assert.deepEqual(amountModes, [...AMOUNT_MODES]);
});

// ---------------------------------------------------------------- Issue 1: documented aggregate-write persistence contract

const DOMAIN = read("src/lib/opportunity-commercial-terms-domain.ts");

test("11. the aggregate-write persistence contract for the future Admin builder is documented in both the migration and the domain module", () => {
  // The migration names the decision: Option + Components persist together
  // through one validated RPC/transaction (mirroring approve_pro_access_request),
  // never two sequential client inserts that could leave a structured Option
  // transiently empty.
  // Join wrapped SQL comment lines back into prose (strip() deletes comment
  // content entirely, which is the opposite of what this test needs).
  const migrationProse = MIGRATION.replace(/^\s*--\s?/gm, " ").replace(/\s+/g, " ");
  assert.match(migrationProse, /Persistence contract for the upcoming Admin builder/);
  assert.match(MIGRATION, /approve_pro_access_request/);
  assert.match(MIGRATION, /ONE validated aggregate write/);
  // The domain module names validateOption as the single pre-write gate that
  // aggregate write must call — so the next pass can't accidentally persist
  // an incomplete structured Option by skipping validation.
  assert.match(DOMAIN, /single pre-write gate the future Admin builder/);
  assert.match(DOMAIN, /Option \+ Components persisted together in one RPC\//);
});

// ---------------------------------------------------------------- DB invariants present (static structural checks)

test("DB layer: RLS enabled, no client grants, service-role only — same pattern as the existing Opportunities tables", () => {
  for (const table of ["opportunity_options", "opportunity_option_components"]) {
    assert.match(MIGRATION, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(MIGRATION, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
    assert.match(MIGRATION, new RegExp(`grant all on public\\.${table} to service_role`));
  }
  assert.equal(/create policy/i.test(MIGRATION), false, "no client-facing RLS policy — server-only access");
});

test("DB layer: at most one monetary component per option is a partial unique index, not just an app check", () => {
  assert.match(
    MIGRATION,
    /create unique index opportunity_option_components_one_monetary_idx\s+on public\.opportunity_option_components \(option_id\)\s+where component_type in \('participation_fee', 'compensation', 'project_budget'\)/
  );
});

test("DB layer: Custom Options own zero Components; Complimentary Options own only optional In-Kind — enforced by trigger in both directions", () => {
  assert.match(MIGRATION, /create trigger trg_opportunity_option_components_mode_check/);
  assert.match(MIGRATION, /create trigger trg_opportunity_options_mode_change_check/);
  // Insert/update direction: a component row may only exist when the parent is
  // structured, OR complimentary with an optional (not required) in_kind row.
  assert.match(MIGRATION, /if v_mode = 'structured' then\s+return new;/);
  assert.match(MIGRATION, /if v_mode = 'complimentary' and new\.component_type = 'in_kind' and new\.in_kind_required = false then\s+return new;/);
  assert.match(MIGRATION, /raise exception 'opportunity_option_components: option % is % and cannot own this Component/);
  // Reverse direction: switching to custom requires zero rows; switching to
  // complimentary requires no monetary/required-in-kind row (optional stays).
  assert.match(MIGRATION, /raise exception 'opportunity_options: % cannot be set to custom while it still owns Components'/);
  assert.match(MIGRATION, /not \(component_type = 'in_kind' and in_kind_required = false\)/);
  assert.match(MIGRATION, /raise exception 'opportunity_options: % cannot be set to complimentary while it owns a monetary or required In-Kind Component'/);
});

test("DB layer: updated_at triggers reuse the existing set_updated_at() function, no new trigger mechanism invented", () => {
  assert.match(MIGRATION, /execute function public\.set_updated_at\(\)/);
});

// ---------------------------------------------------------------- opportunity_recipients.option_id deferred

test("opportunity_recipients.option_id was deferred, not added, in this pass", () => {
  assert.equal(/alter table public\.opportunity_recipients/i.test(MIGRATION), false);
  assert.equal(/option_id/i.test(LISTINGS_MIGRATION), false);
});

// ============================================================================
// Admin Builder + Atomic Aggregate Persistence (Pass 2)
// ============================================================================

// ---------------------------------------------------------------- bridge: SAFE legacy pricing projection (live)
//
// Correction (Pass 2 review): the original deriveLegacyPricing() projected
// whichever Option happened to be first, regardless of commercial
// direction — unsafe (Compensation/Project Budget could show as a
// Business-pays "Investment" amount; a second Option's different price
// was silently hidden). Renamed to projectSafeLegacyPricing(); the tests
// below are the 17 required cases plus the explicit safety proofs.

const NEUTRAL = { pricing_mode: "custom", price: null, currency: "USD" };
const participationFee = (over = {}) => ({ component_type: "participation_fee", amount_mode: "fixed", amount_min_cents: 75000, currency: "USD", ...over });
const compensation = (over = {}) => ({ component_type: "compensation", amount_mode: "fixed", amount_min_cents: 150000, currency: "USD", ...over });
const projectBudget = (over = {}) => ({ component_type: "project_budget", amount_mode: "fixed", amount_min_cents: 1000000, currency: "USD", ...over });
const structured = (component) => ({ commercial_mode: "structured", components: [component] });

// 1. Single Participation Fee — Fixed
test("Pass 2 / 1. case 1 — single Participation Fee, Fixed: projects 1:1 to legacy fixed", () => {
  assert.deepEqual(projectSafeLegacyPricing([structured(participationFee())]), { pricing_mode: "fixed", price: "750", currency: "USD" });
});

// 2. Single Participation Fee — Starting At
test("Pass 2 / 2. case 2 — single Participation Fee, Starting At: projects 1:1 to legacy starting_at", () => {
  const r = projectSafeLegacyPricing([structured(participationFee({ amount_mode: "starting_at", amount_min_cents: 100000 }))]);
  assert.deepEqual(r, { pricing_mode: "starting_at", price: "1000", currency: "USD" });
});

// 3. Single Participation Fee — Range
test("Pass 2 / 3. case 3 — single Participation Fee, Range: NEUTRAL (no single honest floor to claim as the amount)", () => {
  const r = projectSafeLegacyPricing([structured(participationFee({ amount_mode: "range", amount_min_cents: 50000, amount_max_cents: 100000 }))]);
  assert.deepEqual(r, NEUTRAL);
});

// 4. Single Participation Fee — Undisclosed
test("Pass 2 / 4. case 4 — single Participation Fee, Undisclosed: NEUTRAL (no amount to show)", () => {
  const r = projectSafeLegacyPricing([structured(participationFee({ amount_mode: "undisclosed", amount_min_cents: null }))]);
  assert.deepEqual(r, NEUTRAL);
});

// 5/6/7. Compensation (Fixed/Range/Undisclosed) — the Business RECEIVES this; NEVER a legacy "Investment" amount
test("Pass 2 / 5. case 5 — single Compensation, Fixed: NEUTRAL, never a legacy amount (the Business RECEIVES this; legacy 'Investment' only ever means the Business PAYS)", () => {
  assert.deepEqual(projectSafeLegacyPricing([structured(compensation())]), NEUTRAL);
});
test("Pass 2 / 6. case 6 — single Compensation, Range: NEUTRAL", () => {
  assert.deepEqual(projectSafeLegacyPricing([structured(compensation({ amount_mode: "range", amount_min_cents: 100000, amount_max_cents: 200000 }))]), NEUTRAL);
});
test("Pass 2 / 7. case 7 — single Compensation, Undisclosed: NEUTRAL", () => {
  assert.deepEqual(projectSafeLegacyPricing([structured(compensation({ amount_mode: "undisclosed", amount_min_cents: null }))]), NEUTRAL);
});

// 8/9/10. Project Budget (Fixed/Range/Undisclosed) — a budget figure is not a payment; NEVER a legacy "Investment" amount
test("Pass 2 / 8. case 8 — single Project Budget, Fixed: NEUTRAL, never a legacy amount (a budget figure is not a payment)", () => {
  assert.deepEqual(projectSafeLegacyPricing([structured(projectBudget())]), NEUTRAL);
});
test("Pass 2 / 9. case 9 — single Project Budget, Range: NEUTRAL", () => {
  assert.deepEqual(projectSafeLegacyPricing([structured(projectBudget({ amount_mode: "range", amount_min_cents: 500000, amount_max_cents: 1500000 }))]), NEUTRAL);
});
test("Pass 2 / 10. case 10 — single Project Budget, Undisclosed: NEUTRAL", () => {
  assert.deepEqual(projectSafeLegacyPricing([structured(projectBudget({ amount_mode: "undisclosed", amount_min_cents: null }))]), NEUTRAL);
});

// 11. Structured In-Kind only
test("Pass 2 / 11. case 11 — Structured, In-Kind only (no monetary component): NEUTRAL, never invents a price", () => {
  const r = projectSafeLegacyPricing([{ commercial_mode: "structured", components: [{ component_type: "in_kind", in_kind_category: "staffing", in_kind_provider: "findmi", in_kind_required: true }] }]);
  assert.deepEqual(r, NEUTRAL);
});

// 12/13. Complimentary / Complimentary + optional In-Kind
test("Pass 2 / 12. case 12 — Complimentary: projects to legacy complimentary", () => {
  assert.deepEqual(projectSafeLegacyPricing([{ commercial_mode: "complimentary", components: [] }]), { pricing_mode: "complimentary", price: null, currency: "USD" });
});
test("Pass 2 / 13. case 13 — Complimentary + optional In-Kind: still legacy complimentary (the optional In-Kind doesn't change the fact it's free)", () => {
  const r = projectSafeLegacyPricing([
    { commercial_mode: "complimentary", components: [{ component_type: "in_kind", in_kind_category: "product_samples", in_kind_provider: "recipient_business", in_kind_required: false }] },
  ]);
  assert.deepEqual(r, { pricing_mode: "complimentary", price: null, currency: "USD" });
});

// 14. Custom
test("Pass 2 / 14. case 14 — Custom: NEUTRAL (legacy custom, 'Contact Findmi')", () => {
  assert.deepEqual(projectSafeLegacyPricing([{ commercial_mode: "custom", components: [] }]), NEUTRAL);
});

// 15. Multiple Options, same monetary direction
test("Pass 2 / 15. case 15 — two Options, both Participation Fee Fixed/Starting At: projects the MINIMUM floor as starting_at (a true lower bound, never one arbitrary exact price)", () => {
  const r = projectSafeLegacyPricing([structured(participationFee({ amount_min_cents: 150000 })), structured(participationFee({ amount_mode: "starting_at", amount_min_cents: 75000 }))]);
  assert.deepEqual(r, { pricing_mode: "starting_at", price: "750", currency: "USD" });
});
test("Pass 2 / 15b. case 15 — order independence: the SAME two Options in the OPPOSITE order yield the identical projection (never 'whichever is first')", () => {
  const a = structured(participationFee({ amount_min_cents: 150000 }));
  const b = structured(participationFee({ amount_mode: "starting_at", amount_min_cents: 75000 }));
  assert.deepEqual(projectSafeLegacyPricing([a, b]), projectSafeLegacyPricing([b, a]));
});
test("Pass 2 / 15c. case 15 — same direction but one uses Range: NEUTRAL (not every Option has a clean floor, so the set doesn't uniformly qualify)", () => {
  const r = projectSafeLegacyPricing([structured(participationFee()), structured(participationFee({ amount_mode: "range", amount_min_cents: 50000, amount_max_cents: 100000 }))]);
  assert.deepEqual(r, NEUTRAL);
});

// 16. Multiple Options, different monetary directions
test("Pass 2 / 16. case 16 — one Participation Fee Option + one Compensation Option: NEUTRAL, never exposes the Participation Fee amount alone", () => {
  const r = projectSafeLegacyPricing([structured(participationFee()), structured(compensation())]);
  assert.deepEqual(r, NEUTRAL);
});

// 17. Multiple Options, no monetary component at all
test("Pass 2 / 17. case 17 — one Complimentary Option + one Structured In-Kind-only Option (no monetary anywhere): NEUTRAL, never guesses 'complimentary' for a mix", () => {
  const r = projectSafeLegacyPricing([
    { commercial_mode: "complimentary", components: [] },
    { commercial_mode: "structured", components: [{ component_type: "in_kind", in_kind_category: "staffing", in_kind_provider: "findmi", in_kind_required: true }] },
  ]);
  assert.deepEqual(r, NEUTRAL);
});
test("Pass 2 / 17b. case 17 — every Option Complimentary (no monetary anywhere, but uniformly free): legacy complimentary", () => {
  const r = projectSafeLegacyPricing([{ commercial_mode: "complimentary", components: [] }, { commercial_mode: "complimentary", components: [] }]);
  assert.deepEqual(r, { pricing_mode: "complimentary", price: null, currency: "USD" });
});

// ---------------------------------------------------------------- explicit safety proofs required by the review

test("Pass 2 / proof-1. no first-Option / array-position semantics remain anywhere in the function's own source", () => {
  const fn = read("src/lib/opportunity-commercial-terms-bridge.ts").match(/export function projectSafeLegacyPricing[\s\S]*?\n\}/)[0];
  assert.equal(/options\[0\]|\bfirst\b/i.test(fn), false, "no indexing into options[0] or a 'first' variable anywhere in the real logic");
});

test("Pass 2 / proof-2. Compensation is NEVER projected as a legacy amount, for every amount_mode", () => {
  for (const mode of ["fixed", "starting_at", "range", "undisclosed"]) {
    const amounts = mode === "range" ? { amount_min_cents: 100000, amount_max_cents: 200000 } : mode === "undisclosed" ? { amount_min_cents: null } : { amount_min_cents: 100000 };
    const r = projectSafeLegacyPricing([structured(compensation({ amount_mode: mode, ...amounts }))]);
    assert.notEqual(r.pricing_mode, "fixed");
    assert.notEqual(r.pricing_mode, "starting_at");
  }
});

test("Pass 2 / proof-3. Project Budget is NEVER projected as a legacy amount, for every amount_mode", () => {
  for (const mode of ["fixed", "starting_at", "range", "undisclosed"]) {
    const amounts = mode === "range" ? { amount_min_cents: 100000, amount_max_cents: 200000 } : mode === "undisclosed" ? { amount_min_cents: null } : { amount_min_cents: 100000 };
    const r = projectSafeLegacyPricing([structured(projectBudget({ amount_mode: mode, ...amounts }))]);
    assert.notEqual(r.pricing_mode, "fixed");
    assert.notEqual(r.pricing_mode, "starting_at");
  }
});

test("Pass 2 / proof-4. a mixed-direction multi-Option arrangement never exposes one arbitrary amount, regardless of which Option is listed first", () => {
  const fee = structured(participationFee({ amount_min_cents: 999999 }));
  const comp = structured(compensation());
  assert.deepEqual(projectSafeLegacyPricing([fee, comp]), NEUTRAL);
  assert.deepEqual(projectSafeLegacyPricing([comp, fee]), NEUTRAL);
});

test("Pass 2 / proof-5. a same-direction multi-Option arrangement is flattened ONLY when every Option independently proves safe (Fixed/Starting At, same currency) — one disqualifying Option voids the whole projection", () => {
  const safe = structured(participationFee());
  const undisclosedOne = structured(participationFee({ amount_mode: "undisclosed", amount_min_cents: null }));
  assert.notDeepEqual(projectSafeLegacyPricing([safe, safe]), NEUTRAL, "uniformly safe -> an amount IS projected");
  assert.deepEqual(projectSafeLegacyPricing([safe, undisclosedOne]), NEUTRAL, "one unsafe Option voids the set");
});

test("Pass 2 / proof-6. Range is never flattened into a single invented amount, alone or mixed with a safe Option", () => {
  const range = structured(participationFee({ amount_mode: "range", amount_min_cents: 50000, amount_max_cents: 150000 }));
  assert.deepEqual(projectSafeLegacyPricing([range]), NEUTRAL);
  assert.deepEqual(projectSafeLegacyPricing([range, structured(participationFee())]), NEUTRAL);
});

test("Pass 2 / proof-7. Undisclosed never invents an amount, alone or mixed with a safe Option", () => {
  const undisclosed = structured(participationFee({ amount_mode: "undisclosed", amount_min_cents: null }));
  assert.deepEqual(projectSafeLegacyPricing([undisclosed]), NEUTRAL);
  assert.deepEqual(projectSafeLegacyPricing([undisclosed, structured(participationFee())]), NEUTRAL);
});

test("Pass 2 / proof-8. Complimentary remains truthful: projected only when EVERY Option is Complimentary, never as a side effect of a mixed arrangement", () => {
  assert.deepEqual(projectSafeLegacyPricing([{ commercial_mode: "complimentary", components: [] }]).pricing_mode, "complimentary");
  assert.notEqual(projectSafeLegacyPricing([{ commercial_mode: "complimentary", components: [] }, structured(participationFee())]).pricing_mode, "complimentary");
});

test("Pass 2 / proof-9. Complimentary + optional In-Kind remains truthful — optional In-Kind on any Option never flips the projection away from complimentary", () => {
  const withOptionalInKind = { commercial_mode: "complimentary", components: [{ component_type: "in_kind", in_kind_category: "equipment", in_kind_provider: "findmi", in_kind_required: false }] };
  assert.equal(projectSafeLegacyPricing([withOptionalInKind]).pricing_mode, "complimentary");
});

test("Pass 2 / proof-10. In-Kind-only never invents monetary pricing, Structured or mixed with Complimentary", () => {
  const inKindOnly = { commercial_mode: "structured", components: [{ component_type: "in_kind", in_kind_category: "services", in_kind_provider: "organizer", in_kind_required: true }] };
  assert.deepEqual(projectSafeLegacyPricing([inKindOnly]), NEUTRAL);
  assert.deepEqual(projectSafeLegacyPricing([inKindOnly, { commercial_mode: "complimentary", components: [] }]), NEUTRAL);
});

test("Pass 2 / proof-11. Custom remains neutral, alone or mixed with anything else", () => {
  assert.deepEqual(projectSafeLegacyPricing([{ commercial_mode: "custom", components: [] }]), NEUTRAL);
  assert.deepEqual(projectSafeLegacyPricing([{ commercial_mode: "custom", components: [] }, structured(participationFee())]), NEUTRAL);
});

test("Pass 2 / proof: mixed currencies across safe-looking Options never get averaged/combined into one number", () => {
  const usd = structured(participationFee({ currency: "USD" }));
  const cad = structured(participationFee({ currency: "CAD" }));
  assert.deepEqual(projectSafeLegacyPricing([usd, cad]), NEUTRAL);
});

test("Pass 2 / proof: an empty Options array is NEUTRAL, never throws", () => {
  assert.deepEqual(projectSafeLegacyPricing([]), NEUTRAL);
});

// ---------------------------------------------------------------- bridge: legacy classification + default option (live)

test("Pass 2 / 10. isLegacyUnclassified is true only for exactly zero Options", () => {
  assert.equal(isLegacyUnclassified(0), true);
  assert.equal(isLegacyUnclassified(1), false);
  assert.equal(isLegacyUnclassified(5), false);
});

test("Pass 2 / 11. buildDefaultOption: a brand-new Opportunity defaults to Structured with zero Components (never auto-Complimentary)", () => {
  const d = buildDefaultOption();
  assert.equal(d.commercial_mode, "structured");
  assert.deepEqual(d.components, []);
  assert.equal(d.name, null);
});

// ---------------------------------------------------------------- bridge: RPC payload shaping (live)

test("Pass 2 / 12. toCommercialTermsRpcPayload: reshapes Option+Components 1:1, preserving a given id and nulling a new one", () => {
  const payload = toCommercialTermsRpcPayload([
    { id: "existing-id", name: "Resident Demo", description: null, commercial_mode: "structured", custom_terms_note: null, components: [{ component_type: "participation_fee", amount_mode: "fixed", amount_min_cents: 75000, amount_max_cents: null, currency: "USD", in_kind_category: null, in_kind_description: null, in_kind_provider: null, in_kind_required: true, estimated_value_cents: null }] },
    { id: null, name: null, description: null, commercial_mode: "complimentary", custom_terms_note: null, components: [] },
  ]);
  assert.equal(payload.length, 2);
  assert.equal(payload[0].id, "existing-id");
  assert.equal(payload[0].components.length, 1);
  assert.equal(payload[0].components[0].component_type, "participation_fee");
  assert.equal(payload[1].id, null);
  assert.deepEqual(payload[1].components, []);
});

// ---------------------------------------------------------------- form.ts: static reuse guards (no divergent logic)

test("Pass 2 / 13. parseCommercialTermsForm imports and calls the UNMODIFIED Pass 1 validateOption — never a second implementation", () => {
  assert.match(FORM_MODULE, /import\s*\{[^}]*\bvalidateOption\b[^}]*\}\s*from\s*"\.\/opportunity-commercial-terms-domain"/);
  assert.match(FORM_MODULE, /validateOption\(input\)/);
  // No local re-derivation of the classification rules Pass 1 already owns.
  assert.equal(/monetaryCount|requiredInKindCount/.test(FORM_MODULE), false, "classification math lives only in validateOption");
});

test("Pass 2 / 14. parseCommercialTermsForm uses typed, individually-named form fields — never one JSON blob through a hidden input", () => {
  assert.equal(/JSON\.parse|JSON\.stringify/.test(FORM_MODULE), false);
  assert.match(FORM_MODULE, /`\$\{prefix\}_type`/);
  assert.match(FORM_MODULE, /"ct_count"/);
  assert.match(FORM_MODULE, /`\$\{prefix\}_comp_count`/);
});

test("Pass 2 / 15. parseCommercialTermsForm rejects zero Options and caps both Option and Component counts", () => {
  assert.match(FORM_MODULE, /optionCount < 1/);
  assert.match(FORM_MODULE, /MAX_OPTIONS/);
  assert.match(FORM_MODULE, /MAX_COMPONENTS_PER_OPTION/);
});

test("Pass 2 / 16. parseCommercialTermsForm reuses parsePriceToCents (the existing legacy dollar-string parser) rather than a second money parser", () => {
  assert.match(FORM_MODULE, /import\s*\{\s*parsePriceToCents\s*\}\s*from\s*"\.\/opportunity-listings-domain"/);
});

// ---------------------------------------------------------------- RPC persistence migration (static structural — no DB access)

test("Pass 2 / 17. replace_opportunity_options is SECURITY DEFINER, search_path pinned, service_role-only — same hardening as approve_pro_access_request", () => {
  assert.match(PERSISTENCE_MIGRATION, /create or replace function public\.replace_opportunity_options/);
  assert.match(PERSISTENCE_MIGRATION, /security definer/);
  assert.match(PERSISTENCE_MIGRATION, /set search_path = ''/);
  assert.match(PERSISTENCE_MIGRATION, /revoke execute on function public\.replace_opportunity_options\(uuid, jsonb\) from public, anon, authenticated/);
  assert.match(PERSISTENCE_MIGRATION, /grant execute on function public\.replace_opportunity_options\(uuid, jsonb\) to service_role/);
});

test("Pass 2 / 18. the RPC's own comment explicitly corrects the Pass 1 report: a Postgres function cannot call TypeScript validateOption()", () => {
  const prose = PERSISTENCE_MIGRATION.replace(/^\s*--\s?/gm, " ").replace(/\s+/g, " ");
  assert.match(prose, /assumed a future Postgres RPC could "call validateOption\(\)"\. It cannot/);
  assert.match(prose, /already have been checked in TypeScript, server-side, before this function is ever called/);
});

test("Pass 2 / 19. the RPC rejects an empty Options array and a listing that doesn't exist — defense-in-depth, not trust", () => {
  assert.match(PERSISTENCE_MIGRATION, /raise exception 'listing_not_found'/);
  assert.match(PERSISTENCE_MIGRATION, /raise exception 'no_options'/);
  assert.match(PERSISTENCE_MIGRATION, /jsonb_array_length\(p_options\) = 0/);
});

test("Pass 2 / 20. the RPC rejects an incoming Option id that doesn't belong to p_listing_id (foreign_option_id)", () => {
  assert.match(PERSISTENCE_MIGRATION, /raise exception 'foreign_option_id'/);
  assert.match(PERSISTENCE_MIGRATION, /where id = v_option_id and listing_id = p_listing_id/);
});

test("Pass 2 / 21. the RPC is a single PL\\/pgSQL function body — one implicit transaction, no explicit BEGIN/COMMIT needed and none added", () => {
  assert.equal(/\bbegin\s*;|\bcommit\s*;/i.test(PERSISTENCE_MIGRATION), false, "no second, manually-opened transaction — the function body IS the transaction");
  assert.match(PERSISTENCE_MIGRATION, /language plpgsql/);
});

test("Pass 2 / 22. the RPC preserves a submitted Option's existing id (UPDATE), and only inserts fresh when no id is given — stable ids across ordinary edits", () => {
  assert.match(PERSISTENCE_MIGRATION, /if v_option_id is not null then/);
  assert.match(PERSISTENCE_MIGRATION, /update public\.opportunity_options/);
  assert.match(PERSISTENCE_MIGRATION, /insert into public\.opportunity_options/);
});

test("Pass 2 / 23. the RPC clears an Option's Components BEFORE changing its commercial_mode, so the existing mode-change trigger is never blocked by stale rows", () => {
  const body = PERSISTENCE_MIGRATION;
  const deleteIdx = body.indexOf("delete from public.opportunity_option_components where option_id = v_option_id;");
  const updateIdx = body.indexOf("update public.opportunity_options", deleteIdx);
  assert.ok(deleteIdx > -1 && updateIdx > deleteIdx, "components must be cleared before the option's own mode UPDATE");
});

test("Pass 2 / 24. the RPC removes Options the admin dropped (absent from p_options) and relies on the Pass 1 cascade FK for their Components — no second delete loop", () => {
  assert.match(PERSISTENCE_MIGRATION, /delete from public\.opportunity_options\s+where listing_id = p_listing_id\s+and id <> all \(v_incoming_ids\)/);
  assert.equal(/delete from public\.opportunity_option_components where option_id in/i.test(PERSISTENCE_MIGRATION), false, "removed Options' Components are cascade-deleted, not manually re-deleted");
});

test("Pass 2 / 25. the RPC inserts real rows through the real tables — every Pass 1 CHECK constraint and trigger still applies, no bypass/disable of RLS or triggers", () => {
  assert.equal(/disable trigger|alter table .* disable row level security|security definer.*bypassrls/i.test(PERSISTENCE_MIGRATION), false);
  assert.match(PERSISTENCE_MIGRATION, /insert into public\.opportunity_option_components/);
});

test("Pass 2 / 26. the persistence migration is purely additive — no ALTER/DROP on any existing table, trigger, or constraint", () => {
  assert.equal(/alter table public\.opportunity_(options|option_components|listings|recipients)/i.test(PERSISTENCE_MIGRATION), false);
  assert.equal(/drop (table|trigger|function|constraint)/i.test(PERSISTENCE_MIGRATION.replace(/create or replace function/gi, "")), false);
});

test("Pass 2 / 27. no reference to the real production Tabli listing anywhere in the new persistence migration", () => {
  assert.equal(/\btabli\b/i.test(PERSISTENCE_MIGRATION), false);
});

// ---------------------------------------------------------------- actions.ts: server wiring (static — "@/" aliases aren't live-importable)

test("Pass 2 / 28. createOpportunity parses+validates Commercial Terms BEFORE the listing insert — a bad Option never gets as far as creating a row", () => {
  const createFn = ACTIONS.match(/export async function createOpportunity[\s\S]*?\n}\n/)[0];
  const termsIdx = createFn.indexOf("readCommercialTerms(");
  const insertIdx = createFn.search(/\.insert\(/);
  assert.ok(termsIdx > -1 && insertIdx > termsIdx, "Commercial Terms must be parsed/validated before the insert");
});

test("Pass 2 / 28b. (review correction) saveOpportunity gates Commercial Terms parsing behind the listing's OWN current Option count — it never unconditionally parses/touches ct_* fields", () => {
  const saveFn = ACTIONS.match(/export async function saveOpportunity[\s\S]*?\n}\n/)[0];
  assert.match(saveFn, /const hasCommercialTerms = \(existingOptionRows\?\.length \?\? 0\) > 0;/);
  assert.match(saveFn, /if \(hasCommercialTerms\) \{\s*\n\s*options = readCommercialTerms\(base, formData\);/);
  // The unconditional parse the old (unsafe) version did is gone.
  const beforeBranch = saveFn.slice(0, saveFn.indexOf("if (hasCommercialTerms)"));
  assert.equal(beforeBranch.includes("readCommercialTerms("), false, "must not parse Commercial Terms before knowing whether this listing even has any");
});

test("Pass 2 / 29. legacy pricing_mode/price/currency are PROJECTED (safely) from the submitted Options when Commercial Terms exist, never read directly from the form", () => {
  assert.equal(/str\(formData, "pricing_mode"\)|str\(formData, "price"\)|str\(formData, "currency"\)/.test(ACTIONS), false);
  assert.match(ACTIONS, /projectSafeLegacyPricing\(options\)/);
  assert.match(ACTIONS, /pricing_mode: legacy\.pricing_mode/);
  // The renamed, now-removed unsafe function must not reappear.
  assert.equal(/\bderiveLegacyPricing\b/.test(ACTIONS), false);
});

test("Pass 2 / 29b. (review correction) an unconverted (legacy-unclassified) listing's existing legacy pricing_mode/price_cents/currency are read back from ITS OWN row and passed through unchanged — never derived, never guessed", () => {
  const saveFn = ACTIONS.match(/export async function saveOpportunity[\s\S]*?\n}\n/)[0];
  const elseBranch = saveFn.match(/\} else \{[\s\S]*?\n  \}/)[0];
  assert.match(elseBranch, /select\("pricing_mode, price_cents, currency"\)/);
  assert.match(elseBranch, /pricing_mode: current!\.pricing_mode/);
  assert.match(elseBranch, /price: current!\.price_cents != null \? centsToDollarString\(current!\.price_cents\) : null/);
  assert.match(elseBranch, /currency: current!\.currency/);
  assert.equal(/projectSafeLegacyPricing/.test(elseBranch), false, "no projection is computed for an unconverted listing — only its own existing value is reused");
});

test("Pass 2 / 29c. (review correction) an unrelated edit to an unconverted listing never calls the aggregate-write RPC — no Option row is created as a side effect of saving an unrelated field", () => {
  const saveFn = ACTIONS.match(/export async function saveOpportunity[\s\S]*?\n}\n/)[0];
  assert.match(saveFn, /if \(hasCommercialTerms && options\) \{\s*\n\s*const rpcError = await persistCommercialTerms/);
});

test("Pass 2 / 30. credits_eligible stays its own independent form field, untouched by the Commercial Terms model", () => {
  assert.match(ACTIONS, /credits_eligible: bool\(formData, "credits_eligible"\)/);
});

test("Pass 2 / 31. the aggregate write (Options + Components) goes through exactly one RPC call per save — replace_opportunity_options", () => {
  const matches = ACTIONS.match(/\.rpc\("replace_opportunity_options"/g) ?? [];
  assert.ok(matches.length >= 1);
  assert.equal(/\.rpc\("[a-z_]*option[a-z_]*"/gi.test(ACTIONS.replace(/replace_opportunity_options/g, "")), false, "no second, divergent RPC for the same concern");
});

test("Pass 2 / 32. createOpportunity never reports success for a listing with no Options when the aggregate write fails — it redirects to the real edit page with an error instead", () => {
  const createFn = ACTIONS.match(/export async function createOpportunity[\s\S]*?\n}\n/)[0];
  assert.match(createFn, /if \(rpcError\) \{/);
  assert.match(createFn, /\/edit\?error=/);
});

test("Pass 2 / 33. convertLegacyToCommercialTerms is requireAdmin-gated, refuses when the listing already has Options, and never guesses a Fixed/Starting-At amount's direction", () => {
  const fn = ACTIONS.match(/export async function convertLegacyToCommercialTerms[\s\S]*?\n}\n/)[0];
  assert.match(fn, /await requireAdmin\(\)/);
  assert.match(fn, /existingOptions.*length > 0/);
  assert.match(fn, /already has Commercial Terms/);
  assert.match(fn, /isMonetaryComponentType\(componentType\)/);
  assert.equal(/participation_fee['"]?\s*;?\s*\/\/\s*default/i.test(fn), false, "no hardcoded default direction");
});

test("Pass 2 / 34. convertLegacyToCommercialTerms is reachable ONLY from its own explicit action — not called from createOpportunity/saveOpportunity/setOpportunityStatus", () => {
  const otherFns = ["createOpportunity", "saveOpportunity", "setOpportunityStatus", "sendOpportunity", "setRecipientStatus", "saveRecipientNotes", "setListingVisibility"];
  for (const name of otherFns) {
    const fn = ACTIONS.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n}\\n`))[0];
    assert.equal(fn.includes("convertLegacyToCommercialTerms"), false, `${name} must never call convertLegacyToCommercialTerms itself`);
  }
});

test("Pass 2 / 35. Pro Access Requests, Stripe, Opportunity Credits payment logic and the Explore budget filter are untouched by this pass's actions.ts changes", () => {
  assert.equal(/stripe|pro_access_request|approve_pro_access_request/i.test(ACTIONS), false);
  assert.equal(/EXPLORE_BUDGET|matchesExploreFilters/i.test(ACTIONS), false);
});

test("Pass 2 / 35b. (review correction) convertLegacyToCommercialTerms never computes or writes a legacy pricing projection — it only ADDS the equivalent Option, leaving the listing's existing legacy columns exactly as they were", () => {
  const fn = ACTIONS.match(/export async function convertLegacyToCommercialTerms[\s\S]*?\n}\n/)[0];
  assert.equal(/projectSafeLegacyPricing/.test(fn), false);
  assert.equal(/\.from\("opportunity_listings"\)\.update\(/.test(fn), false, "no write to opportunity_listings at all during conversion");
});

test("Pass 2 / 35c. (review correction) a brand-new Opportunity (createOpportunity) always runs its Options through the renamed SAFE projection, never the old unsafe one", () => {
  const createFn = ACTIONS.match(/export async function createOpportunity[\s\S]*?\n}\n/)[0];
  assert.match(createFn, /projectSafeLegacyPricing\(options\)/);
});

// ---------------------------------------------------------------- OpportunityForm.tsx: Investment -> Commercial Terms

test("Pass 2 / 36. the old Pricing Mode dropdown/Amount inputs are gone — CommercialTermsBuilder replaces them, Credits Eligible is now independent", () => {
  assert.equal(/name="pricing_mode"|name="price"\s/.test(OPPORTUNITY_FORM), false);
  assert.match(OPPORTUNITY_FORM, /<CommercialTermsBuilder initialOptions=\{initialOptions\} onFirstOptionModeChange=\{setComplimentary\} \/>/);
  assert.match(OPPORTUNITY_FORM, /name="credits_eligible"/);
});

test("Pass 2 / 37. Credits Eligible is disabled exactly when the FIRST Option is Complimentary — same rule the old dropdown enforced, now driven by the builder's callback", () => {
  assert.match(OPPORTUNITY_FORM, /disabled=\{complimentary\}/);
  assert.match(OPPORTUNITY_FORM, /onFirstOptionModeChange/);
});

test("Pass 2 / 37b. (review correction) the builder is rendered ONLY when `legacyUnclassified` is false — an unconverted legacy listing's edit form shows a read-only notice instead, never the builder", () => {
  assert.match(OPPORTUNITY_FORM, /\{legacyUnclassified \? \(/);
  assert.match(OPPORTUNITY_FORM, /hasn&rsquo;t been set up with structured Commercial Terms yet/);
  assert.equal(/\blegacy\b/i.test(OPPORTUNITY_FORM.match(/>\s*This Opportunity[^<]*</)?.[0] ?? ""), false, "the read-only notice itself never uses the raw word 'legacy'");
});

test("Pass 2 / 37c. (review correction) the new/edit pages pass legacyUnclassified correctly: always false for a brand-new Opportunity, derived from the real Option count for an edit", () => {
  const NEW_PAGE = read("src/app/admin/(protected)/opportunities/new/page.tsx");
  const EDIT_PAGE = read("src/app/admin/(protected)/opportunities/[id]/edit/page.tsx");
  assert.match(NEW_PAGE, /legacyUnclassified=\{false\}/);
  assert.match(EDIT_PAGE, /legacyUnclassified=\{isLegacyUnclassified\(options\.length\)\}/);
});

// ---------------------------------------------------------------- CommercialTermsBuilder.tsx: UX behavior guards

test("Pass 2 / 38. the builder uses no drag-and-drop library — reorder is Move Up/Down only (an unrelated @dnd-kit dependency pre-exists elsewhere in the repo; this pass never imports it)", () => {
  assert.equal(/from\s+"@dnd-kit|react-beautiful-dnd|react-dnd(?!-)|sortablejs/i.test(BUILDER), false);
  assert.match(BUILDER, /Move Up/);
  assert.match(BUILDER, /Move Down/);
});

test("Pass 2 / 39. Duplicate/Remove Option exist; Remove is disabled at exactly one Option (never zero)", () => {
  assert.match(BUILDER, /Duplicate Option/);
  assert.match(BUILDER, /Remove Option/);
  assert.match(BUILDER, /disabled=\{total <= 1\}/);
  assert.match(BUILDER, /prev\.length <= 1 \? prev : prev\.filter/);
});

test("Pass 2 / 40. Duplicate clones every field with NEW client keys and a null id (a true copy, never the same persisted row)", () => {
  assert.match(BUILDER, /key: newKey\(\), id: null, components: prev\[idx\]\.components\.map\(\(c\) => \(\{ \.\.\.c, key: newKey\(\) \}\)\)/);
});

test("Pass 2 / 41. the +Add Term picker enforces monetary mutual exclusivity in the picker itself (disabled, not just re-validated later)", () => {
  assert.match(BUILDER, /disabled=\{usedMonetary != null\}/);
  assert.match(BUILDER, /An Option can only have one monetary term/);
});

test("Pass 2 / 42. adding a monetary term always REPLACES any existing one in state, defense-in-depth beyond the disabled picker button", () => {
  assert.match(BUILDER, /components: \[defaultMonetaryComponent\(type\), \.\.\.o\.components\.filter\(\(c\) => !isMonetaryComponentType\(c\.component_type\)\)\]/);
});

test("Pass 2 / 43. Complimentary's Add Term picker offers ONLY In-Kind — no monetary picker is ever rendered for a Complimentary Option", () => {
  assert.match(BUILDER, /option\.commercial_mode === "structured" &&\s*\n\s*MONETARY_COMPONENT_TYPES\.map/);
});

test("Pass 2 / 44. a newly-added In-Kind term on a Complimentary Option is always optional (in_kind_required forced false, never user-togglable there)", () => {
  assert.match(BUILDER, /defaultInKindComponent\(o\.commercial_mode !== "complimentary"\)/);
  assert.match(BUILDER, /optionMode === "complimentary" && <Hidden name=\{`\$\{prefix\}_in_kind_required`\} value=\{false\} \/>/);
});

test("Pass 2 / 45. switching an Option to Custom, or to Complimentary while it owns a monetary/required-In-Kind term, asks for confirmation before discarding data", () => {
  assert.match(BUILDER, /function wouldDiscard/);
  assert.match(BUILDER, /window\.confirm\(/);
  assert.match(BUILDER, /removes this Option's structured commercial terms/);
});

test("Pass 2 / 46. switching a Complimentary Option back to Structured, or any non-destructive switch, never calls confirm()", () => {
  const fn = BUILDER.match(/function wouldDiscard[\s\S]*?\n\}/)[0];
  assert.match(fn, /if \(next === option\.commercial_mode\) return false;/);
  assert.match(fn, /if \(option\.components\.length === 0\) return false;/);
});

test("Pass 2 / 47. Option naming (name/description inputs) only renders once a 2nd Option exists — no forced naming for the common single-Option case", () => {
  assert.match(BUILDER, /\{total > 1 && \(/);
  assert.match(BUILDER, /\{total === 1 && <Hidden name=\{`\$\{prefix\}_name`\} value=\{option\.name\} \/>\}/);
});

test("Pass 2 / 48. every interactive control has a visible text label — no icon-only destructive buttons", () => {
  assert.equal(/aria-label="(Remove|Delete|×|X)"/.test(BUILDER), false);
  assert.match(BUILDER, />\s*Remove Term\s*</);
  assert.match(BUILDER, />\s*Remove Option\s*</);
});

test("Pass 2 / 49. the builder's field names follow the documented flat ct_{i}/ct_{i}_c_{j} convention parseCommercialTermsForm expects — never a JSON blob", () => {
  assert.equal(/JSON\.stringify/.test(BUILDER), false);
  assert.match(BUILDER, /name="ct_count"/);
  assert.match(BUILDER, /`\$\{prefix\}_id`/);
  assert.match(BUILDER, /`\$\{prefix\}_comp_count`/);
});

// ---------------------------------------------------------------- Admin detail page: Commercial Terms display + legacy classification UX

test("Pass 2 / 50. the legacy classification banner never shows the raw word 'legacy' as admin-facing copy — only in code comments/identifiers", () => {
  const jsxStrings = [...DETAIL_PAGE.matchAll(/>\s*([^<{}\n]{10,400})\s*</g)].map((m) => m[1]);
  const visibleLegacyText = jsxStrings.filter((s) => /legacy/i.test(s));
  assert.deepEqual(visibleLegacyText, [], "no rendered JSX text node may contain the word 'legacy'");
});

test("Pass 2 / 51. the legacy banner requires an explicit admin choice of direction for a Fixed/Starting-At amount — never defaults the <select>", () => {
  assert.match(DETAIL_PAGE, /defaultValue="" required/);
  assert.match(DETAIL_PAGE, /This amount represents/);
});

test("Pass 2 / 52. converting a Complimentary/Custom legacy listing needs no extra input (no ambiguity to resolve)", () => {
  const fn = DETAIL_PAGE.match(/function CommercialTermsSection[\s\S]*?\n\}/)[0];
  assert.match(fn, /needsDirection = listing\.pricing_mode === "fixed" \|\| listing\.pricing_mode === "starting_at"/);
});

test("Pass 2 / 53. the Commercial Terms admin section never imports from or edits src/components/opportunities/OpportunityPresentation.tsx", () => {
  assert.equal(DETAIL_PAGE.includes("OpportunityPresentation"), true, "the existing shared import must still be present, untouched");
  const presentation = read("src/components/opportunities/OpportunityPresentation.tsx");
  assert.equal(/opportunity_option|commercial_mode|CommercialTerms/i.test(presentation), false, "the shared business-facing-adjacent component was never touched");
});

// ---------------------------------------------------------------- business-facing / Explore / Goals / Pro / Stripe / option_id — reconfirmed untouched after Pass 2

test("Pass 2 / 54. Explore's budget filter (matchesExploreFilters) is byte-for-byte unaffected — still reads only legacy pricing_mode/price_cents", () => {
  const fn = LISTINGS_DOMAIN.match(/export function matchesExploreFilters[\s\S]*?\n\}/)[0];
  assert.equal(/opportunity_option/i.test(fn), false);
  assert.match(fn, /listing\.pricing_mode/);
});

test("Pass 2 / 55. Goals (src/lib/opportunity-goals-domain.ts) still has zero awareness of Options/Components after Pass 2", () => {
  assert.equal(/opportunity_option|commercial_mode/i.test(GOALS_DOMAIN), false);
});

test("Pass 2 / 56. no file touched in this pass references Stripe, Pro Access Requests, or Opportunity Credits payment logic", () => {
  for (const mod of [BUILDER, OPPORTUNITY_FORM, DETAIL_PAGE]) {
    assert.equal(/stripe|pro_access_request|redeem_pro_invite/i.test(mod), false);
  }
});

test("Pass 2 / 56b. Business-facing components/routes themselves remain byte-level untouched by this correction pass: BusinessOpportunityCard, the Business recipient detail route, BusinessHome, and OpportunitiesView (For You/Explore) have no awareness of Options/Components/the new builder", () => {
  const businessFiles = [
    "src/components/opportunities/BusinessOpportunityCard.tsx",
    "src/app/(public)/account/business/[id]/opportunities/[recipientId]/page.tsx",
    "src/app/(public)/account/business/[id]/v2/BusinessHome.tsx",
    "src/app/(public)/account/business/[id]/v2/OpportunitiesView.tsx",
  ];
  for (const path of businessFiles) {
    const content = read(path);
    assert.equal(/opportunity_option|CommercialTermsBuilder|projectSafeLegacyPricing|commercial_mode/i.test(content), false, `${path} must remain unaware of the new model`);
  }
});

test("Pass 2 / 57. opportunity_recipients.option_id is still not added anywhere in Pass 2's own new migration (the deferral is only explained in a comment, never acted on in real SQL; the pre-existing opportunity_option_components.option_id FK from Pass 1 is unrelated and expected to appear throughout this RPC)", () => {
  assert.equal(/opportunity_recipients/i.test(strip(PERSISTENCE_MIGRATION)), false, "no real SQL statement touches opportunity_recipients");
  assert.equal(/alter table public\.opportunity_recipients/i.test(PERSISTENCE_MIGRATION), false);
});

test("Pass 2 / 58. no NEW classification/persistence logic references the real production Tabli listing by name (OpportunityForm.tsx's pre-existing, unrelated 'e.g. Tabli...' placeholder text predates this pass and isn't a classification concern)", () => {
  for (const mod of [FORM_MODULE, ACTIONS, BUILDER, DETAIL_PAGE]) {
    assert.equal(/\btabli\b/i.test(mod), false);
  }
});

// ============================================================================
// Unit-Based Commercial Value Model (Pass 2.5)
// ============================================================================

// ---------------------------------------------------------------- shared quantity/unit validation (live)

const monetaryFee = (over = {}) => ({ component_type: "participation_fee", amount_mode: "fixed", amount_min_cents: 150000, currency: "USD", ...over });
const inKindNoValue = (over = {}) => ({ component_type: "in_kind", in_kind_category: "product_samples", in_kind_provider: "recipient_business", ...over });

test("2.5 / 1. In-Kind: quantity+unit with NO valuation at all is valid ('200 samples', no estimated_value_cents, no unit_value_cents)", () => {
  const r = validateComponent(inKindNoValue({ quantity: 200, unit: "samples" }));
  assert.equal(r.ok, true);
  assert.equal(r.value.quantity, 200);
  assert.equal(r.value.unit, "samples");
  assert.equal(r.value.estimated_value_cents, null);
  assert.equal(r.value.unit_value_cents, null);
});

test("2.5 / 2. In-Kind: a DIRECT total is valid with NO quantity/unit ('Venue Space, $2,500')", () => {
  const r = validateComponent(inKindNoValue({ in_kind_category: "space_venue", estimated_value_cents: 250000 }));
  assert.equal(r.ok, true);
  assert.equal(r.value.quantity, null);
  assert.equal(r.value.unit, null);
  assert.equal(r.value.estimated_value_cents, 250000);
  assert.equal(r.value.unit_value_cents, null);
});

test("2.5 / 3. In-Kind: a DIRECT total is ALSO valid WITH quantity/unit present ('200 samples, Estimated Total $400')", () => {
  const r = validateComponent(inKindNoValue({ quantity: 200, unit: "samples", estimated_value_cents: 40000 }));
  assert.equal(r.ok, true);
  assert.equal(r.value.quantity, 200);
  assert.equal(r.value.estimated_value_cents, 40000);
  assert.equal(r.value.unit_value_cents, null);
});

test("2.5 / 4. In-Kind: a PER-UNIT rate is valid with quantity+unit ('200 samples, $2/sample')", () => {
  const r = validateComponent(inKindNoValue({ quantity: 200, unit: "samples", unit_value_cents: 200 }));
  assert.equal(r.ok, true);
  assert.equal(r.value.quantity, 200);
  assert.equal(r.value.unit_value_cents, 200);
  assert.equal(r.value.estimated_value_cents, null);
});

test("2.5 / 5. In-Kind: estimated_value_cents AND unit_value_cents together is REJECTED (mutual exclusion)", () => {
  const r = validateComponent(inKindNoValue({ quantity: 200, unit: "samples", estimated_value_cents: 40000, unit_value_cents: 200 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /either an estimated total or a value per unit, not both/);
});

test("2.5 / 6. In-Kind: unit_value_cents without quantity/unit is REJECTED", () => {
  const r = validateComponent(inKindNoValue({ unit_value_cents: 200 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /needs a quantity and a unit/);
});

test("2.5 / 7. quantity without unit, or unit without quantity, is REJECTED (both-or-neither) -- true for both monetary and In-Kind", () => {
  assert.equal(validateComponent(inKindNoValue({ quantity: 200 })).ok, false);
  assert.equal(validateComponent(inKindNoValue({ unit: "samples" })).ok, false);
  assert.equal(validateComponent(monetaryFee({ quantity: 3 })).ok, false);
  assert.equal(validateComponent(monetaryFee({ unit: "appearances" })).ok, false);
});

test("2.5 / 8. unit = 'custom' without custom_unit_label is REJECTED; with a label it's valid", () => {
  const missing = validateComponent(inKindNoValue({ quantity: 4, unit: "custom" }));
  assert.equal(missing.ok, false);
  const withLabel = validateComponent(inKindNoValue({ quantity: 4, unit: "custom", custom_unit_label: "Road Trips" }));
  assert.equal(withLabel.ok, true);
  assert.equal(withLabel.value.custom_unit_label, "Road Trips");
});

test("2.5 / 9. an unrecognized unit string is REJECTED (closed vocabulary + custom escape only)", () => {
  const r = validateComponent(inKindNoValue({ quantity: 4, unit: "widgets" }));
  assert.equal(r.ok, false);
});

test("2.5 / 10. quantity <= 0 is REJECTED; decimals are accepted (2.5 hours is real)", () => {
  assert.equal(validateComponent(inKindNoValue({ quantity: 0, unit: "hours" })).ok, false);
  assert.equal(validateComponent(inKindNoValue({ quantity: -3, unit: "hours" })).ok, false);
  const decimal = validateComponent(inKindNoValue({ quantity: 2.5, unit: "hours" }));
  assert.equal(decimal.ok, true);
  assert.equal(decimal.value.quantity, 2.5);
});

// ---------------------------------------------------------------- monetary components: descriptive quantity only

test("2.5 / 11. monetary: quantity+unit are accepted as purely DESCRIPTIVE metadata; amount_min_cents is untouched", () => {
  const r = validateComponent(monetaryFee({ component_type: "compensation", amount_min_cents: 150000, quantity: 3, unit: "appearances" }));
  assert.equal(r.ok, true);
  assert.equal(r.value.amount_min_cents, 150000, "the authoritative amount is never derived from quantity");
  assert.equal(r.value.quantity, 3);
  assert.equal(r.value.unit, "appearances");
});

test("2.5 / 12. monetary: unit_value_cents is REJECTED outright ('a value per unit doesn't apply here')", () => {
  const r = validateComponent(monetaryFee({ quantity: 3, unit: "appearances", unit_value_cents: 50000 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /value per unit doesn't apply here/);
});

test("2.5 / 13. monetary: estimated_value_cents is REJECTED outright", () => {
  const r = validateComponent(monetaryFee({ estimated_value_cents: 50000 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /estimated value doesn't apply here/);
});

test("2.5 / 14. monetary: quantity/unit are valid with Range and Undisclosed too (purely descriptive, no rate implied)", () => {
  const range = validateComponent({ component_type: "compensation", amount_mode: "range", amount_min_cents: 100000, amount_max_cents: 200000, currency: "USD", quantity: 3, unit: "appearances" });
  assert.equal(range.ok, true);
  const undisclosed = validateComponent({ component_type: "participation_fee", amount_mode: "undisclosed", currency: "USD", quantity: 4, unit: "days" });
  assert.equal(undisclosed.ok, true);
});

// ---------------------------------------------------------------- calculation (live, deterministic rounding)

test("2.5 / 15. calculateUnitValueCents: the exact fractional-quantity example from the spec (2.5 x 3333 -> 8333, half-up, no float drift)", () => {
  assert.equal(calculateUnitValueCents(2.5, 3333), 8333);
});

test("2.5 / 16. calculateUnitValueCents: 200 samples x $2 = $400", () => {
  assert.equal(calculateUnitValueCents(200, 200), 40000);
});

test("2.5 / 17. calculateUnitValueCents: 6 staffing hours x $50 = $300", () => {
  assert.equal(calculateUnitValueCents(6, 5000), 30000);
});

test("2.5 / 18. calculateUnitValueCents: 3 videos x $250 = $750", () => {
  assert.equal(calculateUnitValueCents(3, 25000), 75000);
});

test("2.5 / 19. calculateUnitValueCents: repeated fractional cases never drift off the true integer-cent value", () => {
  // 0.1 + 0.2 !== 0.3 in naive floating point -- these are the classic
  // trouble cases, confirming the integer-hundredths scaling trick holds.
  assert.equal(calculateUnitValueCents(0.1, 1000), 100);
  assert.equal(calculateUnitValueCents(1.1, 999), 1099);
  assert.equal(calculateUnitValueCents(0.3, 100), 30);
});

test("2.5 / 20. calculateInKindEstimatedValueCents: per-unit wins when set; falls back to the direct total; null when neither", () => {
  assert.equal(calculateInKindEstimatedValueCents({ quantity: 200, unit_value_cents: 200, estimated_value_cents: null }), 40000);
  assert.equal(calculateInKindEstimatedValueCents({ quantity: null, unit_value_cents: null, estimated_value_cents: 250000 }), 250000);
  assert.equal(calculateInKindEstimatedValueCents({ quantity: null, unit_value_cents: null, estimated_value_cents: null }), null);
});

// ---------------------------------------------------------------- monetary per-unit DISPLAY (never stored)

test("2.5 / 21. formatMonetaryPerUnitEquivalent: Fixed + quantity -> a real equivalent string ($1,500 compensation / 3 appearances)", () => {
  const s = formatMonetaryPerUnitEquivalent({ amount_mode: "fixed", amount_min_cents: 150000, currency: "USD", quantity: 3, unit: "appearances", custom_unit_label: null });
  assert.match(s, /\$500/);
  assert.match(s, /appearance/);
});

test("2.5 / 22. formatMonetaryPerUnitEquivalent: Starting At + quantity also computes an equivalent", () => {
  const s = formatMonetaryPerUnitEquivalent({ amount_mode: "starting_at", amount_min_cents: 300000, currency: "USD", quantity: 4, unit: "days", custom_unit_label: null });
  assert.match(s, /\$750/);
  assert.match(s, /day/);
});

test("2.5 / 23. formatMonetaryPerUnitEquivalent: Range NEVER gets a fabricated rate ('$1,000-$2,000 / 3 appearances' stays just the range)", () => {
  const s = formatMonetaryPerUnitEquivalent({ amount_mode: "range", amount_min_cents: 100000, currency: "USD", quantity: 3, unit: "appearances", custom_unit_label: null });
  assert.equal(s, null);
});

test("2.5 / 24. formatMonetaryPerUnitEquivalent: Undisclosed never gets a rate; no quantity/unit never gets a rate", () => {
  assert.equal(formatMonetaryPerUnitEquivalent({ amount_mode: "undisclosed", amount_min_cents: null, currency: "USD", quantity: 3, unit: "appearances", custom_unit_label: null }), null);
  assert.equal(formatMonetaryPerUnitEquivalent({ amount_mode: "fixed", amount_min_cents: 150000, currency: "USD", quantity: null, unit: null, custom_unit_label: null }), null);
});

// ---------------------------------------------------------------- Option-level Estimated In-Kind Value (never includes cash)

test("2.5 / 25. summarizeOptionEstimatedInKindValue: sums valued In-Kind contributions, flags unvalued ones, EXCLUDES any monetary component", () => {
  const components = [
    validateComponent(monetaryFee()).value, // $1,500 -- must never be summed in
    validateComponent(inKindNoValue({ quantity: 200, unit: "samples", unit_value_cents: 200 })).value, // $400
    validateComponent(inKindNoValue({ in_kind_category: "staffing", quantity: 6, unit: "hours", unit_value_cents: 5000 })).value, // $300
    validateComponent(inKindNoValue({ in_kind_category: "promotion" })).value, // unvalued
  ];
  const { totalCents, hasUnvalued } = summarizeOptionEstimatedInKindValue(components);
  assert.equal(totalCents, 70000, "$400 + $300 -- never the $1,500 Participation Fee");
  assert.equal(hasUnvalued, true);
});

test("2.5 / 26. summarizeOptionEstimatedInKindValue: zero In-Kind components -> totalCents null (never 0), hasUnvalued false", () => {
  const { totalCents, hasUnvalued } = summarizeOptionEstimatedInKindValue([validateComponent(monetaryFee()).value]);
  assert.equal(totalCents, null);
  assert.equal(hasUnvalued, false);
});

// ---------------------------------------------------------------- formatting backward-compatibility

test("2.5 / 27. formatComponentSummary: an In-Kind Component with no quantity/unit/value is byte-identical to the Pass 1 format", () => {
  const c = validateComponent(inKindNoValue()).value;
  assert.equal(formatComponentSummary(c), "In-Kind — Product / Samples");
});

test("2.5 / 28. formatComponentSummary: quantity/unit and a calculated value are appended when present", () => {
  const c = validateComponent(inKindNoValue({ quantity: 200, unit: "samples", unit_value_cents: 200 })).value;
  const s = formatComponentSummary(c);
  assert.match(s, /200 Samples/);
  assert.match(s, /\$400/);
});

test("2.5 / 29. formatQuantityUnit: standard unit uses its label; custom unit uses custom_unit_label; null when absent", () => {
  assert.equal(formatQuantityUnit({ quantity: 200, unit: "samples", custom_unit_label: null }), "200 Samples");
  assert.equal(formatQuantityUnit({ quantity: 4, unit: "custom", custom_unit_label: "Road Trips" }), "4 Road Trips");
  assert.equal(formatQuantityUnit({ quantity: null, unit: null, custom_unit_label: null }), null);
});

// ---------------------------------------------------------------- Complimentary interaction (unchanged by valuation)

test("2.5 / 30. Complimentary + optional In-Kind may use ANY valuation mode (No Value / Estimated Total / Value Per Unit)", () => {
  for (const extra of [{}, { estimated_value_cents: 25000 }, { quantity: 100, unit: "samples", unit_value_cents: 150 }]) {
    const r = validateOption({ commercial_mode: "complimentary", components: [inKindNoValue({ in_kind_required: false, ...extra })] });
    assert.equal(r.ok, true, JSON.stringify(extra));
  }
});

test("2.5 / 31. Complimentary + REQUIRED In-Kind is still rejected regardless of valuation (unaffected by this pass)", () => {
  const r = validateOption({ commercial_mode: "complimentary", components: [inKindNoValue({ in_kind_required: true, quantity: 100, unit: "samples", unit_value_cents: 150 })] });
  assert.equal(r.ok, false);
  assert.match(r.error, /can't require an In-Kind contribution/);
});

// ---------------------------------------------------------------- the 5 example cases from the spec, end to end

test("2.5 / 32. '3 appearances x $500 compensation' -> Compensation, Fixed, $1,500 total, quantity=3/unit=appearances, no unit_value", () => {
  const r = validateComponent({ component_type: "compensation", amount_mode: "fixed", amount_min_cents: 150000, currency: "USD", quantity: 3, unit: "appearances" });
  assert.equal(r.ok, true);
  assert.deepEqual(
    { amount_min_cents: r.value.amount_min_cents, quantity: r.value.quantity, unit: r.value.unit, unit_value_cents: r.value.unit_value_cents },
    { amount_min_cents: 150000, quantity: 3, unit: "appearances", unit_value_cents: null }
  );
});

test("2.5 / 33. '4 activation days x $750 participation fee' -> Participation Fee, Fixed, $3,000 total, quantity=4/unit=days", () => {
  const r = validateComponent({ component_type: "participation_fee", amount_mode: "fixed", amount_min_cents: 300000, currency: "USD", quantity: 4, unit: "days" });
  assert.equal(r.ok, true);
  assert.equal(r.value.amount_min_cents, 300000);
  assert.equal(formatMonetaryPerUnitEquivalent(r.value).includes("750"), true);
});

test("2.5 / 34. '200 samples x $2' -> In-Kind, Value Per Unit, calculated $400", () => {
  const r = validateComponent(inKindNoValue({ quantity: 200, unit: "samples", unit_value_cents: 200 }));
  assert.equal(r.ok, true);
  assert.equal(calculateInKindEstimatedValueCents(r.value), 40000);
});

test("2.5 / 35. '6 staffing hours x $50' -> In-Kind, Value Per Unit, calculated $300", () => {
  const r = validateComponent(inKindNoValue({ in_kind_category: "staffing", quantity: 6, unit: "hours", unit_value_cents: 5000 }));
  assert.equal(r.ok, true);
  assert.equal(calculateInKindEstimatedValueCents(r.value), 30000);
});

test("2.5 / 36. '3 videos x $250, provided by Findmi' -> In-Kind, content_media, provider=findmi, Value Per Unit, calculated $750", () => {
  const r = validateComponent(inKindNoValue({ in_kind_category: "content_media", in_kind_provider: "findmi", quantity: 3, unit: "videos", unit_value_cents: 25000 }));
  assert.equal(r.ok, true);
  assert.equal(r.value.in_kind_provider, "findmi");
  assert.equal(calculateInKindEstimatedValueCents(r.value), 75000);
});

// ---------------------------------------------------------------- "No silent override" / no divergent derivation

test("2.5 / 37. validateComponent never derives amount_min_cents from quantity * unit_value_cents anywhere (grep-style source guard)", () => {
  assert.equal(/amount_min_cents\s*=.*quantity/.test(DOMAIN), false, "the authoritative cash amount is never computed from quantity in source");
});

test("2.5 / 38. the calculated In-Kind total is never assigned back into estimated_value_cents/unit_value_cents anywhere in the domain module (never materialized)", () => {
  const fn = DOMAIN.match(/export function calculateInKindEstimatedValueCents[\s\S]*?\n\}/)[0];
  assert.equal(/estimated_value_cents\s*=/.test(fn), false);
  assert.equal(/unit_value_cents\s*=/.test(fn), false);
});

// ---------------------------------------------------------------- migration structural guards (static)

test("2.5 / 39. the new migration is purely additive to opportunity_option_components -- adds exactly the four new columns, keeps estimated_value_cents", () => {
  assert.match(UNIT_VALUE_MIGRATION, /add column quantity numeric\(10, 2\)/);
  assert.match(UNIT_VALUE_MIGRATION, /add column unit text/);
  assert.match(UNIT_VALUE_MIGRATION, /add column custom_unit_label text/);
  assert.match(UNIT_VALUE_MIGRATION, /add column unit_value_cents integer/);
  assert.equal(/drop column estimated_value_cents/i.test(UNIT_VALUE_MIGRATION), false, "estimated_value_cents is explicitly KEPT, not dropped");
});

test("2.5 / 40. the unit vocabulary CHECK constraint matches CONTRIBUTION_UNITS exactly (drift guard)", () => {
  const m = UNIT_VALUE_MIGRATION.match(/constraint opportunity_option_components_unit_vocabulary_check[\s\S]*?check \(\s*unit is null or unit in \(([\s\S]*?)\)\s*\)/);
  assert.ok(m, "unit vocabulary constraint not found");
  const dbUnits = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  assert.deepEqual(dbUnits, [...CONTRIBUTION_UNITS]);
});

test("2.5 / 41. quantity/unit both-or-neither, quantity > 0, custom-label-required, and unit_value_cents-requires-quantity-and-unit are all real CHECK constraints", () => {
  assert.match(UNIT_VALUE_MIGRATION, /constraint opportunity_option_components_quantity_unit_check\s+check \(\(quantity is null\) = \(unit is null\)\)/);
  assert.match(UNIT_VALUE_MIGRATION, /constraint opportunity_option_components_quantity_positive_check\s+check \(quantity is null or quantity > 0\)/);
  assert.match(UNIT_VALUE_MIGRATION, /constraint opportunity_option_components_custom_unit_label_check\s+check \(unit <> 'custom' or custom_unit_label is not null\)/);
  assert.match(UNIT_VALUE_MIGRATION, /constraint opportunity_option_components_unit_value_requires_unit_check\s+check \(unit_value_cents is null or \(quantity is not null and unit is not null\)\)/);
});

test("2.5 / 42. the valuation mutual-exclusion invariant is a real DB CHECK constraint (not just a TypeScript-layer rule)", () => {
  assert.match(
    UNIT_VALUE_MIGRATION,
    /constraint opportunity_option_components_valuation_exclusive_check\s+check \(not \(estimated_value_cents is not null and unit_value_cents is not null\)\)/
  );
});

test("2.5 / 43. the revised shape_check still prohibits BOTH valuation fields on monetary components, and still requires every in_kind field on In-Kind -- same named constraint, dropped and re-added, never the Pass 1 migration file edited", () => {
  assert.match(UNIT_VALUE_MIGRATION, /drop constraint opportunity_option_components_shape_check/);
  assert.match(UNIT_VALUE_MIGRATION, /add constraint\s+opportunity_option_components_shape_check/);
  const revised = UNIT_VALUE_MIGRATION.match(/add constraint\s+opportunity_option_components_shape_check[\s\S]*?\);/)[0];
  assert.match(revised, /and estimated_value_cents is null\s*\n\s*and unit_value_cents is null/);
  assert.equal(/alter table public\.opportunity_option_components\b[\s\S]{0,40}drop column/i.test(strip(MIGRATION)), false, "the Pass 1 migration file itself is never edited by this pass");
});

test("2.5 / 44. the RPC (replace_opportunity_options) is CREATE OR REPLACEd with the four new columns added to the per-Component INSERT -- same function name, same hardening", () => {
  assert.match(UNIT_VALUE_MIGRATION, /create or replace function public\.replace_opportunity_options/);
  assert.match(UNIT_VALUE_MIGRATION, /security definer/);
  assert.match(UNIT_VALUE_MIGRATION, /set search_path = ''/);
  assert.match(UNIT_VALUE_MIGRATION, /raise exception 'foreign_option_id'/);
  assert.match(UNIT_VALUE_MIGRATION, /quantity, unit, custom_unit_label, unit_value_cents, display_order/);
  assert.match(UNIT_VALUE_MIGRATION, /nullif\(v_component->>'quantity', ''\)::numeric\(10, 2\)/);
  assert.match(UNIT_VALUE_MIGRATION, /grant execute on function public\.replace_opportunity_options\(uuid, jsonb\) to service_role/);
});

test("2.5 / 45. no reference to the real production Tabli listing in the new migration", () => {
  assert.equal(/\btabli\b/i.test(UNIT_VALUE_MIGRATION), false);
});

// ---------------------------------------------------------------- form.ts static guards

test("2.5 / 46. parseCommercialTermsForm reads quantity/unit/custom_unit_label/unit_value through the same typed parsers -- no divergent logic", () => {
  assert.match(FORM_MODULE, /`\$\{prefix\}_quantity`/);
  assert.match(FORM_MODULE, /`\$\{prefix\}_unit`/);
  assert.match(FORM_MODULE, /`\$\{prefix\}_custom_unit_label`/);
  assert.match(FORM_MODULE, /`\$\{prefix\}_unit_value`/);
  assert.equal(/quantity\s*\*\s*unit_value|unit_value.*\*.*quantity/.test(FORM_MODULE), false, "no calculation logic lives in the parser -- that's the domain module's job");
});

// ---------------------------------------------------------------- builder static guards

test("2.5 / 47. the builder renders Quantity+Unit for BOTH monetary and In-Kind terms", () => {
  assert.match(BUILDER, /Quantity \(optional\)/);
  const matches = BUILDER.match(/name=\{`\$\{prefix\}_quantity`\}/g) ?? [];
  assert.ok(matches.length >= 2, "quantity field must appear in both the monetary and the In-Kind branch");
});

test("2.5 / 48. the builder NEVER renders an editable unit_value input for a monetary term (quantity/unit stay purely descriptive there)", () => {
  const monetaryBranch = BUILDER.slice(BUILDER.indexOf("monetary ? ("), BUILDER.indexOf(") : ("));
  assert.equal(/name=\{`\$\{prefix\}_unit_value`\}/.test(monetaryBranch), false);
});

test("2.5 / 49. the builder's In-Kind Valuation control offers exactly the three approved modes and is mutually exclusive by construction (switching clears the other field)", () => {
  assert.match(BUILDER, /No Value/);
  assert.match(BUILDER, /Estimated Total/);
  assert.match(BUILDER, /Value Per Unit/);
  assert.match(BUILDER, /valuationModeOf/);
  assert.match(BUILDER, /estimated_value: "", unit_value: ""/);
});

test("2.5 / 50. the equivalent-per-unit and calculated-estimated-value previews are explicitly labeled as display-only / not stored", () => {
  assert.match(BUILDER, /for display only — not stored/);
});

// ---------------------------------------------------------------- Admin detail page guards

test("2.5 / 51. the Admin detail page shows the Option-level Estimated In-Kind Value and the monetary per-unit equivalent, both imported from the domain module (no reimplementation)", () => {
  assert.match(DETAIL_PAGE, /import\s*\{[^}]*\bformatMonetaryPerUnitEquivalent\b[^}]*\}\s*from\s*"@\/lib\/opportunity-commercial-terms-domain"/s);
  assert.match(DETAIL_PAGE, /import\s*\{[^}]*\bsummarizeOptionEstimatedInKindValue\b[^}]*\}\s*from\s*"@\/lib\/opportunity-commercial-terms-domain"/s);
  assert.match(DETAIL_PAGE, /Estimated In-Kind Value/);
});

// ---------------------------------------------------------------- business-facing / scope guards, reconfirmed after Pass 2.5

test("2.5 / 52. Business-facing files remain untouched by Pass 2.5's unit-value additions", () => {
  const businessFiles = [
    "src/components/opportunities/BusinessOpportunityCard.tsx",
    "src/components/opportunities/OpportunityPresentation.tsx",
    "src/app/(public)/account/business/[id]/opportunities/[recipientId]/page.tsx",
    "src/app/(public)/account/business/[id]/v2/BusinessHome.tsx",
    "src/app/(public)/account/business/[id]/v2/OpportunitiesView.tsx",
  ];
  for (const path of businessFiles) {
    assert.equal(/unit_value_cents|CONTRIBUTION_UNITS|calculateUnitValueCents/i.test(read(path)), false, `${path} must remain unaware of the unit-value model`);
  }
});

test("2.5 / 53. opportunity_recipients.option_id, Explore, Goals, Pro, Stripe remain untouched by this pass's new files (the pre-existing opportunity_option_components.option_id FK is unrelated and expected to appear throughout the copied RPC body)", () => {
  assert.equal(/opportunity_recipients/i.test(strip(UNIT_VALUE_MIGRATION)), false, "no real SQL statement touches opportunity_recipients");
  for (const mod of [UNIT_VALUE_MIGRATION, FORM_MODULE]) {
    assert.equal(/EXPLORE_BUDGET|stripe|pro_access_request/i.test(mod), false);
  }
  assert.equal(/opportunity_option|commercial_mode/i.test(GOALS_DOMAIN), false);
});
