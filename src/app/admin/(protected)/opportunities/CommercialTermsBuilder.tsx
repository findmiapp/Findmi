"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import {
  AMOUNT_MODES,
  AMOUNT_MODE_LABELS,
  COMPONENT_TYPE_LABELS,
  CONTRIBUTION_UNITS,
  CONTRIBUTION_UNIT_LABELS,
  IN_KIND_CATEGORIES,
  IN_KIND_CATEGORY_LABELS,
  IN_KIND_PROVIDERS,
  IN_KIND_PROVIDER_LABELS,
  MONETARY_COMPONENT_TYPES,
  OPTION_COMMERCIAL_MODES,
  OPTION_COMMERCIAL_MODE_LABELS,
  calculateInKindEstimatedValueCents,
  formatMonetaryPerUnitEquivalent,
  isMonetaryComponentType,
  validateComponent,
  validateOption,
  validateQuantityUnit,
  type AmountMode,
  type ComponentType,
  type ContributionUnit,
  type InKindCategory,
  type InKindProvider,
  type MonetaryComponentType,
  type OptionCommercialMode,
} from "@/lib/opportunity-commercial-terms-domain";
import { parsePriceToCents } from "@/lib/opportunity-listings-domain";
import { PACKAGES_ENABLED } from "@/lib/opportunity-package-policy";
import {
  DEFAULT_CURRENCY,
  MONETARY_HEADINGS,
  amountFieldsFor,
  blocksComplimentary,
  closeCover,
  clearQuantityUnit,
  collectCommercialTermsIssues,
  componentPrefix,
  defaultInKindComponent,
  defaultMonetaryComponent,
  defaultOptionState,
  fieldId,
  hasQuantityUnit,
  isBrandItem,
  openValuation,
  optionChrome,
  parseQuantityInput,
  optionPrefix,
  optionToState,
  removeValuation,
  selectValuation,
  submittedComponentValues,
  submittedOptionValues,
  toComponentInput,
  type CommercialTermsIssue,
  type CommercialTermsValidators,
  type ComponentState,
  type InitialOption,
  type IssueField,
  type OptionState,
} from "@/lib/opportunity-commercial-terms-builder";

export type { InitialComponent, InitialOption } from "@/lib/opportunity-commercial-terms-builder";

// Opportunities Commercial Terms Admin Builder. Fully CONTROLLED (every
// value lives in React state); the submitted ct_{i}_* / ct_{i}_c_{j}_*
// fields are hidden inputs rendered from submittedOptionValues()/
// submittedComponentValues() (src/lib/opportunity-commercial-terms-
// builder.ts), so visible controls can use progressive disclosure without
// ever changing what the server's parseCommercialTermsForm reads. The
// server re-validates every value through validateOption()/
// validateComponent() — the pre-submit checks here run those same
// validators only to point the admin at the right field before saving.
//
// No drag-and-drop anywhere (Options reorder via Move Up/Down only,
// Components order deterministically: any monetary term first, then
// In-Kind terms in the order they were added — never manually reordered).

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

const VALIDATORS: CommercialTermsValidators = {
  validateQuantityUnit,
  validateComponent,
  validateOption,
  parseMoney: parsePriceToCents,
};

/** OpportunityForm calls validateForSubmit() before Save: false means a
 * known Commercial Terms problem is now shown and focused. */
export interface CommercialTermsBuilderHandle {
  validateForSubmit: () => boolean;
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

const singularUnit = (unit: ContributionUnit | "", customLabel: string): string => {
  if (unit === "") return "unit";
  if (unit === "custom") return customLabel.trim() || "unit";
  return CONTRIBUTION_UNIT_LABELS[unit].replace(/s$/, "").toLowerCase();
};

const inputClass = "w-full min-w-0 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none aria-[invalid=true]:border-red-300";
const labelClass = "mb-1 block text-xs font-medium text-ink/60";
const smallBtn = "rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink/70 transition hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
const dangerBtn = "rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40";
const linkBtn = "text-xs font-semibold text-findmi-700 underline-offset-2 hover:underline";
const quietBtn = "text-xs font-semibold text-ink/50 underline-offset-2 hover:text-ink hover:underline";
const modeBtn = (active: boolean) =>
  `rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide transition ${active ? "bg-findmi text-white" : "border border-black/10 bg-white text-ink/60 hover:text-ink"}`;
const chipClass = (active: boolean) =>
  `min-h-[2.25rem] rounded-full border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
    active ? "border-findmi bg-findmi text-white" : "border-black/10 bg-white text-ink/65 hover:border-ink/30 hover:text-ink"
  }`;

/** Would switching `option` to `next` discard real data? Used to gate a
 * confirm() before a destructive mode change — never a silent clear. */
function wouldDiscard(option: OptionState, next: OptionCommercialMode): boolean {
  if (next === option.commercial_mode) return false;
  if (option.components.length === 0) return false;
  if (next === "custom") return true;
  if (next === "complimentary") return option.components.some(blocksComplimentary);
  return false;
}

function Hidden({ name, value }: { name: string; value: string | number }) {
  return <input type="hidden" name={name} value={value} />;
}

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-medium text-red-700">{message}</p>;
}

/** Compact single-choice control for short, fixed lists (≤4 choices). */
function Chips<T extends string>({
  id,
  label,
  choices,
  value,
  onChange,
  invalid,
}: {
  id: string;
  label: string;
  choices: readonly (readonly [T, string])[];
  value: T | "";
  onChange: (next: T) => void;
  invalid?: boolean;
}) {
  return (
    <div id={id} tabIndex={-1} role="radiogroup" aria-label={label} aria-invalid={invalid || undefined} className="flex flex-wrap gap-1.5 focus:outline-none">
      {choices.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={chipClass(value === v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function MoneyInput({
  id,
  value,
  onChange,
  placeholder,
  showDollar,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  showDollar: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="relative">
      {showDollar && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink/45">$</span>}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        className={`${inputClass} ${showDollar ? "pl-7" : ""}`}
      />
    </div>
  );
}

/** Quantity + Unit as ONE logical pair: they clear together, and a half-
 * filled pair is flagged inline straight away (never a guessed unit). */
function QuantityUnitPair({
  prefix,
  component,
  onChange,
  errors,
  quantityPlaceholder,
}: {
  prefix: string;
  component: ComponentState;
  onChange: (patch: Partial<ComponentState>) => void;
  errors: Partial<Record<IssueField, string>>;
  quantityPlaceholder: string;
}) {
  const filled = component.quantity !== "" || component.unit !== "";
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-2">
        <input
          id={fieldId(prefix, "quantity")}
          type="text"
          inputMode="decimal"
          aria-label="Quantity"
          value={component.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          placeholder={quantityPlaceholder}
          aria-invalid={Boolean(errors.quantity) || undefined}
          className={inputClass}
        />
        <select
          id={fieldId(prefix, "unit")}
          aria-label="Unit"
          value={component.unit}
          onChange={(e) => onChange({ unit: e.target.value as ContributionUnit | "" })}
          aria-invalid={Boolean(errors.unit) || undefined}
          className={inputClass}
        >
          <option value="">Choose unit…</option>
          {CONTRIBUTION_UNITS.map((u) => (
            <option key={u} value={u}>
              {u === "custom" ? "Custom…" : CONTRIBUTION_UNIT_LABELS[u]}
            </option>
          ))}
        </select>
      </div>
      <FieldError message={errors.quantity ?? errors.unit} />
      {component.unit === "custom" && (
        <div className="mt-2">
          <input
            id={fieldId(prefix, "custom_unit_label")}
            type="text"
            aria-label="Custom unit"
            value={component.custom_unit_label}
            onChange={(e) => onChange({ custom_unit_label: e.target.value })}
            placeholder="Name the unit (e.g. Bottles)"
            aria-invalid={Boolean(errors.custom_unit_label) || undefined}
            className={inputClass}
          />
          <FieldError message={errors.custom_unit_label} />
        </div>
      )}
      {filled && (
        <button type="button" onClick={() => onChange(clearQuantityUnit())} className={`mt-1.5 ${quietBtn}`}>
          Clear
        </button>
      )}
    </div>
  );
}

function MonetaryFields({
  prefix,
  component,
  optionMode,
  onChange,
  errors,
}: {
  prefix: string;
  component: ComponentState;
  optionMode: OptionCommercialMode;
  onChange: (patch: Partial<ComponentState>) => void;
  errors: Partial<Record<IssueField, string>>;
}) {
  const fields = amountFieldsFor(component.amount_mode);
  const isUsd = (component.currency.trim() || DEFAULT_CURRENCY).toUpperCase() === DEFAULT_CURRENCY;
  const showDollar = isUsd && !component.currency_open;
  const preview = useMemo(() => {
    if (!component.cover_open || !hasQuantityUnit(component)) return null;
    const r = validateComponent(toComponentInput(component, optionMode, parsePriceToCents));
    return r.ok ? formatMonetaryPerUnitEquivalent(r.value) : null;
  }, [component, optionMode]);

  return (
    <>
      {fields.min && (
        <div className={fields.max ? "grid grid-cols-2 gap-2" : ""}>
          <label className="block min-w-0">
            {fields.max && <span className={labelClass}>{fields.minLabel}</span>}
            <MoneyInput
              id={fieldId(prefix, "amount_min")}
              value={component.amount_min}
              onChange={(v) => onChange({ amount_min: v })}
              placeholder="750"
              showDollar={showDollar}
              invalid={Boolean(errors.amount_min)}
            />
          </label>
          {fields.max && (
            <label className="block min-w-0">
              <span className={labelClass}>To</span>
              <MoneyInput
                id={fieldId(prefix, "amount_max")}
                value={component.amount_max}
                onChange={(v) => onChange({ amount_max: v })}
                placeholder="1500"
                showDollar={showDollar}
                invalid={Boolean(errors.amount_max)}
              />
            </label>
          )}
        </div>
      )}
      <FieldError message={errors.amount_min ?? errors.amount_max} />

      <Chips<AmountMode>
        id={fieldId(prefix, "amount_mode")}
        label="Amount type"
        choices={AMOUNT_MODES.map((m) => [m, AMOUNT_MODE_LABELS[m]] as const)}
        value={component.amount_mode}
        onChange={(m) => onChange({ amount_mode: m })}
        invalid={Boolean(errors.amount_mode)}
      />
      <FieldError message={errors.amount_mode} />

      {/* Currency stays submitted exactly as before (USD default) — just
         out of the way on the normal USD path. */}
      {component.currency_open ? (
        <label className="block">
          <span className={labelClass}>Currency</span>
          <input
            id={fieldId(prefix, "currency")}
            type="text"
            value={component.currency}
            onChange={(e) => onChange({ currency: e.target.value.toUpperCase() })}
            maxLength={3}
            aria-invalid={Boolean(errors.currency) || undefined}
            className={`${inputClass} w-24`}
          />
          <FieldError message={errors.currency} />
        </label>
      ) : (
        <p className="text-xs text-ink/45">
          {(component.currency.trim() || DEFAULT_CURRENCY).toUpperCase()} ·{" "}
          <button type="button" onClick={() => onChange({ currency_open: true })} className={linkBtn}>
            Change
          </button>
        </p>
      )}

      {/* quantity/unit are purely DESCRIPTIVE on a monetary term: the amount
         above stays the one authoritative total. */}
      {component.cover_open ? (
        <div className="rounded-xl bg-black/[0.03] p-2.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-ink/60">What Does This Cover?</span>
            <button type="button" onClick={() => onChange(closeCover())} className={quietBtn}>
              Remove
            </button>
          </div>
          <QuantityUnitPair prefix={prefix} component={component} onChange={onChange} errors={errors} quantityPlaceholder="3" />
          {preview && <p className="mt-1.5 text-xs text-ink/50">{preview}</p>}
        </div>
      ) : (
        <button type="button" onClick={() => onChange({ cover_open: true })} className={`self-start ${linkBtn}`}>
          + What Does This Cover? <span className="font-normal text-ink/45">(optional)</span>
        </button>
      )}
    </>
  );
}

function InKindFields({
  prefix,
  component,
  optionMode,
  onChange,
  errors,
}: {
  prefix: string;
  component: ComponentState;
  optionMode: OptionCommercialMode;
  onChange: (patch: Partial<ComponentState>) => void;
  errors: Partial<Record<IssueField, string>>;
}) {
  const pairReady = hasQuantityUnit(component);
  // Live preview only (never posted): depends on just quantity × value
  // per unit, so it shows before unrelated fields (e.g. Type) are filled.
  const calculated = useMemo(() => {
    if (component.valuation !== "per_unit" || !pairReady) return null;
    const quantity = parseQuantityInput(component.quantity);
    const unitValueCents = parsePriceToCents(component.unit_value);
    if (quantity == null || unitValueCents == null || !Number.isInteger(unitValueCents) || unitValueCents <= 0) return null;
    const cents = calculateInKindEstimatedValueCents({ quantity, unit_value_cents: unitValueCents, estimated_value_cents: null });
    return cents == null ? null : formatUsd(cents);
  }, [component.valuation, component.quantity, component.unit_value, pairReady]);

  return (
    <>
      <label className="block">
        <span className={labelClass}>
          What Is Being Provided?{component.in_kind_category === "other" ? " (required for Other)" : ""}
        </span>
        <input
          id={fieldId(prefix, "in_kind_description")}
          type="text"
          value={component.in_kind_description}
          onChange={(e) => onChange({ in_kind_description: e.target.value })}
          placeholder="e.g. Bottles of Tost, Brand Ambassador, Venue Space"
          aria-invalid={Boolean(errors.in_kind_description) || undefined}
          className={inputClass}
        />
        <FieldError message={errors.in_kind_description} />
      </label>

      {/* quantity/unit are optional measurement metadata ("24 Bottles"). */}
      <div>
        <span className={labelClass}>Amount (optional)</span>
        <QuantityUnitPair prefix={prefix} component={component} onChange={onChange} errors={errors} quantityPlaceholder="24" />
      </div>

      <div>
        <span className={labelClass}>Provided By</span>
        <Chips<InKindProvider>
          id={fieldId(prefix, "in_kind_provider")}
          label="Provided By"
          choices={IN_KIND_PROVIDERS.map((p) => [p, IN_KIND_PROVIDER_LABELS[p]] as const)}
          value={component.in_kind_provider}
          onChange={(p) => onChange({ in_kind_provider: p })}
          invalid={Boolean(errors.in_kind_provider)}
        />
        <FieldError message={errors.in_kind_provider} />
      </div>

      <label className="block">
        <span className={labelClass}>Type</span>
        <select
          id={fieldId(prefix, "in_kind_category")}
          value={component.in_kind_category}
          onChange={(e) => onChange({ in_kind_category: e.target.value as InKindCategory })}
          aria-invalid={Boolean(errors.in_kind_category) || undefined}
          className={inputClass}
        >
          <option value="" disabled>
            Choose…
          </option>
          {IN_KIND_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {IN_KIND_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <FieldError message={errors.in_kind_category} />
      </label>

      {optionMode === "structured" || !isBrandItem(component) ? (
        <Chips<"required" | "optional">
          id={fieldId(prefix, "in_kind_required")}
          label="Required or optional"
          choices={[
            ["required", "Required"],
            ["optional", "Optional"],
          ]}
          value={component.in_kind_required ? "required" : "optional"}
          onChange={(v) => onChange({ in_kind_required: v === "required" })}
        />
      ) : (
        <p className="text-xs text-ink/45">Optional — a Complimentary Option never requires anything from the Business.</p>
      )}

      {/* Estimated value: none by default. Choosing a method is real state,
         so its input appears even while still empty; the other method's
         value is cleared (exactly one valuation, or none). */}
      {component.valuation_open ? (
        <div className="rounded-xl bg-black/[0.03] p-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-ink/60">Estimated Value</span>
            <button type="button" onClick={() => onChange(removeValuation())} className={quietBtn}>
              Remove Value
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => onChange(selectValuation("total"))} className={chipClass(component.valuation === "total")} aria-pressed={component.valuation === "total"}>
              Estimated Total
            </button>
            <button
              type="button"
              onClick={() => onChange(selectValuation("per_unit"))}
              disabled={!pairReady && component.valuation !== "per_unit"}
              className={chipClass(component.valuation === "per_unit")}
              aria-pressed={component.valuation === "per_unit"}
            >
              Value Per Unit
            </button>
          </div>
          {!pairReady && <p className="mt-1.5 text-xs text-ink/45">Value Per Unit needs an Amount and unit above.</p>}
          {component.valuation === "total" && (
            <label className="mt-2 block">
              <span className={labelClass}>Estimated Total</span>
              <div className="w-40 max-w-full">
                <MoneyInput
                  id={fieldId(prefix, "estimated_value")}
                  value={component.estimated_value}
                  onChange={(v) => onChange({ estimated_value: v })}
                  placeholder="2500"
                  showDollar
                  invalid={Boolean(errors.estimated_value)}
                />
              </div>
              <FieldError message={errors.estimated_value} />
            </label>
          )}
          {component.valuation === "per_unit" && (
            <label className="mt-2 block">
              <span className={labelClass}>Value Per {singularUnit(component.unit, component.custom_unit_label)}</span>
              <div className="w-40 max-w-full">
                <MoneyInput
                  id={fieldId(prefix, "unit_value")}
                  value={component.unit_value}
                  onChange={(v) => onChange({ unit_value: v })}
                  placeholder="2.00"
                  showDollar
                  invalid={Boolean(errors.unit_value)}
                />
              </div>
              <FieldError message={errors.unit_value} />
              {calculated && <p className="mt-1 text-xs text-ink/50">Calculated Estimated Value: {calculated}</p>}
            </label>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => onChange(openValuation())} className={`self-start ${linkBtn}`}>
          + Add Estimated Value
        </button>
      )}
    </>
  );
}

function ComponentRow({
  prefix,
  component,
  onChange,
  onRemove,
  optionMode,
  errors,
}: {
  prefix: string;
  component: ComponentState;
  onChange: (patch: Partial<ComponentState>) => void;
  onRemove: () => void;
  optionMode: OptionCommercialMode;
  errors: Partial<Record<IssueField, string>>;
}) {
  const monetary = isMonetaryComponentType(component.component_type);
  const submitted = submittedComponentValues(component, optionMode);
  return (
    <div id={fieldId(prefix, "card")} tabIndex={-1} className="flex min-w-0 flex-col gap-3 rounded-xl border border-black/10 bg-white/70 p-3 focus:outline-none">
      {Object.entries(submitted).map(([field, value]) => (
        <Hidden key={field} name={`${prefix}_${field}`} value={value} />
      ))}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-xs font-bold uppercase tracking-wide text-ink/50">
            {monetary ? MONETARY_HEADINGS[component.component_type as MonetaryComponentType] : COMPONENT_TYPE_LABELS.in_kind}
          </span>
          {monetary && component.component_type !== "project_budget" && (
            <span className="block text-xs text-ink/40">{COMPONENT_TYPE_LABELS[component.component_type as ComponentType]}</span>
          )}
        </div>
        <button type="button" onClick={onRemove} className={dangerBtn}>
          Remove Term
        </button>
      </div>
      <FieldError message={errors.card} />
      {monetary ? (
        <MonetaryFields prefix={prefix} component={component} optionMode={optionMode} onChange={onChange} errors={errors} />
      ) : (
        <InKindFields prefix={prefix} component={component} optionMode={optionMode} onChange={onChange} errors={errors} />
      )}
    </div>
  );
}

function OptionCard({
  index,
  total,
  option,
  errorsByPrefix,
  onPatch,
  onPatchComponent,
  onAddComponent,
  onRemoveComponent,
  onDuplicate,
  onRemove,
  onMove,
}: {
  index: number;
  total: number;
  option: OptionState;
  errorsByPrefix: Map<string, Partial<Record<IssueField, string>>>;
  onPatch: (patch: Partial<OptionState>) => void;
  onPatchComponent: (compKey: string, patch: Partial<ComponentState>) => void;
  onAddComponent: (type: ComponentType) => void;
  onRemoveComponent: (compKey: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const prefix = optionPrefix(index);
  const chrome = optionChrome(total, PACKAGES_ENABLED);
  const usedMonetary = option.components.find((c) => isMonetaryComponentType(c.component_type))?.component_type ?? null;
  const submitted = submittedOptionValues(option);
  const optionError = errorsByPrefix.get(prefix)?.option;

  function setMode(next: OptionCommercialMode) {
    if (wouldDiscard(option, next)) {
      const ok = window.confirm(
        next === "custom"
          ? "Switching to Custom Terms removes this Option's structured commercial terms. Continue?"
          : "Switching to Complimentary removes this Option's monetary terms and anything required from the Business. Continue?"
      );
      if (!ok) return;
    }
    if (next === "custom") onPatch({ commercial_mode: next, components: [] });
    else if (next === "complimentary") onPatch({ commercial_mode: next, components: option.components.filter((c) => !blocksComplimentary(c)) });
    else onPatch({ commercial_mode: next });
  }

  return (
    <div className={chrome.showHeader ? "min-w-0 rounded-2xl border border-black/10 bg-white/60 p-3 sm:p-4" : "min-w-0"}>
      <Hidden name={`${prefix}_id`} value={submitted.id} />
      <Hidden name={`${prefix}_comp_count`} value={option.components.length} />
      <Hidden name={`${prefix}_name`} value={submitted.name} />
      <Hidden name={`${prefix}_description`} value={submitted.description} />
      <Hidden name={`${prefix}_commercial_mode`} value={submitted.commercial_mode} />
      <Hidden name={`${prefix}_custom_terms_note`} value={submitted.custom_terms_note} />

      {chrome.showHeader && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="self-start rounded-full bg-black/5 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-ink/50">Option {index + 1}</span>
          <input
            type="text"
            aria-label={`Option ${index + 1} name`}
            value={option.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            placeholder="Option name (e.g. Resident Demo + Content)"
            className={`${inputClass} sm:max-w-xs`}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {OPTION_COMMERCIAL_MODES.map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={modeBtn(option.commercial_mode === m)}>
            {OPTION_COMMERCIAL_MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {option.commercial_mode === "custom" && (
        <div className="mt-3">
          <textarea
            aria-label="Custom terms"
            value={option.custom_terms_note}
            onChange={(e) => onPatch({ custom_terms_note: e.target.value })}
            rows={3}
            placeholder="Describe the negotiated arrangement…"
            className={`${inputClass} resize-y`}
          />
        </div>
      )}

      <div id={fieldId(prefix, "option")} tabIndex={-1} className="focus:outline-none">
        <FieldError message={optionError} />
      </div>

      {option.commercial_mode !== "custom" && (
        <div className="mt-3 flex flex-col gap-2">
          {option.components.map((c, j) => {
            const compPrefix = componentPrefix(index, j);
            return (
              <ComponentRow
                key={c.key}
                prefix={compPrefix}
                component={c}
                optionMode={option.commercial_mode}
                errors={errorsByPrefix.get(compPrefix) ?? {}}
                onChange={(patch) => onPatchComponent(c.key, patch)}
                onRemove={() => onRemoveComponent(c.key)}
              />
            );
          })}

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink/50">+ Add Term:</span>
            {option.commercial_mode === "structured" &&
              MONETARY_COMPONENT_TYPES.map((t) => (
                <button key={t} type="button" disabled={usedMonetary != null} onClick={() => onAddComponent(t)} className={smallBtn} title={usedMonetary != null ? "An Option can only have one monetary term" : undefined}>
                  {COMPONENT_TYPE_LABELS[t]}
                </button>
              ))}
            <button type="button" onClick={() => onAddComponent("in_kind")} className={smallBtn}>
              In-Kind
            </button>
          </div>
        </div>
      )}

      {(chrome.showMove || chrome.showDuplicate || chrome.showRemove) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3">
          {chrome.showMove && (
            <>
              <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className={smallBtn}>
                Move Up
              </button>
              <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className={smallBtn}>
                Move Down
              </button>
            </>
          )}
          {chrome.showDuplicate && (
            <button type="button" onClick={onDuplicate} className={smallBtn}>
              Duplicate Option
            </button>
          )}
          {chrome.showRemove && (
            <button type="button" onClick={onRemove} disabled={total <= 1} className={dangerBtn}>
              Remove Option
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function groupIssues(issues: CommercialTermsIssue[]): Map<string, Partial<Record<IssueField, string>>> {
  const map = new Map<string, Partial<Record<IssueField, string>>>();
  for (const issue of issues) {
    const prefix = issue.componentIndex == null ? optionPrefix(issue.optionIndex) : componentPrefix(issue.optionIndex, issue.componentIndex);
    const entry = map.get(prefix) ?? {};
    if (!entry[issue.field]) entry[issue.field] = issue.message;
    map.set(prefix, entry);
  }
  return map;
}

const CommercialTermsBuilder = forwardRef<
  CommercialTermsBuilderHandle,
  {
    initialOptions: InitialOption[];
    /** Fires whenever the FIRST Option's commercial_mode changes, so a
     * parent form can keep its own unrelated Credits Eligible control in
     * sync (legacy credits_eligible has no meaning without an amount to
     * apply credits to — the same rule the old Pricing Mode dropdown
     * enforced for 'complimentary'). Optional — the builder works
     * standalone without it. */
    onFirstOptionModeChange?: (firstOptionComplimentary: boolean) => void;
  }
>(function CommercialTermsBuilder({ initialOptions, onFirstOptionModeChange }, ref) {
  const [options, setOptions] = useState<OptionState[]>(() =>
    initialOptions.length ? initialOptions.map((o) => optionToState(o, newKey)) : [defaultOptionState(newKey())]
  );
  /** After a Save attempt, every known issue is shown (not just the
   * half-filled quantity/unit pairs shown while typing). */
  const [showAll, setShowAll] = useState(false);
  const issues = useMemo(() => collectCommercialTermsIssues(options, VALIDATORS), [options]);
  const visible = useMemo(() => groupIssues(showAll ? issues : issues.filter((i) => i.immediate)), [issues, showAll]);

  useImperativeHandle(
    ref,
    () => ({
      validateForSubmit() {
        if (issues.length === 0) return true;
        setShowAll(true);
        const firstId = issues[0].id;
        requestAnimationFrame(() => {
          const el = document.getElementById(firstId) ?? document.getElementById(fieldId(componentPrefix(issues[0].optionIndex, issues[0].componentIndex ?? 0), "card"));
          el?.scrollIntoView({ block: "center", behavior: "smooth" });
          el?.focus({ preventScroll: true });
        });
        return false;
      },
    }),
    [issues]
  );

  useEffect(() => {
    onFirstOptionModeChange?.(options[0]?.commercial_mode === "complimentary");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options[0]?.commercial_mode]);

  function patchOption(key: string, patch: Partial<OptionState>) {
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }
  function patchComponent(optKey: string, compKey: string, patch: Partial<ComponentState>) {
    setOptions((prev) => prev.map((o) => (o.key !== optKey ? o : { ...o, components: o.components.map((c) => (c.key === compKey ? { ...c, ...patch } : c)) })));
  }
  function addComponent(optKey: string, type: ComponentType) {
    setOptions((prev) =>
      prev.map((o) => {
        if (o.key !== optKey) return o;
        if (isMonetaryComponentType(type)) {
          // Mutual exclusivity enforced here too, not just by disabling the
          // picker button — a monetary term always REPLACES any existing one.
          return { ...o, components: [defaultMonetaryComponent(type, newKey()), ...o.components.filter((c) => !isMonetaryComponentType(c.component_type))] };
        }
        return { ...o, components: [...o.components, defaultInKindComponent(o.commercial_mode !== "complimentary", newKey())] };
      })
    );
  }
  function removeComponent(optKey: string, compKey: string) {
    setOptions((prev) => prev.map((o) => (o.key !== optKey ? o : { ...o, components: o.components.filter((c) => c.key !== compKey) })));
  }
  function addOption() {
    setOptions((prev) => [...prev, defaultOptionState(newKey())]);
  }
  function removeOption(key: string) {
    setOptions((prev) => (prev.length <= 1 ? prev : prev.filter((o) => o.key !== key)));
  }
  function duplicateOption(key: string) {
    setOptions((prev) => {
      const idx = prev.findIndex((o) => o.key === key);
      if (idx < 0) return prev;
      const clone: OptionState = { ...prev[idx], key: newKey(), id: null, components: prev[idx].components.map((c) => ({ ...c, key: newKey() })) };
      return [...prev.slice(0, idx + 1), clone, ...prev.slice(idx + 1)];
    });
  }
  function moveOption(key: string, dir: -1 | 1) {
    setOptions((prev) => {
      const idx = prev.findIndex((o) => o.key === key);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
  }

  const chrome = optionChrome(options.length, PACKAGES_ENABLED);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Hidden name="ct_count" value={options.length} />
      {options.map((o, i) => (
        <OptionCard
          key={o.key}
          index={i}
          total={options.length}
          option={o}
          errorsByPrefix={visible}
          onPatch={(patch) => patchOption(o.key, patch)}
          onPatchComponent={(compKey, patch) => patchComponent(o.key, compKey, patch)}
          onAddComponent={(type) => addComponent(o.key, type)}
          onRemoveComponent={(compKey) => removeComponent(o.key, compKey)}
          onDuplicate={() => duplicateOption(o.key)}
          onRemove={() => removeOption(o.key)}
          onMove={(dir) => moveOption(o.key, dir)}
        />
      ))}
      {!chrome.showAdd && options.length > 1 && (
        <p className="rounded-xl bg-black/[0.03] px-3.5 py-2.5 text-xs text-ink/55">
          This Opportunity has {options.length} packages. They can be edited or removed, but new packages can&rsquo;t be added yet — and Businesses are asked to
          contact Findmi to choose a package rather than responding here.
        </p>
      )}
      {chrome.showAdd &&
        (chrome.showHeader ? (
          <button type="button" onClick={addOption} className="self-start rounded-full border border-dashed border-black/15 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink/50 transition hover:border-ink/30 hover:text-ink">
            {chrome.addLabel}
          </button>
        ) : (
          <button type="button" onClick={addOption} className={`self-start border-t border-black/5 pt-3 ${quietBtn}`}>
            {chrome.addLabel}
          </button>
        ))}
    </div>
  );
});

export default CommercialTermsBuilder;
