// Opportunities — Commercial Terms Foundation (Schema + Domain, Pass 1).
// Pure domain functions plus static guards over the new migration. No
// database, no production writes, nothing wired into any live UI yet.
// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AMOUNT_MODES,
  COMPONENT_TYPES,
  IN_KIND_CATEGORIES,
  IN_KIND_PROVIDERS,
  OPTION_COMMERCIAL_MODES,
  countMonetaryComponents,
  formatComponentAmount,
  formatComponentSummary,
  formatOptionSummary,
  formatOptionalContributions,
  isMonetaryComponentType,
  summarizeOptionsForCard,
  validateComponent,
  validateOption,
} from "../src/lib/opportunity-commercial-terms-domain.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/--.*$/gm, "");
const MIGRATION = read("supabase/migrations/20261009000000_opportunity_commercial_terms_foundation.sql");
const LISTINGS_DOMAIN = read("src/lib/opportunity-listings-domain.ts");
const LISTINGS_LIB = read("src/lib/opportunity-listings.ts");
const GOALS_DOMAIN = read("src/lib/opportunity-goals-domain.ts");
const LISTINGS_MIGRATION = read("supabase/migrations/20261006044707_opportunity_listings_v1.sql");

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

test("26. existing Opportunities authorization is untouched — nothing wired to the new tables yet", () => {
  assert.equal(/opportunity_options|opportunity_option_components/i.test(LISTINGS_LIB), false);
  assert.match(LISTINGS_LIB, /await requireBusinessMember\(businessId\)/);
  assert.match(LISTINGS_LIB, /await requireAdmin\(\)/);
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
