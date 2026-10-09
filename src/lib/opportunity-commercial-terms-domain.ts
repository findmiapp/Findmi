// Opportunities — Commercial Terms Foundation (Schema + Domain, Pass 1): the
// canonical, dependency-free rules for the new structured Opportunity ->
// Option -> Component model (public.opportunity_options /
// public.opportunity_option_components).
//
// NOT YET WIRED to any Admin authoring UI, Business presentation, or
// Server Action — this module exists so the shape/validation/formatting
// rules can be built and tested in isolation before anything reads or
// writes these tables. The EXISTING legacy pricing path
// (opportunity_listings.pricing_mode/price_cents/currency/credits_eligible,
// src/lib/opportunity-listings-domain.ts) is completely untouched and
// keeps rendering every existing Opportunity exactly as it does today.
//
// No imports on purpose: safe for server and client code, and testable
// directly (tests/opportunity-commercial-terms.test.mjs). Every value list
// mirrors a CHECK constraint in
// supabase/migrations/20261009000000_opportunity_commercial_terms_foundation.sql
// — change both together.

const isOneOf =
  <T extends string>(list: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (list as readonly string[]).includes(value);

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

// ---------------------------------------------------------------- option commercial mode

/** STRUCTURED = at least one monetary component (participation_fee /
 * compensation / project_budget) OR at least one REQUIRED in_kind
 * component. COMPLIMENTARY = Admin deliberately chose no required
 * commercial consideration — zero monetary components, zero REQUIRED
 * in_kind components, but zero OR MORE OPTIONAL in_kind components ARE
 * allowed: "Complimentary participation + optional product support" is a
 * real, distinct, meaningful state, not the same as having no components
 * at all. CUSTOM = zero components of any kind, an optional free-text
 * note instead. Row count alone never implies a mode in either direction —
 * validateOption keeps the stored mode a true classification of the
 * actual component content, not just an independent label. */
export const OPTION_COMMERCIAL_MODES = ["structured", "complimentary", "custom"] as const;
export type OptionCommercialMode = (typeof OPTION_COMMERCIAL_MODES)[number];
export const isOptionCommercialMode = isOneOf(OPTION_COMMERCIAL_MODES);

export const OPTION_COMMERCIAL_MODE_LABELS: Record<OptionCommercialMode, string> = {
  structured: "Structured",
  complimentary: "Complimentary",
  custom: "Custom Terms",
};

// ---------------------------------------------------------------- component type

/** Sponsorship is deliberately NOT a component type — it stays purely
 * opportunity_type="sponsorship" on the listing; its actual commercial
 * component is participation_fee (a brand paying a sponsorship fee is, in
 * cash-flow terms, identical to any other participation fee). Storing it
 * twice would duplicate semantics the type already carries. */
export const COMPONENT_TYPES = ["participation_fee", "compensation", "project_budget", "in_kind"] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];
export const isComponentType = isOneOf(COMPONENT_TYPES);

export const MONETARY_COMPONENT_TYPES = ["participation_fee", "compensation", "project_budget"] as const;
export type MonetaryComponentType = (typeof MONETARY_COMPONENT_TYPES)[number];
export function isMonetaryComponentType(type: unknown): type is MonetaryComponentType {
  return type === "participation_fee" || type === "compensation" || type === "project_budget";
}

export const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
  participation_fee: "Participation Fee",
  compensation: "Compensation",
  project_budget: "Project Budget",
  in_kind: "In-Kind",
};

// ---------------------------------------------------------------- amount mode

/** FIXED = one exact amount. STARTING_AT = a minimum/base amount, no upper
 * bound represented. RANGE = an explicit minimum AND maximum (e.g. a
 * $5,000–$10,000 project budget) — never collapsed into STARTING_AT,
 * which would silently discard the ceiling. UNDISCLOSED = the commercial
 * direction is known (e.g. "this is Compensation"), the number just isn't
 * published yet — never called "custom": Custom is reserved for the
 * Option-level state meaning the whole arrangement's SHAPE isn't known. */
export const AMOUNT_MODES = ["fixed", "starting_at", "range", "undisclosed"] as const;
export type AmountMode = (typeof AMOUNT_MODES)[number];
export const isAmountMode = isOneOf(AMOUNT_MODES);

export const AMOUNT_MODE_LABELS: Record<AmountMode, string> = {
  fixed: "Fixed",
  starting_at: "Starting At",
  range: "Range",
  undisclosed: "Undisclosed",
};

// ---------------------------------------------------------------- in-kind

export const IN_KIND_CATEGORIES = [
  "product_samples",
  "staffing",
  "equipment",
  "space_venue",
  "services",
  "content_media",
  "promotion",
  "other",
] as const;
export type InKindCategory = (typeof IN_KIND_CATEGORIES)[number];
export const isInKindCategory = isOneOf(IN_KIND_CATEGORIES);

export const IN_KIND_CATEGORY_LABELS: Record<InKindCategory, string> = {
  product_samples: "Product / Samples",
  staffing: "Staffing",
  equipment: "Equipment",
  space_venue: "Space / Venue",
  services: "Services",
  content_media: "Content / Media",
  promotion: "Promotion",
  other: "Other",
};

/** `recipient_business` names the Business THIS Opportunity/Option is
 * presented to (the one with the opportunity_recipients row) — never the
 * Opportunity's creator in general. That distinction is the entire reason
 * this isn't just called "business": once Opportunities can originate from
 * brands/venues/organizers (not built yet), "the business provides
 * product" and "the Opportunity's creator provides product" are different
 * facts, and a generic "business" value would conflate them. `findmi` /
 * `organizer` / `other` name who else may provide the value. This is
 * intentionally not a generalized party/actor ledger — just enough to
 * render "who provides this" correctly. */
export const IN_KIND_PROVIDERS = ["recipient_business", "findmi", "organizer", "other"] as const;
export type InKindProvider = (typeof IN_KIND_PROVIDERS)[number];
export const isInKindProvider = isOneOf(IN_KIND_PROVIDERS);

export const IN_KIND_PROVIDER_LABELS: Record<InKindProvider, string> = {
  recipient_business: "Business",
  findmi: "Findmi",
  organizer: "Organizer",
  other: "Other",
};

// ---------------------------------------------------------------- contribution unit (Pass 2.5)

/** The unit quantity is measured in. A fixed common vocabulary (every noun
 * a real Findmi Opportunity structure has needed so far) plus a `custom`
 * escape hatch (custom_unit_label) so a new noun never requires a schema
 * change. Shared by monetary Components (purely descriptive — "$1,500
 * compensation, 3 appearances") and In-Kind Components (a real measurable
 * fact — "200 samples"). */
export const CONTRIBUTION_UNITS = [
  "units",
  "samples",
  "cases",
  "hours",
  "days",
  "staff",
  "locations",
  "events",
  "activations",
  "appearances",
  "posts",
  "videos",
  "photos",
  "deliverables",
  "attendees",
  "impressions",
  "custom",
] as const;
export type ContributionUnit = (typeof CONTRIBUTION_UNITS)[number];
export const isContributionUnit = isOneOf(CONTRIBUTION_UNITS);

export const CONTRIBUTION_UNIT_LABELS: Record<ContributionUnit, string> = {
  units: "Units",
  samples: "Samples",
  cases: "Cases",
  hours: "Hours",
  days: "Days",
  staff: "Staff",
  locations: "Locations",
  events: "Events",
  activations: "Activations",
  appearances: "Appearances",
  posts: "Posts",
  videos: "Videos",
  photos: "Photos",
  deliverables: "Deliverables",
  attendees: "Attendees",
  impressions: "Impressions",
  custom: "Custom",
};

/** "200 Samples" / "2.5 Hours" / "4 Road Trips" (custom). Shared display
 * helper for monetary (descriptive) and In-Kind (measurable) quantity —
 * null when no quantity/unit is set (always valid; never forced). */
export function formatQuantityUnit(c: { quantity: number | null; unit: ContributionUnit | null; custom_unit_label: string | null }): string | null {
  if (c.quantity == null || c.unit == null) return null;
  const label = c.unit === "custom" ? (c.custom_unit_label ?? "Custom") : CONTRIBUTION_UNIT_LABELS[c.unit];
  const qty = Number.isInteger(c.quantity) ? String(c.quantity) : c.quantity.toFixed(2);
  return `${qty} ${label}`;
}

const QUANTITY_UNIT_LIMITS = { custom_unit_label: 60 } as const;

interface QuantityUnitInput {
  quantity?: number | null;
  unit?: string | null;
  custom_unit_label?: string | null;
}

interface QuantityUnitFields {
  quantity: number | null;
  unit: ContributionUnit | null;
  custom_unit_label: string | null;
}

/** Shared quantity/unit parsing + validation — both-or-neither, a real
 * unit from the vocabulary (or custom + a label), quantity > 0. Used by
 * BOTH monetary (purely descriptive) and In-Kind (measurable) Components
 * so the two never drift into different rules for the same two fields.
 * Exported (Builder UX pass) so the Admin builder can show the exact same
 * wording inline before submit — the server still re-runs it on save. */
export function validateQuantityUnit(input: QuantityUnitInput): { ok: true; value: QuantityUnitFields } | { ok: false; error: string } {
  const hasQuantity = input.quantity != null;
  const hasUnit = input.unit != null && input.unit !== "";
  if (hasQuantity !== hasUnit) return { ok: false, error: "Enter both a quantity and a unit, or leave both blank." };
  if (!hasQuantity) return { ok: true, value: { quantity: null, unit: null, custom_unit_label: null } };

  const quantity = Math.round((input.quantity as number) * 100) / 100;
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: "Enter a quantity greater than 0." };
  if (!isContributionUnit(input.unit)) return { ok: false, error: "Choose a unit." };

  const custom_unit_label = blank(input.custom_unit_label ?? null);
  if (input.unit === "custom" && !custom_unit_label) return { ok: false, error: "Describe the custom unit." };
  if (custom_unit_label && custom_unit_label.length > QUANTITY_UNIT_LIMITS.custom_unit_label) {
    return { ok: false, error: "Keep the custom unit label shorter." };
  }

  return { ok: true, value: { quantity, unit: input.unit, custom_unit_label: input.unit === "custom" ? custom_unit_label : null } };
}

// ---------------------------------------------------------------- component input/validation

export const COMPONENT_LIMITS = { in_kind_description: 1000 } as const;

export interface ComponentInput {
  component_type: string | null;
  // Monetary — meaningful only for participation_fee / compensation / project_budget.
  amount_mode?: string | null;
  amount_min_cents?: number | null;
  amount_max_cents?: number | null;
  currency?: string | null;
  // In-Kind — meaningful only for in_kind.
  in_kind_category?: string | null;
  in_kind_description?: string | null;
  in_kind_provider?: string | null;
  in_kind_required?: boolean;
  estimated_value_cents?: number | null;
  // Contribution unit (Pass 2.5) — quantity/unit are shared by both kinds
  // (descriptive on monetary, measurable on In-Kind); unit_value_cents is
  // In-Kind ONLY — a monetary Component's cash amount is never derived
  // from quantity (see validateComponent's own comment below).
  quantity?: number | null;
  unit?: string | null;
  custom_unit_label?: string | null;
  unit_value_cents?: number | null;
}

export interface ComponentFields {
  component_type: ComponentType;
  amount_mode: AmountMode | null;
  amount_min_cents: number | null;
  amount_max_cents: number | null;
  currency: string | null;
  in_kind_category: InKindCategory | null;
  in_kind_description: string | null;
  in_kind_provider: InKindProvider | null;
  in_kind_required: boolean;
  estimated_value_cents: number | null;
  quantity: number | null;
  unit: ContributionUnit | null;
  custom_unit_label: string | null;
  unit_value_cents: number | null;
}

/** Same rules as opportunity_option_components' own CHECK constraints, as
 * friendly messages. Monetary and In-Kind fields are mutually exclusive on
 * one component; which side applies is decided entirely by component_type. */
export function validateComponent(input: ComponentInput): { ok: true; value: ComponentFields } | { ok: false; error: string } {
  if (!isComponentType(input.component_type)) return { ok: false, error: "Choose a commercial term type." };

  if (isMonetaryComponentType(input.component_type)) {
    if (!isAmountMode(input.amount_mode)) return { ok: false, error: "Choose how the amount is expressed." };

    let amount_min_cents: number | null = null;
    let amount_max_cents: number | null = null;

    if (input.amount_mode === "fixed" || input.amount_mode === "starting_at") {
      amount_min_cents = input.amount_min_cents ?? null;
      if (amount_min_cents == null || !Number.isInteger(amount_min_cents) || amount_min_cents <= 0) {
        return { ok: false, error: "Enter an amount greater than $0." };
      }
      if (input.amount_max_cents != null) return { ok: false, error: "Only a Range has an upper amount." };
    } else if (input.amount_mode === "range") {
      amount_min_cents = input.amount_min_cents ?? null;
      amount_max_cents = input.amount_max_cents ?? null;
      if (amount_min_cents == null || !Number.isInteger(amount_min_cents) || amount_min_cents <= 0) {
        return { ok: false, error: "Enter a lower amount greater than $0." };
      }
      if (amount_max_cents == null || !Number.isInteger(amount_max_cents) || amount_max_cents <= 0) {
        return { ok: false, error: "Enter an upper amount greater than $0." };
      }
      if (amount_max_cents < amount_min_cents) return { ok: false, error: "The upper amount can't be less than the lower amount." };
    } else {
      // undisclosed
      if (input.amount_min_cents != null || input.amount_max_cents != null) {
        return { ok: false, error: "An Undisclosed amount can't also have a number." };
      }
    }

    const currency = (blank(input.currency) ?? "USD").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "Currency must be a 3-letter code, like USD." };

    // Pass 2.5 correction: a monetary term's amount_min_cents/amount_max_cents
    // remain the ONLY authoritative financial terms — never derived from or
    // overwritten by quantity. unit_value_cents/estimated_value_cents are
    // In-Kind valuation concepts and are rejected outright here rather than
    // silently ignored, so a caller can never believe it set a per-unit rate
    // or an estimated value on a monetary term.
    if (input.unit_value_cents != null) {
      return { ok: false, error: "A monetary term's amount is set directly — a value per unit doesn't apply here." };
    }
    if (input.estimated_value_cents != null) {
      return { ok: false, error: "A monetary term's amount is set directly — an estimated value doesn't apply here." };
    }
    const quantityResult = validateQuantityUnit(input);
    if (!quantityResult.ok) return quantityResult;

    return {
      ok: true,
      value: {
        component_type: input.component_type,
        amount_mode: input.amount_mode,
        amount_min_cents,
        amount_max_cents,
        currency,
        in_kind_category: null,
        in_kind_description: null,
        in_kind_provider: null,
        in_kind_required: true,
        estimated_value_cents: null,
        quantity: quantityResult.value.quantity,
        unit: quantityResult.value.unit,
        custom_unit_label: quantityResult.value.custom_unit_label,
        unit_value_cents: null,
      },
    };
  }

  // in_kind
  if (!isInKindCategory(input.in_kind_category)) return { ok: false, error: "Choose an In-Kind category." };
  if (!isInKindProvider(input.in_kind_provider)) return { ok: false, error: "Choose who provides this." };
  const in_kind_description = blank(input.in_kind_description ?? null);
  if (input.in_kind_category === "other" && !in_kind_description) return { ok: false, error: "Describe the In-Kind contribution." };
  if (in_kind_description && in_kind_description.length > COMPONENT_LIMITS.in_kind_description) {
    return { ok: false, error: "Keep the In-Kind description shorter." };
  }

  const quantityResult = validateQuantityUnit(input);
  if (!quantityResult.ok) return quantityResult;

  const estimated_value_cents = input.estimated_value_cents ?? null;
  if (estimated_value_cents != null && (!Number.isInteger(estimated_value_cents) || estimated_value_cents <= 0)) {
    return { ok: false, error: "Estimated value must be greater than $0, or left blank." };
  }

  // Pass 2.5: In-Kind supports exactly two valuation methods, mutually
  // exclusive on one Component — a direct total (estimated_value_cents) or
  // a per-unit rate (unit_value_cents, requires quantity+unit) — or
  // neither ("No Value" is always valid; never a required input).
  const unit_value_cents = input.unit_value_cents ?? null;
  if (unit_value_cents != null) {
    if (!Number.isInteger(unit_value_cents) || unit_value_cents <= 0) {
      return { ok: false, error: "Value per unit must be greater than $0, or left blank." };
    }
    if (quantityResult.value.quantity == null) {
      return { ok: false, error: "A value per unit needs a quantity and a unit." };
    }
  }
  if (estimated_value_cents != null && unit_value_cents != null) {
    return { ok: false, error: "Choose either an estimated total or a value per unit, not both." };
  }

  return {
    ok: true,
    value: {
      component_type: "in_kind",
      amount_mode: null,
      amount_min_cents: null,
      amount_max_cents: null,
      currency: null,
      in_kind_category: input.in_kind_category,
      in_kind_description,
      in_kind_provider: input.in_kind_provider,
      in_kind_required: input.in_kind_required ?? true,
      estimated_value_cents,
      quantity: quantityResult.value.quantity,
      unit: quantityResult.value.unit,
      custom_unit_label: quantityResult.value.custom_unit_label,
      unit_value_cents,
    },
  };
}

export function countMonetaryComponents(components: readonly Pick<ComponentFields, "component_type">[]): number {
  return components.filter((c) => isMonetaryComponentType(c.component_type)).length;
}

// ---------------------------------------------------------------- option input/validation

export const OPTION_LIMITS = { name: 120, description: 280, custom_terms_note: 500 } as const;

export interface OptionInput {
  name?: string | null;
  description?: string | null;
  commercial_mode: string | null;
  custom_terms_note?: string | null;
  components: ComponentInput[];
}

export interface OptionFields {
  name: string | null;
  description: string | null;
  commercial_mode: OptionCommercialMode;
  custom_terms_note: string | null;
  components: ComponentFields[];
}

/** Same rules as opportunity_options' own CHECK constraints and the
 * commercial_mode-consistency triggers, as friendly messages — this
 * function is the single pre-write gate the future Admin builder's
 * aggregate write (Option + Components persisted together in one RPC/
 * transaction — see the migration's own comment on opportunity_options)
 * must call before persisting anything, so an incomplete or
 * misclassified Option is never observable in the database, not even
 * transiently.
 *
 * commercial_mode is a true classification, derived from (and checked
 * against) the actual component content, not an independent label:
 *   STRUCTURED    — monetaryCount >= 1 OR requiredInKindCount >= 1.
 *                   Optional In-Kind may additionally coexist.
 *   COMPLIMENTARY — monetaryCount === 0 AND requiredInKindCount === 0.
 *                   Zero or more OPTIONAL In-Kind components are fine —
 *                   "Complimentary + optional product support" is valid.
 *                   An Option with ONLY optional In-Kind and nothing else
 *                   must be Complimentary, never Structured.
 *   CUSTOM        — zero components of any kind, optional custom_terms_note. */
export function validateOption(input: OptionInput): { ok: true; value: OptionFields } | { ok: false; error: string } {
  if (!isOptionCommercialMode(input.commercial_mode)) return { ok: false, error: "Choose a commercial mode for this Option." };

  const name = blank(input.name ?? null);
  if (name && name.length > OPTION_LIMITS.name) return { ok: false, error: `Keep the option name to ${OPTION_LIMITS.name} characters.` };
  const description = blank(input.description ?? null);
  if (description && description.length > OPTION_LIMITS.description) return { ok: false, error: "Keep the option description shorter." };

  if (input.commercial_mode === "custom") {
    if (input.components.length > 0) {
      return { ok: false, error: "A Custom Option can't have structured commercial terms — remove them, or switch to Structured." };
    }
    const custom_terms_note = blank(input.custom_terms_note ?? null);
    if (custom_terms_note && custom_terms_note.length > OPTION_LIMITS.custom_terms_note) {
      return { ok: false, error: "Keep the custom terms note shorter." };
    }
    return { ok: true, value: { name, description, commercial_mode: "custom", custom_terms_note, components: [] } };
  }

  if (blank(input.custom_terms_note ?? null)) return { ok: false, error: "A custom terms note only applies to a Custom Option." };

  const components: ComponentFields[] = [];
  for (const c of input.components) {
    const result = validateComponent(c);
    if (!result.ok) return result;
    components.push(result.value);
  }

  const monetaryCount = countMonetaryComponents(components);
  if (monetaryCount > 1) {
    return {
      ok: false,
      error: "An Option can have at most one monetary term (Participation Fee, Compensation, or Project Budget) — add anything else as In-Kind, or create a separate Option.",
    };
  }
  const requiredInKindCount = components.filter((c) => c.component_type === "in_kind" && c.in_kind_required).length;

  if (input.commercial_mode === "complimentary") {
    if (monetaryCount > 0) return { ok: false, error: "A Complimentary Option can't include a monetary term — remove it, or switch to Structured." };
    if (requiredInKindCount > 0) {
      return { ok: false, error: "A Complimentary Option can't require an In-Kind contribution — mark it optional, or switch to Structured." };
    }
    return { ok: true, value: { name, description, commercial_mode: "complimentary", custom_terms_note: null, components } };
  }

  // structured
  if (monetaryCount === 0 && requiredInKindCount === 0) {
    return {
      ok: false,
      error: "A Structured Option needs a monetary term or a required In-Kind contribution — an Option with only optional In-Kind should be Complimentary instead.",
    };
  }
  return { ok: true, value: { name, description, commercial_mode: "structured", custom_terms_note: null, components } };
}

// ---------------------------------------------------------------- formatting

function formatMoney(cents: number, currency: string): string {
  const amount = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** "$750" / "Starting at $1,500" / "$1,000–$2,000" / "Amount discussed
 * with Findmi". Only meaningful for a monetary component. */
export function formatComponentAmount(c: Pick<ComponentFields, "amount_mode" | "amount_min_cents" | "amount_max_cents" | "currency">): string {
  if (c.amount_mode == null || c.amount_mode === "undisclosed") return "Amount discussed with Findmi";
  const currency = c.currency ?? "USD";
  if (c.amount_mode === "range" && c.amount_min_cents != null && c.amount_max_cents != null) {
    return `${formatMoney(c.amount_min_cents, currency)}–${formatMoney(c.amount_max_cents, currency)}`;
  }
  if (c.amount_min_cents == null) return "Amount discussed with Findmi";
  const amount = formatMoney(c.amount_min_cents, currency);
  return c.amount_mode === "starting_at" ? `Starting at ${amount}` : amount;
}

// ---------------------------------------------------------------- unit-value calculation (Pass 2.5)

/** quantity (numeric(10,2), always a clean 2-decimal value by the time it
 * reaches here — validateQuantityUnit already rounds it) * unit_value_cents
 * (integer cents) -> one deterministic integer-cent result, half-up.
 * Scales quantity to an exact integer of hundredths first so the
 * multiplication never touches binary floating-point error (e.g. naively
 * computing 2.5 * 3333 / 100 can drift a fraction of a cent off the true
 * value) — qHundredths * unitValueCents is an exact integer product (both
 * operands are safe integers), then dividing by 100 and rounding gives the
 * half-up cent result. Example: quantity=2.5, unit_value_cents=3333 ->
 * 8333 (not 8332, not 8332.5). Never stored — computed here, on demand,
 * every time a value is needed. */
export function calculateUnitValueCents(quantity: number, unitValueCents: number): number {
  const qHundredths = Math.round(quantity * 100);
  const productHundredths = qHundredths * unitValueCents;
  return Math.round(productHundredths / 100);
}

/** The one estimated value for an In-Kind Component, by whichever
 * valuation method it actually used (the two are mutually exclusive —
 * validateComponent never lets both be set): the calculated quantity *
 * unit_value_cents total (never stored), or the direct estimated_value_
 * cents, or null when unvalued ("No Value" is always a valid state). */
export function calculateInKindEstimatedValueCents(
  c: Pick<ComponentFields, "quantity" | "unit_value_cents" | "estimated_value_cents">
): number | null {
  if (c.unit_value_cents != null && c.quantity != null) return calculateUnitValueCents(c.quantity, c.unit_value_cents);
  return c.estimated_value_cents;
}

/** "Equivalent to $500 / appearance" — PRESENTATION ONLY, never stored and
 * never fed back into amount_min_cents. Only meaningful when the
 * authoritative amount is a single number (Fixed or Starting At) and a
 * quantity/unit is present — Range and Undisclosed never get a derived
 * rate (there's no single number to divide, and inventing one would
 * misrepresent the real commercial terms — "$1,000–$2,000 / 3
 * appearances" shows the range and the count, with no fake per-appearance
 * figure). */
export function formatMonetaryPerUnitEquivalent(
  c: Pick<ComponentFields, "amount_mode" | "amount_min_cents" | "currency" | "quantity" | "unit" | "custom_unit_label">
): string | null {
  if (c.quantity == null || c.unit == null) return null;
  if (c.amount_mode !== "fixed" && c.amount_mode !== "starting_at") return null;
  if (c.amount_min_cents == null) return null;
  const perUnitCents = Math.round(c.amount_min_cents / c.quantity);
  const label = c.unit === "custom" ? (c.custom_unit_label ?? "unit") : CONTRIBUTION_UNIT_LABELS[c.unit].replace(/s$/, "");
  return `Equivalent to ${formatMoney(perUnitCents, c.currency ?? "USD")} / ${label.toLowerCase()}`;
}

/** Option-level aggregate: the sum of every In-Kind Component's own
 * calculated/direct value (calculateInKindEstimatedValueCents), and
 * whether at least one In-Kind Component on this Option carries NO value
 * at all — so a summary can honestly say "+ unvalued contribution(s)"
 * instead of silently treating an unvalued contribution as worth $0.
 * NEVER includes Participation Fee / Compensation / Project Budget — cash
 * and estimated non-cash value are always kept separate. totalCents is
 * null when NO In-Kind Component on the Option has a value at all
 * (distinct from "the total happens to be $0", which can't occur since
 * every stored value is > 0). */
export function summarizeOptionEstimatedInKindValue(
  components: readonly Pick<ComponentFields, "component_type" | "quantity" | "unit_value_cents" | "estimated_value_cents">[]
): { totalCents: number | null; hasUnvalued: boolean } {
  let totalCents: number | null = null;
  let hasUnvalued = false;
  for (const c of components) {
    if (c.component_type !== "in_kind") continue;
    const value = calculateInKindEstimatedValueCents(c);
    if (value == null) hasUnvalued = true;
    else totalCents = (totalCents ?? 0) + value;
  }
  return { totalCents, hasUnvalued };
}

/** "Participation Fee — $750" / "In-Kind — Product / Samples, 200
 * Samples (~$400 estimated)". Quantity/unit/value are appended only when
 * present — the Pass 1 shape ("In-Kind — Product / Samples") is byte-
 * identical when none of them are set. */
export function formatComponentSummary(c: ComponentFields): string {
  if (c.component_type === "in_kind") {
    const category = c.in_kind_category ? IN_KIND_CATEGORY_LABELS[c.in_kind_category] : "";
    const qty = formatQuantityUnit(c);
    const base = `${COMPONENT_TYPE_LABELS.in_kind} — ${[category, qty].filter(Boolean).join(", ")}`;
    const value = calculateInKindEstimatedValueCents(c);
    return value != null ? `${base} (~${formatMoney(value, "USD")} estimated)` : base;
  }
  return `${COMPONENT_TYPE_LABELS[c.component_type]} — ${formatComponentAmount(c)}`;
}

/** "Complimentary" / "Custom Terms" / "Participation Fee — $750 + In-Kind
 * — Product / Samples". The one-line PRIMARY summary for a single Option.
 * Deliberately stays "Complimentary" even when the Option also carries
 * optional In-Kind components — the primary summary never becomes "In-Kind
 * Contribution Required" or stops being Complimentary merely because an
 * optional component exists (see formatOptionalContributions for that
 * detail-level information, kept separate on purpose). */
export function formatOptionSummary(option: Pick<OptionFields, "commercial_mode" | "components">): string {
  if (option.commercial_mode === "complimentary") return OPTION_COMMERCIAL_MODE_LABELS.complimentary;
  if (option.commercial_mode === "custom") return OPTION_COMMERCIAL_MODE_LABELS.custom;
  return option.components.map(formatComponentSummary).join(" + ");
}

/** Detail-level only — never folded into formatOptionSummary. Lists any
 * OPTIONAL In-Kind components on an Option (typically a Complimentary one,
 * but equally valid on a Structured one) as "Optional: Product / Samples"
 * style strings, so a Business can see "oh, and product contribution is
 * welcome but not required" without that fact ever overriding or
 * qualifying the primary "Complimentary" headline. */
export function formatOptionalContributions(option: Pick<OptionFields, "components">): string[] {
  return option.components
    .filter((c): c is ComponentFields & { in_kind_category: InKindCategory } => c.component_type === "in_kind" && !c.in_kind_required && c.in_kind_category != null)
    .map((c) => `Optional: ${IN_KIND_CATEGORY_LABELS[c.in_kind_category]}`);
}

/** Pass 3 — the label prefix for summarizeOptionsForCard's uniform case,
 * by monetary direction. participation_fee keeps the original "Options
 * from $X" wording (unchanged, same string Pass 1 already shipped and
 * tested); compensation/project_budget get their own direction-correct
 * prefix — never "Options" generically, which would read as a
 * Participation Fee to a Business. */
const UNIFORM_CARD_PREFIX: Record<MonetaryComponentType, string> = {
  participation_fee: "Options",
  compensation: "Compensation options",
  project_budget: "Project budgets",
};

/** The safe, never-misleading summary for MULTIPLE Options on one card.
 * Collapses to "<direction prefix> from $X" ONLY when every Option is
 * Structured with exactly one Fixed/Starting-At monetary component, all
 * sharing the same monetary direction (never blends Participation Fee
 * with Compensation, never includes a Range/Undisclosed/Complimentary/
 * Custom Option in the "from" number). Anything less uniform falls back
 * to a neutral "N Options" with no dollar figure at all — deliberately
 * conservative rather than ever showing a number that could mean two
 * different things depending on which Option a Business picks. */
export function summarizeOptionsForCard(options: readonly Pick<OptionFields, "commercial_mode" | "components">[]): string {
  if (options.length === 0) return "";
  if (options.length === 1) return formatOptionSummary(options[0]);

  const directions = new Set<MonetaryComponentType>();
  const floors: { cents: number; currency: string }[] = [];
  let uniform = true;

  for (const o of options) {
    if (o.commercial_mode !== "structured") {
      uniform = false;
      break;
    }
    const monetary = o.components.find((c) => isMonetaryComponentType(c.component_type));
    if (!monetary || monetary.amount_mode === "undisclosed" || monetary.amount_mode === "range" || monetary.amount_min_cents == null) {
      uniform = false;
      break;
    }
    directions.add(monetary.component_type as MonetaryComponentType);
    floors.push({ cents: monetary.amount_min_cents, currency: monetary.currency ?? "USD" });
  }

  if (uniform && directions.size === 1 && floors.length === options.length) {
    const lowest = floors.reduce((min, f) => (f.cents < min.cents ? f : min));
    const direction = [...directions][0];
    return `${UNIFORM_CARD_PREFIX[direction]} from ${formatMoney(lowest.cents, lowest.currency)}`;
  }
  return `${options.length} Options`;
}
