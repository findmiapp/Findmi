// Opportunities — Commercial Terms Admin Builder (Pass 2): parses the
// builder's submitted FormData into OptionInput[] and runs EVERY option
// through validateOption() (Pass 1, unmodified) — never a second,
// divergent implementation of those rules. This is the one place the
// Admin Server Actions (actions.ts) read the builder's own form fields;
// actions.ts calls parseCommercialTermsForm() and nothing else touches
// these field names.
//
// Field naming is deliberately flat and explicit — NOT one JSON blob
// through a hidden input — so every value is an individually-typed form
// field read through the same str/num/bool parsers every other admin form
// uses, exactly like any other repeating-group admin form
// (CheckboxList/RelationField are the closest existing precedent for
// "more than one of something" in one POST): `ct_count` is how many
// Options were submitted; for option index i, `ct_{i}_*` holds that
// Option's own fields and `ct_{i}_comp_count` is how many Components it
// has; for component index j of option i, `ct_{i}_c_{j}_*` holds that
// Component's fields. Ordering in the submitted indices IS the Option/
// Component display_order (the builder always re-renders its current
// array order before submit, including after Move Up/Down).
//
// Relative imports only (no "@/" aliases) so this stays testable by plain
// import, the same convention as every other dependency-free domain
// module in this codebase.

import { str, num, bool } from "./admin/form-helpers";
import { parsePriceToCents } from "./opportunity-listings-domain";
import { validateOption, type ComponentInput, type OptionInput } from "./opportunity-commercial-terms-domain";
import type { OptionForPersistence } from "./opportunity-commercial-terms-bridge";

const MAX_OPTIONS = 20;
const MAX_COMPONENTS_PER_OPTION = 20;

function dollarsToCents(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  return parsePriceToCents(raw);
}

/** Decimal quantity (numeric(10,2) — "2.5" is legitimate). Blank -> null;
 * anything non-numeric -> NaN, which validateComponent's own Number.
 * isFinite check rejects with a friendly message — never trusted as-is. */
function parseQuantity(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : Number.NaN;
}

function readComponent(fd: FormData, prefix: string): ComponentInput {
  return {
    component_type: str(fd, `${prefix}_type`),
    amount_mode: str(fd, `${prefix}_amount_mode`),
    amount_min_cents: dollarsToCents(str(fd, `${prefix}_amount_min`)),
    amount_max_cents: dollarsToCents(str(fd, `${prefix}_amount_max`)),
    currency: str(fd, `${prefix}_currency`),
    in_kind_category: str(fd, `${prefix}_in_kind_category`),
    in_kind_description: str(fd, `${prefix}_in_kind_description`),
    in_kind_provider: str(fd, `${prefix}_in_kind_provider`),
    in_kind_required: bool(fd, `${prefix}_in_kind_required`),
    estimated_value_cents: dollarsToCents(str(fd, `${prefix}_estimated_value`)),
    // Pass 2.5 — unit-based contribution fields. unit_value_cents is parsed
    // from the same dollars-to-cents helper as every other money field in
    // this file; it's validateComponent() (not this file) that rejects it
    // on a monetary component.
    quantity: parseQuantity(str(fd, `${prefix}_quantity`)),
    unit: str(fd, `${prefix}_unit`),
    custom_unit_label: str(fd, `${prefix}_custom_unit_label`),
    unit_value_cents: dollarsToCents(str(fd, `${prefix}_unit_value`)),
  };
}

/** Parses + validates the whole Commercial Terms builder submission.
 * Returns the first validation error exactly as validateOption/
 * validateComponent phrase it — the builder never gets its own, different
 * wording for the same rule. `id` on each returned Option is the existing
 * DB id (preserve-on-edit) or null (new/duplicated Option — the RPC
 * inserts fresh). */
export function parseCommercialTermsForm(formData: FormData): { ok: true; value: OptionForPersistence[] } | { ok: false; error: string } {
  const optionCount = num(formData, "ct_count") ?? 0;
  if (optionCount < 1) return { ok: false, error: "Add at least one Commercial Terms option." };
  if (optionCount > MAX_OPTIONS) return { ok: false, error: "That's too many options — remove some first." };

  const options: OptionForPersistence[] = [];
  for (let i = 0; i < optionCount; i++) {
    const prefix = `ct_${i}`;
    const id = str(formData, `${prefix}_id`);
    const compCount = num(formData, `${prefix}_comp_count`) ?? 0;
    if (compCount > MAX_COMPONENTS_PER_OPTION) return { ok: false, error: "That's too many commercial terms on one option — remove some first." };

    const components: ComponentInput[] = [];
    for (let j = 0; j < compCount; j++) {
      components.push(readComponent(formData, `${prefix}_c_${j}`));
    }

    const input: OptionInput = {
      name: str(formData, `${prefix}_name`),
      description: str(formData, `${prefix}_description`),
      commercial_mode: str(formData, `${prefix}_commercial_mode`),
      custom_terms_note: str(formData, `${prefix}_custom_terms_note`),
      components,
    };
    const result = validateOption(input);
    if (!result.ok) return result;
    options.push({ ...result.value, id });
  }
  return { ok: true, value: options };
}
