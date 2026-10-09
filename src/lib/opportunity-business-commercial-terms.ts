// Opportunities — Business Commercial Terms Experience (Pass 3).
//
// Presentation-shaping helpers that turn the Pass 1/2/2.5 structured
// Option/Component model into what a BUSINESS should see — direction-
// correct labels ("Participation Cost"/"Compensation"/"Project Budget",
// never the generic Admin-facing "Participation Fee" or the retired
// "Investment"), provider-grouped contributions, and card summaries.
//
// This module DOES import opportunity-commercial-terms-domain.ts (the
// canonical formatters/calculations) — unlike the zero-import domain/
// bridge/participation-cost modules, it is not meant to be live-unit-
// tested by direct Node import; it's covered by static source guards
// (confirming it reuses the canonical helpers rather than reimplementing
// them) plus the already-live-tested correctness of what it calls.
//
// Nothing here writes anything or touches a database — pure data shaping
// for React components to render.

import {
  IN_KIND_CATEGORY_LABELS,
  IN_KIND_PROVIDERS,
  IN_KIND_PROVIDER_LABELS,
  calculateInKindEstimatedValueCents,
  formatMonetaryPerUnitEquivalent,
  formatQuantityUnit,
  isMonetaryComponentType,
  type ComponentFields,
  type InKindProvider,
  type MonetaryComponentType,
  type OptionFields,
} from "./opportunity-commercial-terms-domain";

// ---------------------------------------------------------------- direction-correct vocabulary

/** Business-facing labels for the three monetary directions. Deliberately
 * DIFFERENT from COMPONENT_TYPE_LABELS (the Admin-facing "Participation
 * Fee" / "Compensation" / "Project Budget" vocabulary, unchanged, still
 * used by the Admin builder/detail) — a Business reads "Participation
 * Cost," not "Participation Fee." Never "Investment." */
export const BUSINESS_MONETARY_LABELS: Record<MonetaryComponentType, string> = {
  participation_fee: "Participation Cost",
  compensation: "Compensation",
  project_budget: "Project Budget",
};

export const BUSINESS_MONETARY_HELPER_TEXT: Record<MonetaryComponentType, string> = {
  participation_fee: "You pay to participate",
  compensation: "You receive payment",
  project_budget: "Budget available for this project",
};

function formatMoney(cents: number, currency: string): string {
  const amount = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** "$750" / "Starting at $750" / "$500–$1,000" / "Contact Findmi". Same
 * shape logic as the canonical formatComponentAmount, but "Contact
 * Findmi" for the no-amount case (Undisclosed / missing) — matching the
 * EXISTING legacy wording (formatOpportunityPrice's own "Contact Findmi"
 * for custom/undisclosed legacy pricing) rather than Admin's internal
 * "Amount discussed with Findmi" phrasing, so a Business sees the same
 * words regardless of whether an Opportunity is legacy or structured. */
export function formatBusinessMonetaryAmount(c: Pick<ComponentFields, "amount_mode" | "amount_min_cents" | "amount_max_cents" | "currency">): string {
  if (c.amount_mode == null || c.amount_mode === "undisclosed") return "Contact Findmi";
  const currency = c.currency ?? "USD";
  if (c.amount_mode === "range" && c.amount_min_cents != null && c.amount_max_cents != null) {
    return `${formatMoney(c.amount_min_cents, currency)}–${formatMoney(c.amount_max_cents, currency)}`;
  }
  if (c.amount_min_cents == null) return "Contact Findmi";
  const amount = formatMoney(c.amount_min_cents, currency);
  return c.amount_mode === "starting_at" ? `Starting at ${amount}` : amount;
}

// ---------------------------------------------------------------- primary commercial term

export type BusinessPrimaryTerm =
  | { kind: "monetary"; label: string; amount: string; helper: string; quantityUnit: string | null; perUnitEquivalent: string | null }
  | { kind: "complimentary"; helper: string }
  | { kind: "custom"; note: string | null };

/** The Option's one primary commercial line, or null when the Option is
 * Structured with no monetary component at all (required In-Kind only) —
 * in that case there is no "amount" to lead with, so the hierarchy goes
 * straight to the contribution groups below (never fabricating a price). */
export function buildBusinessPrimaryTerm(option: Pick<OptionFields, "commercial_mode" | "components" | "custom_terms_note">): BusinessPrimaryTerm | null {
  if (option.commercial_mode === "complimentary") {
    return { kind: "complimentary", helper: "No participation fee" };
  }
  if (option.commercial_mode === "custom") {
    return { kind: "custom", note: option.custom_terms_note };
  }
  const monetary = option.components.find((c) => isMonetaryComponentType(c.component_type));
  if (!monetary) return null;
  const type = monetary.component_type as MonetaryComponentType;
  return {
    kind: "monetary",
    label: BUSINESS_MONETARY_LABELS[type],
    amount: formatBusinessMonetaryAmount(monetary),
    helper: BUSINESS_MONETARY_HELPER_TEXT[type],
    quantityUnit: formatQuantityUnit(monetary),
    perUnitEquivalent: formatMonetaryPerUnitEquivalent(monetary),
  };
}

// ---------------------------------------------------------------- provider-grouped contributions

/** `other`'s heading is deliberately neutral — never a fabricated party
 * name. Order here is also THE render order: Your Contribution first
 * (what the Business must think about), then Findmi, then Organizer,
 * then Other. */
export const PROVIDER_GROUP_HEADINGS: Record<InKindProvider, string> = {
  recipient_business: "Your Contribution",
  findmi: "Provided by Findmi",
  organizer: "Provided by Organizer",
  other: "Provided by Another Party",
};

export interface BusinessContributionItem {
  title: string;
  /** A free-text admin description, shown as a secondary line ONLY when
   * it adds information beyond the title (e.g. the title already came
   * from formatQuantityUnit, so a separate description is additional
   * context, not a duplicate of it). */
  description: string | null;
  required: boolean;
  /** "Estimated value: $400" — never "Price"/"Cost"/"Fee". Null when
   * unvalued ("No Value" is always a valid, fully supported state). */
  estimatedValue: string | null;
}

export interface BusinessContributionGroup {
  heading: string;
  items: BusinessContributionItem[];
}

function buildContributionItem(c: ComponentFields): BusinessContributionItem {
  const quantityUnit = formatQuantityUnit(c);
  const title = quantityUnit ?? (c.in_kind_description || (c.in_kind_category ? IN_KIND_CATEGORY_LABELS[c.in_kind_category] : "Contribution"));
  // Only surface the description as a SECOND line when it isn't already
  // what became the title above (avoid showing the same text twice).
  const description = quantityUnit && c.in_kind_description ? c.in_kind_description : null;
  const valueCents = calculateInKindEstimatedValueCents(c);
  return {
    title,
    description,
    required: c.in_kind_required,
    estimatedValue: valueCents != null ? `Estimated value: ${formatMoney(valueCents, "USD")}` : null,
  };
}

/** Groups every In-Kind Component by who provides it. Never renders an
 * empty group — a provider with zero In-Kind Components here simply has
 * no entry in the returned array. Required contributions are listed
 * before optional ones within a group; order otherwise follows each
 * Component's own stored display_order (the order they arrive in). */
export function groupContributionsByProvider(components: readonly ComponentFields[]): BusinessContributionGroup[] {
  const groups: BusinessContributionGroup[] = [];
  for (const provider of IN_KIND_PROVIDERS) {
    const inGroup = components.filter((c) => c.component_type === "in_kind" && c.in_kind_provider === provider);
    if (inGroup.length === 0) continue;
    const required = inGroup.filter((c) => c.in_kind_required).map(buildContributionItem);
    const optional = inGroup.filter((c) => !c.in_kind_required).map(buildContributionItem);
    groups.push({ heading: PROVIDER_GROUP_HEADINGS[provider], items: [...required, ...optional] });
  }
  return groups;
}

// ---------------------------------------------------------------- full hierarchy (detail page)

export interface BusinessCommercialTerms {
  primary: BusinessPrimaryTerm | null;
  groups: BusinessContributionGroup[];
}

export function buildBusinessCommercialTerms(option: OptionFields): BusinessCommercialTerms {
  return {
    primary: buildBusinessPrimaryTerm(option),
    groups: groupContributionsByProvider(option.components),
  };
}

// ---------------------------------------------------------------- card summaries

export type OptionCardSummary =
  | { kind: "monetary"; label: string; amount: string }
  | { kind: "complimentary" }
  | { kind: "custom" }
  /** Structured, but with no monetary component at all (required In-Kind
   * only) — a real, valid state with no example in the spec; shown
   * neutrally rather than fabricating a price. */
  | { kind: "structured_no_amount" };

/** THE single-Option card summary — never arbitrary-first-component
 * semantics, always the actual validated Option classification. */
export function summarizeOptionForCard(option: Pick<OptionFields, "commercial_mode" | "components">): OptionCardSummary {
  if (option.commercial_mode === "complimentary") return { kind: "complimentary" };
  if (option.commercial_mode === "custom") return { kind: "custom" };
  const monetary = option.components.find((c) => isMonetaryComponentType(c.component_type));
  if (!monetary) return { kind: "structured_no_amount" };
  const type = monetary.component_type as MonetaryComponentType;
  return { kind: "monetary", label: BUSINESS_MONETARY_LABELS[type], amount: formatBusinessMonetaryAmount(monetary) };
}
