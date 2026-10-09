// Opportunities — Commercial Terms Admin Builder UX pass: the builder's
// pure, React-free state logic. CommercialTermsBuilder.tsx renders from
// these functions; nothing here decides a business rule on its own.
//
// - Every value the builder POSTS comes from submittedComponentValues()/
//   submittedOptionValues() below, so the ct_{i}_* / ct_{i}_c_{j}_* field
//   contract parseCommercialTermsForm (opportunity-commercial-terms-form.ts)
//   reads is defined in exactly one place on the client side.
// - Pre-submit checks (collectCommercialTermsIssues) never re-implement
//   validation: they run the SAME validateQuantityUnit/validateComponent/
//   validateOption from the domain module over the exact values that would
//   be submitted, and only decide which field to point the admin at. The
//   server still re-validates everything on save.
//
// Type-only imports (and validators passed in as `deps`) keep this module
// importable by plain `node --test`, the same way the domain module is.

import type {
  AmountMode,
  ComponentInput,
  ComponentType,
  ContributionUnit,
  InKindCategory,
  InKindProvider,
  MonetaryComponentType,
  OptionCommercialMode,
  OptionInput,
} from "./opportunity-commercial-terms-domain";

export interface InitialComponent {
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

export interface InitialOption {
  id: string | null;
  name: string | null;
  description: string | null;
  commercial_mode: OptionCommercialMode;
  custom_terms_note: string | null;
  components: InitialComponent[];
}

/** "none" = no estimated value (the default — never a prominent selected
 * control). "total"/"per_unit" are REAL UI state, chosen by the admin, so
 * the matching input appears even while it's still empty. */
export type ValuationMode = "none" | "total" | "per_unit";

export interface ComponentState {
  key: string;
  component_type: ComponentType | "";
  amount_mode: AmountMode | "";
  amount_min: string;
  amount_max: string;
  currency: string;
  in_kind_category: InKindCategory | "";
  in_kind_description: string;
  in_kind_provider: InKindProvider | "";
  in_kind_required: boolean;
  estimated_value: string;
  quantity: string;
  unit: ContributionUnit | "";
  custom_unit_label: string;
  unit_value: string;
  // UI-only state (never submitted).
  valuation: ValuationMode;
  /** In-Kind "+ Add Estimated Value" disclosure — open with no method
   * chosen yet is a real, distinct state. */
  valuation_open: boolean;
  /** Monetary "What Does This Cover?" disclosure. */
  cover_open: boolean;
  /** Monetary currency editor ("USD · Change"). */
  currency_open: boolean;
}

export interface OptionState {
  key: string;
  id: string | null;
  name: string;
  description: string;
  commercial_mode: OptionCommercialMode;
  custom_terms_note: string;
  components: ComponentState[];
}

export const DEFAULT_CURRENCY = "USD";
/** New In-Kind terms default to the Business this Opportunity is presented
 * to — visible and changeable. Stored terms keep their stored provider. */
export const DEFAULT_IN_KIND_PROVIDER: InKindProvider = "recipient_business";

const MONETARY_TYPES: readonly string[] = ["participation_fee", "compensation", "project_budget"];
const isMonetary = (t: string): boolean => MONETARY_TYPES.includes(t);

export const MONETARY_HEADINGS: Record<MonetaryComponentType, string> = {
  participation_fee: "Business Pays",
  compensation: "Business Receives",
  project_budget: "Project Budget",
};

const centsToStr = (c: number | null): string => (c == null ? "" : c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));

export function initialValuation(c: { estimated_value_cents: number | null; unit_value_cents: number | null }): ValuationMode {
  if (c.unit_value_cents != null) return "per_unit";
  if (c.estimated_value_cents != null) return "total";
  return "none";
}

export function componentToState(c: InitialComponent, key: string): ComponentState {
  const currency = c.currency ?? DEFAULT_CURRENCY;
  return {
    key,
    component_type: c.component_type,
    amount_mode: c.amount_mode ?? "",
    amount_min: centsToStr(c.amount_min_cents),
    amount_max: centsToStr(c.amount_max_cents),
    currency,
    in_kind_category: c.in_kind_category ?? "",
    in_kind_description: c.in_kind_description ?? "",
    // Stored provider is always kept as-is — never re-defaulted.
    in_kind_provider: c.in_kind_provider ?? "",
    in_kind_required: c.in_kind_required,
    estimated_value: centsToStr(c.estimated_value_cents),
    quantity: c.quantity == null ? "" : String(c.quantity),
    unit: c.unit ?? "",
    custom_unit_label: c.custom_unit_label ?? "",
    unit_value: centsToStr(c.unit_value_cents),
    valuation: initialValuation(c),
    valuation_open: initialValuation(c) !== "none",
    cover_open: c.quantity != null || c.unit != null,
    currency_open: isMonetary(c.component_type) && currency !== DEFAULT_CURRENCY,
  };
}

export function optionToState(o: InitialOption, newKey: () => string): OptionState {
  return {
    key: newKey(),
    id: o.id,
    name: o.name ?? "",
    description: o.description ?? "",
    commercial_mode: o.commercial_mode,
    custom_terms_note: o.custom_terms_note ?? "",
    components: o.components.map((c) => componentToState(c, newKey())),
  };
}

export function defaultOptionState(key: string): OptionState {
  return { key, id: null, name: "", description: "", commercial_mode: "structured", custom_terms_note: "", components: [] };
}

const EMPTY_COMPONENT = {
  amount_mode: "" as const,
  amount_min: "",
  amount_max: "",
  currency: "",
  in_kind_category: "" as const,
  in_kind_description: "",
  in_kind_provider: "" as const,
  in_kind_required: true,
  estimated_value: "",
  quantity: "",
  unit: "" as const,
  custom_unit_label: "",
  unit_value: "",
  valuation: "none" as const,
  valuation_open: false,
  cover_open: false,
  currency_open: false,
};

export function defaultMonetaryComponent(type: MonetaryComponentType, key: string): ComponentState {
  return { ...EMPTY_COMPONENT, key, component_type: type, amount_mode: "fixed", currency: DEFAULT_CURRENCY };
}

export function defaultInKindComponent(required: boolean, key: string): ComponentState {
  return { ...EMPTY_COMPONENT, key, component_type: "in_kind", in_kind_provider: DEFAULT_IN_KIND_PROVIDER, in_kind_required: required };
}

// ---------------------------------------------------------------- disclosure / valuation transitions

/** Choosing a valuation method is real state; the OTHER method's value is
 * cleared so the two stay mutually exclusive (DB/domain invariant). */
export function selectValuation(mode: Exclude<ValuationMode, "none">): Partial<ComponentState> {
  return mode === "total" ? { valuation_open: true, valuation: "total", unit_value: "" } : { valuation_open: true, valuation: "per_unit", estimated_value: "" };
}

/** "+ Add Estimated Value" — reveals the two methods, neither chosen. */
export function openValuation(): Partial<ComponentState> {
  return { valuation_open: true };
}

/** "Remove Value" — back to the collapsed, no-value default. */
export function removeValuation(): Partial<ComponentState> {
  return { valuation_open: false, valuation: "none", estimated_value: "", unit_value: "" };
}

/** Quantity/unit (and a custom label) only ever clear together. */
export function clearQuantityUnit(): Partial<ComponentState> {
  return { quantity: "", unit: "", custom_unit_label: "" };
}

/** Monetary "What Does This Cover?" — closing it removes the pair. */
export function closeCover(): Partial<ComponentState> {
  return { cover_open: false, ...clearQuantityUnit() };
}

/** Which amount inputs a monetary term shows. Fixed/Starting At = one
 * amount (no disabled "To"); Range = From + To; Undisclosed = none. */
export function amountFieldsFor(mode: AmountMode | ""): { min: boolean; max: boolean; minLabel: string } {
  if (mode === "range") return { min: true, max: true, minLabel: "From" };
  if (mode === "undisclosed") return { min: false, max: false, minLabel: "" };
  return { min: true, max: false, minLabel: "Amount" };
}

/** Option-management chrome. A single Option shows none of it — just a
 * quiet "+ Add Another Option". */
export function optionChrome(total: number): {
  showHeader: boolean;
  showMove: boolean;
  showDuplicate: boolean;
  showRemove: boolean;
  addLabel: string;
} {
  const multi = total > 1;
  return { showHeader: multi, showMove: multi, showDuplicate: multi, showRemove: multi, addLabel: multi ? "+ Add Option" : "+ Add Another Option" };
}

// ---------------------------------------------------------------- what is submitted

/** Same parse as opportunity-commercial-terms-form.ts's parseQuantity. */
export function parseQuantityInput(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : Number.NaN;
}

/** A complete, valid-looking quantity/unit pair — gates "Value Per Unit". */
export function hasQuantityUnit(c: Pick<ComponentState, "quantity" | "unit" | "custom_unit_label">): boolean {
  const q = parseQuantityInput(c.quantity);
  if (q == null || !Number.isFinite(q) || q <= 0 || c.unit === "") return false;
  return c.unit !== "custom" || c.custom_unit_label.trim() !== "";
}

export type SubmittedComponentField =
  | "type"
  | "amount_mode"
  | "amount_min"
  | "amount_max"
  | "currency"
  | "in_kind_category"
  | "in_kind_description"
  | "in_kind_provider"
  | "in_kind_required"
  | "estimated_value"
  | "quantity"
  | "unit"
  | "custom_unit_label"
  | "unit_value";

/** Exactly the ct_{i}_c_{j}_* values the builder posts (as hidden inputs),
 * keyed by field suffix. Anything not visible for the current state is
 * posted blank, so a stale value from a previous mode can never be
 * submitted (e.g. a Range "To" after switching to Fixed). */
export function submittedComponentValues(c: ComponentState, optionMode: OptionCommercialMode): Record<SubmittedComponentField, string> {
  const monetary = isMonetary(c.component_type);
  const amount = amountFieldsFor(c.amount_mode);
  const showPair = monetary ? c.cover_open : true;
  return {
    type: c.component_type,
    amount_mode: monetary ? c.amount_mode : "",
    amount_min: monetary && amount.min ? c.amount_min : "",
    amount_max: monetary && amount.max ? c.amount_max : "",
    currency: monetary ? c.currency.trim() || DEFAULT_CURRENCY : "",
    in_kind_category: monetary ? "" : c.in_kind_category,
    in_kind_description: monetary ? "" : c.in_kind_description,
    in_kind_provider: monetary ? "" : c.in_kind_provider,
    in_kind_required: !monetary && optionMode !== "complimentary" && c.in_kind_required ? "on" : "",
    estimated_value: !monetary && c.valuation === "total" ? c.estimated_value : "",
    quantity: showPair ? c.quantity : "",
    unit: showPair ? c.unit : "",
    custom_unit_label: showPair && c.unit === "custom" ? c.custom_unit_label : "",
    unit_value: !monetary && c.valuation === "per_unit" ? c.unit_value : "",
  };
}

/** Option-level ct_{i}_* values. A custom terms note is only posted for a
 * Custom Option (switching away keeps it in state, but never submits it). */
export function submittedOptionValues(o: OptionState): { id: string; name: string; description: string; commercial_mode: string; custom_terms_note: string } {
  return {
    id: o.id ?? "",
    name: o.name,
    description: o.description,
    commercial_mode: o.commercial_mode,
    custom_terms_note: o.commercial_mode === "custom" ? o.custom_terms_note : "",
  };
}

// ---------------------------------------------------------------- pre-submit checks (domain-backed)

type Result = { ok: true } | { ok: false; error: string };
export interface CommercialTermsValidators {
  validateQuantityUnit: (input: { quantity?: number | null; unit?: string | null; custom_unit_label?: string | null }) => Result;
  validateComponent: (input: ComponentInput) => Result;
  validateOption: (input: OptionInput) => Result;
  /** parsePriceToCents from opportunity-listings-domain.ts. */
  parseMoney: (raw: string | null) => number | null;
}

const blankToNull = (v: string): string | null => (v.trim() ? v.trim() : null);

/** Mirrors readComponent() in opportunity-commercial-terms-form.ts over the
 * submitted values — what the server will see. */
export function toComponentInput(c: ComponentState, optionMode: OptionCommercialMode, parseMoney: CommercialTermsValidators["parseMoney"]): ComponentInput {
  const v = submittedComponentValues(c, optionMode);
  const money = (raw: string) => {
    const s = blankToNull(raw);
    return s == null ? null : parseMoney(s);
  };
  return {
    component_type: blankToNull(v.type),
    amount_mode: blankToNull(v.amount_mode),
    amount_min_cents: money(v.amount_min),
    amount_max_cents: money(v.amount_max),
    currency: blankToNull(v.currency),
    in_kind_category: blankToNull(v.in_kind_category),
    in_kind_description: blankToNull(v.in_kind_description),
    in_kind_provider: blankToNull(v.in_kind_provider),
    in_kind_required: v.in_kind_required === "on",
    estimated_value_cents: money(v.estimated_value),
    quantity: parseQuantityInput(v.quantity),
    unit: blankToNull(v.unit),
    custom_unit_label: blankToNull(v.custom_unit_label),
    unit_value_cents: money(v.unit_value),
  };
}

export type IssueField =
  | "amount_mode"
  | "amount_min"
  | "amount_max"
  | "currency"
  | "in_kind_category"
  | "in_kind_provider"
  | "in_kind_description"
  | "estimated_value"
  | "unit_value"
  | "quantity"
  | "unit"
  | "custom_unit_label"
  | "card"
  | "option";

/** Which field a domain message points at. Unknown messages fall back to
 * the whole card — never dropped. */
export const DOMAIN_ERROR_FIELDS: Record<string, IssueField> = {
  "Choose how the amount is expressed.": "amount_mode",
  "Enter an amount greater than $0.": "amount_min",
  "Only a Range has an upper amount.": "amount_max",
  "Enter a lower amount greater than $0.": "amount_min",
  "Enter an upper amount greater than $0.": "amount_max",
  "The upper amount can't be less than the lower amount.": "amount_max",
  "An Undisclosed amount can't also have a number.": "amount_mode",
  "Currency must be a 3-letter code, like USD.": "currency",
  "Choose an In-Kind category.": "in_kind_category",
  "Choose who provides this.": "in_kind_provider",
  "Describe the In-Kind contribution.": "in_kind_description",
  "Keep the In-Kind description shorter.": "in_kind_description",
  "Estimated value must be greater than $0, or left blank.": "estimated_value",
  "Value per unit must be greater than $0, or left blank.": "unit_value",
  "A value per unit needs a quantity and a unit.": "unit_value",
  "Choose either an estimated total or a value per unit, not both.": "unit_value",
  "Enter a quantity greater than 0.": "quantity",
  "Choose a unit.": "unit",
  "Describe the custom unit.": "custom_unit_label",
  "Keep the custom unit label shorter.": "custom_unit_label",
};

export const VALUE_PER_UNIT_NEEDS_PAIR = "A value per unit needs a quantity and a unit.";

/** Quantity/unit as ONE logical pair, using the domain's own wording.
 * Points at whichever half is missing; never guesses a unit. */
export function quantityUnitIssue(
  c: Pick<ComponentState, "quantity" | "unit" | "custom_unit_label">,
  validateQuantityUnit: CommercialTermsValidators["validateQuantityUnit"]
): { field: IssueField; message: string } | null {
  const quantity = parseQuantityInput(c.quantity);
  const unit = c.unit === "" ? null : c.unit;
  const r = validateQuantityUnit({ quantity, unit, custom_unit_label: blankToNull(c.custom_unit_label) });
  if (r.ok) return null;
  if (quantity != null && unit == null) return { field: "unit", message: "Choose a unit." };
  if (quantity == null && unit != null) return { field: "quantity", message: r.error };
  return { field: DOMAIN_ERROR_FIELDS[r.error] ?? "quantity", message: r.error };
}

export interface CommercialTermsIssue {
  /** DOM id of the field to focus — see fieldId(). */
  id: string;
  optionIndex: number;
  componentIndex: number | null;
  field: IssueField;
  message: string;
  /** Shown as soon as it exists (a half-filled pair), rather than only
   * after a Save attempt (a still-empty required field). */
  immediate: boolean;
}

export const optionPrefix = (i: number) => `ct_${i}`;
export const componentPrefix = (i: number, j: number) => `ct_${i}_c_${j}`;
/** DOM ids are deliberately distinct from the submitted field names. */
export const fieldId = (prefix: string, field: IssueField | string) => `${prefix}__${field}`;

const IMMEDIATE_FIELDS: readonly IssueField[] = ["quantity", "unit", "custom_unit_label"];

/** Every issue the server would reject, found before submit. Component
 * issues come first; an Option-level issue (e.g. a Structured Option with
 * only optional In-Kind) is reported only once its components are clean,
 * matching the order validateOption itself checks in. */
export function collectCommercialTermsIssues(options: OptionState[], deps: CommercialTermsValidators): CommercialTermsIssue[] {
  const issues: CommercialTermsIssue[] = [];
  options.forEach((o, i) => {
    const components = o.commercial_mode === "custom" ? [] : o.components;
    let componentIssueCount = 0;
    const inputs: ComponentInput[] = [];
    components.forEach((c, j) => {
      const prefix = componentPrefix(i, j);
      const found: { field: IssueField; message: string }[] = [];
      const pairVisible = isMonetary(c.component_type) ? c.cover_open : true;
      const pair = pairVisible ? quantityUnitIssue(c, deps.validateQuantityUnit) : null;
      if (pair) found.push(pair);
      const input = toComponentInput(c, o.commercial_mode, deps.parseMoney);
      inputs.push(input);
      if (!pair && c.valuation === "per_unit" && input.unit_value_cents != null && !hasQuantityUnit(c)) {
        found.push({ field: "unit_value", message: VALUE_PER_UNIT_NEEDS_PAIR });
      }
      const r = deps.validateComponent(input);
      if (!r.ok) {
        const field = DOMAIN_ERROR_FIELDS[r.error] ?? "card";
        const pairMessage = field === "quantity" || field === "unit" || field === "custom_unit_label" || /quantity and a unit/.test(r.error);
        if (!(pair && pairMessage) && !found.some((f) => f.message === r.error)) found.push({ field, message: r.error });
      }
      for (const f of found) {
        issues.push({
          id: fieldId(prefix, f.field),
          optionIndex: i,
          componentIndex: j,
          field: f.field,
          message: f.message,
          immediate: IMMEDIATE_FIELDS.includes(f.field) || f.message === VALUE_PER_UNIT_NEEDS_PAIR,
        });
      }
      componentIssueCount += found.length;
    });
    if (componentIssueCount === 0) {
      const v = submittedOptionValues(o);
      const r = deps.validateOption({
        name: blankToNull(v.name),
        description: blankToNull(v.description),
        commercial_mode: v.commercial_mode,
        custom_terms_note: blankToNull(v.custom_terms_note),
        components: inputs,
      });
      if (!r.ok) issues.push({ id: fieldId(optionPrefix(i), "option"), optionIndex: i, componentIndex: null, field: "option", message: r.error, immediate: false });
    }
  });
  return issues;
}
