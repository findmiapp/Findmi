"use client";

import { useEffect, useState } from "react";
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
  calculateUnitValueCents,
  isMonetaryComponentType,
  type AmountMode,
  type ComponentType,
  type ContributionUnit,
  type InKindCategory,
  type InKindProvider,
  type MonetaryComponentType,
  type OptionCommercialMode,
} from "@/lib/opportunity-commercial-terms-domain";

// Opportunities Commercial Terms Admin Builder (Pass 2). Replaces the old
// "Investment" pricing-mode dropdown inside OpportunityForm with the full
// Option -> Component authoring surface. Fully CONTROLLED (every value
// lives in React state) rather than uncontrolled inputs read back out of
// the DOM — Duplicate/Remove/Reorder all operate on that same state array,
// and the visible inputs ARE the submitted form fields (name={...}),
// giving the server typed, individually-named fields (ct_{i}_*, ct_{i}_c_
// {j}_*) rather than one opaque JSON blob through a hidden input. The
// server (parseCommercialTermsForm, src/lib/opportunity-commercial-terms-
// form.ts) re-validates every value through validateOption()/
// validateComponent() exactly as committed in Pass 1 — nothing here is
// trusted as pre-validated.
//
// No drag-and-drop anywhere (Options reorder via Move Up/Down only,
// Components order deterministically: any monetary term first, then
// In-Kind terms in the order they were added — never manually reordered).

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

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

interface ComponentState {
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
  // Pass 2.5 — unit-based contribution fields. Shared by monetary
  // (descriptive only) and In-Kind (measurable); unit_value is In-Kind
  // only. estimated_value/unit_value are mutually exclusive by
  // construction (see valuationModeOf below) — the UI never lets both
  // hold a value at once.
  quantity: string;
  unit: ContributionUnit | "";
  custom_unit_label: string;
  unit_value: string;
}

interface OptionState {
  key: string;
  id: string | null;
  name: string;
  description: string;
  commercial_mode: OptionCommercialMode;
  custom_terms_note: string;
  components: ComponentState[];
}

const centsToStr = (c: number | null): string => (c == null ? "" : c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));

/** Client-side-only preview helpers (the "Equivalent to $X/unit" and
 * "Calculated Estimated Value" lines) — never authoritative. The server
 * (validateComponent/calculateUnitValueCents, src/lib/opportunity-
 * commercial-terms-domain.ts) is the one source of truth re-computed on
 * every save; these exist only so the admin sees a live number while
 * typing. */
function dollarsToCentsPreview(raw: string): number | null {
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function formatDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

function componentToState(c: InitialComponent): ComponentState {
  return {
    key: newKey(),
    component_type: c.component_type,
    amount_mode: c.amount_mode ?? "",
    amount_min: centsToStr(c.amount_min_cents),
    amount_max: centsToStr(c.amount_max_cents),
    currency: c.currency ?? "USD",
    in_kind_category: c.in_kind_category ?? "",
    in_kind_description: c.in_kind_description ?? "",
    in_kind_provider: c.in_kind_provider ?? "",
    in_kind_required: c.in_kind_required,
    estimated_value: centsToStr(c.estimated_value_cents),
    quantity: c.quantity == null ? "" : String(c.quantity),
    unit: c.unit ?? "",
    custom_unit_label: c.custom_unit_label ?? "",
    unit_value: centsToStr(c.unit_value_cents),
  };
}

function optionToState(o: InitialOption): OptionState {
  return {
    key: newKey(),
    id: o.id,
    name: o.name ?? "",
    description: o.description ?? "",
    commercial_mode: o.commercial_mode,
    custom_terms_note: o.custom_terms_note ?? "",
    components: o.components.map(componentToState),
  };
}

function defaultOptionState(): OptionState {
  return { key: newKey(), id: null, name: "", description: "", commercial_mode: "structured", custom_terms_note: "", components: [] };
}

function defaultMonetaryComponent(type: MonetaryComponentType): ComponentState {
  return {
    key: newKey(),
    component_type: type,
    amount_mode: "fixed",
    amount_min: "",
    amount_max: "",
    currency: "USD",
    in_kind_category: "",
    in_kind_description: "",
    in_kind_provider: "",
    in_kind_required: true,
    estimated_value: "",
    quantity: "",
    unit: "",
    custom_unit_label: "",
    unit_value: "",
  };
}

function defaultInKindComponent(required: boolean): ComponentState {
  return {
    key: newKey(),
    component_type: "in_kind",
    amount_mode: "",
    amount_min: "",
    amount_max: "",
    currency: "",
    in_kind_category: "",
    in_kind_description: "",
    in_kind_provider: "",
    in_kind_required: required,
    estimated_value: "",
    quantity: "",
    unit: "",
    custom_unit_label: "",
    unit_value: "",
  };
}

type ValuationMode = "none" | "total" | "per_unit";

/** Derived, never stored separately — mutual exclusion lives in which of
 * the two string fields is non-empty, exactly mirroring the DB/domain
 * invariant that only one of estimated_value_cents/unit_value_cents may
 * be set. */
function valuationModeOf(c: ComponentState): ValuationMode {
  if (c.unit_value) return "per_unit";
  if (c.estimated_value) return "total";
  return "none";
}

const UNIT_LABEL_SINGULAR = (unit: ContributionUnit | "", customLabel: string): string => {
  if (unit === "") return "unit";
  if (unit === "custom") return customLabel || "unit";
  return CONTRIBUTION_UNIT_LABELS[unit].replace(/s$/, "").toLowerCase();
};

const inputClass = "w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none";
const smallBtn = "rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink/70 transition hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
const dangerBtn = "rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40";
const modeBtn = (active: boolean) =>
  `rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide transition ${active ? "bg-findmi text-white" : "border border-black/10 bg-white text-ink/60 hover:text-ink"}`;

/** Would switching `option` to `next` discard real data? Used to gate a
 * confirm() before a destructive mode change — never a silent clear. */
function wouldDiscard(option: OptionState, next: OptionCommercialMode): boolean {
  if (next === option.commercial_mode) return false;
  if (option.components.length === 0) return false;
  if (next === "custom") return true;
  if (next === "complimentary") return option.components.some((c) => c.component_type !== "in_kind" || c.in_kind_required);
  return false;
}

function Hidden({ name, value }: { name: string; value: string | number | boolean }) {
  return <input type="hidden" name={name} value={typeof value === "boolean" ? (value ? "on" : "") : value} />;
}

function ComponentRow({
  prefix,
  component,
  onChange,
  onRemove,
  optionMode,
}: {
  prefix: string;
  component: ComponentState;
  onChange: (patch: Partial<ComponentState>) => void;
  onRemove: () => void;
  optionMode: OptionCommercialMode;
}) {
  const monetary = isMonetaryComponentType(component.component_type);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-black/10 bg-white/70 p-3">
      <Hidden name={`${prefix}_type`} value={component.component_type} />
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-ink/50">
          {monetary ? COMPONENT_TYPE_LABELS[component.component_type as ComponentType] : "In-Kind Term"}
        </span>
        <button type="button" onClick={onRemove} className={dangerBtn}>
          Remove Term
        </button>
      </div>

      {monetary ? (
        <>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink/60">Amount</span>
            <select
              name={`${prefix}_amount_mode`}
              value={component.amount_mode}
              onChange={(e) => onChange({ amount_mode: e.target.value as AmountMode })}
              className={inputClass}
            >
              {AMOUNT_MODES.map((m) => (
                <option key={m} value={m}>
                  {AMOUNT_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          {component.amount_mode !== "undisclosed" && (
            <div className="grid grid-cols-[1fr_1fr_4.5rem] gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink/60">{component.amount_mode === "range" ? "From" : "Amount"}</span>
                <input
                  type="text"
                  name={`${prefix}_amount_min`}
                  value={component.amount_min}
                  onChange={(e) => onChange({ amount_min: e.target.value })}
                  placeholder="750"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink/60">{component.amount_mode === "range" ? "To" : ""}</span>
                <input
                  type="text"
                  name={`${prefix}_amount_max`}
                  value={component.amount_max}
                  onChange={(e) => onChange({ amount_max: e.target.value })}
                  disabled={component.amount_mode !== "range"}
                  placeholder={component.amount_mode === "range" ? "1500" : ""}
                  className={`${inputClass} disabled:bg-black/[0.03]`}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink/60">Currency</span>
                <input
                  type="text"
                  name={`${prefix}_currency`}
                  value={component.currency}
                  onChange={(e) => onChange({ currency: e.target.value.toUpperCase() })}
                  className={inputClass}
                />
              </label>
            </div>
          )}
          {component.amount_mode === "undisclosed" && <Hidden name={`${prefix}_currency`} value={component.currency || "USD"} />}

          {/* Pass 2.5 — quantity/unit are purely DESCRIPTIVE on a monetary
             term: the amount above stays the one authoritative total; a
             per-unit figure is calculated for display only, never stored,
             never shown for Range/Undisclosed (no single number to divide). */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink/60">Quantity (optional)</span>
              <input
                type="text"
                name={`${prefix}_quantity`}
                value={component.quantity}
                onChange={(e) => onChange({ quantity: e.target.value })}
                placeholder="3"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink/60">Unit</span>
              <select
                name={`${prefix}_unit`}
                value={component.unit}
                onChange={(e) => onChange({ unit: e.target.value as ContributionUnit })}
                className={inputClass}
              >
                <option value="">No unit</option>
                {CONTRIBUTION_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {CONTRIBUTION_UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {component.unit === "custom" ? (
            <input
              type="text"
              name={`${prefix}_custom_unit_label`}
              value={component.custom_unit_label}
              onChange={(e) => onChange({ custom_unit_label: e.target.value })}
              placeholder="Describe the unit (e.g. Road Trips)"
              className={inputClass}
            />
          ) : (
            <Hidden name={`${prefix}_custom_unit_label`} value={component.custom_unit_label} />
          )}
          {component.quantity &&
            component.unit &&
            (component.amount_mode === "fixed" || component.amount_mode === "starting_at") &&
            component.amount_min &&
            (() => {
              const qty = Number(component.quantity);
              const totalCents = dollarsToCentsPreview(component.amount_min);
              if (!Number.isFinite(qty) || qty <= 0 || totalCents == null) return null;
              const perUnit = formatDollars(Math.round(totalCents / qty));
              return (
                <p className="text-xs text-ink/50">
                  Equivalent to {perUnit} / {UNIT_LABEL_SINGULAR(component.unit, component.custom_unit_label)} (for display only — not stored)
                </p>
              );
            })()}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink/60">Category</span>
              <select
                name={`${prefix}_in_kind_category`}
                value={component.in_kind_category}
                onChange={(e) => onChange({ in_kind_category: e.target.value as InKindCategory })}
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
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink/60">Provided By</span>
              <select
                name={`${prefix}_in_kind_provider`}
                value={component.in_kind_provider}
                onChange={(e) => onChange({ in_kind_provider: e.target.value as InKindProvider })}
                className={inputClass}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {IN_KIND_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {IN_KIND_PROVIDER_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink/60">
              Description{component.in_kind_category === "other" ? " (required for Other)" : " (optional)"}
            </span>
            <input
              type="text"
              name={`${prefix}_in_kind_description`}
              value={component.in_kind_description}
              onChange={(e) => onChange({ in_kind_description: e.target.value })}
              className={inputClass}
            />
          </label>

          {/* Pass 2.5 — quantity/unit are a real measurable fact here
             ("200 samples"). Never required. */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink/60">Quantity (optional)</span>
              <input
                type="text"
                name={`${prefix}_quantity`}
                value={component.quantity}
                onChange={(e) => onChange({ quantity: e.target.value })}
                placeholder="200"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink/60">Unit</span>
              <select
                name={`${prefix}_unit`}
                value={component.unit}
                onChange={(e) => onChange({ unit: e.target.value as ContributionUnit })}
                className={inputClass}
              >
                <option value="">No unit</option>
                {CONTRIBUTION_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {CONTRIBUTION_UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {component.unit === "custom" && (
            <input
              type="text"
              name={`${prefix}_custom_unit_label`}
              value={component.custom_unit_label}
              onChange={(e) => onChange({ custom_unit_label: e.target.value })}
              placeholder="Describe the unit (e.g. Road Trips)"
              className={inputClass}
            />
          )}
          {component.unit !== "custom" && <Hidden name={`${prefix}_custom_unit_label`} value={component.custom_unit_label} />}

          {/* Pass 2.5 — exactly one valuation method, or none. Switching
             clears whichever field is leaving, so the two stay mutually
             exclusive by construction (mirroring the DB/domain invariant)
             rather than relying on the admin to clear it manually. */}
          <div>
            <span className="mb-1 block text-xs font-medium text-ink/60">Valuation (optional)</span>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["none", "No Value"],
                  ["total", "Estimated Total"],
                  ["per_unit", "Value Per Unit"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onChange(mode === "none" ? { estimated_value: "", unit_value: "" } : mode === "total" ? { estimated_value: component.estimated_value || "", unit_value: "" } : { unit_value: component.unit_value || "", estimated_value: "" })}
                  className={modeBtn(valuationModeOf(component) === mode)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {valuationModeOf(component) === "total" && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink/60">Estimated Total</span>
              <input
                type="text"
                name={`${prefix}_estimated_value`}
                value={component.estimated_value}
                onChange={(e) => onChange({ estimated_value: e.target.value })}
                placeholder="2500"
                className={`${inputClass} w-32`}
              />
            </label>
          )}
          {valuationModeOf(component) !== "total" && <Hidden name={`${prefix}_estimated_value`} value={component.estimated_value} />}
          {valuationModeOf(component) === "per_unit" && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink/60">Value Per {UNIT_LABEL_SINGULAR(component.unit, component.custom_unit_label)}</span>
                <input
                  type="text"
                  name={`${prefix}_unit_value`}
                  value={component.unit_value}
                  onChange={(e) => onChange({ unit_value: e.target.value })}
                  placeholder="2.00"
                  className={`${inputClass} w-32`}
                />
              </label>
              {component.quantity &&
                component.unit_value &&
                (() => {
                  const qty = Number(component.quantity);
                  const unitCents = dollarsToCentsPreview(component.unit_value);
                  if (!Number.isFinite(qty) || qty <= 0 || unitCents == null) return null;
                  return <p className="text-xs text-ink/50">Calculated Estimated Value: {formatDollars(calculateUnitValueCents(qty, unitCents))}</p>;
                })()}
            </>
          )}
          {valuationModeOf(component) !== "per_unit" && <Hidden name={`${prefix}_unit_value`} value={component.unit_value} />}

          <div className="flex flex-wrap items-center gap-4">
            {optionMode === "structured" && (
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  name={`${prefix}_in_kind_required`}
                  checked={component.in_kind_required}
                  onChange={(e) => onChange({ in_kind_required: e.target.checked })}
                  className="h-5 w-5 accent-findmi"
                />
                Required
              </label>
            )}
            {optionMode === "complimentary" && <Hidden name={`${prefix}_in_kind_required`} value={false} />}
          </div>
        </>
      )}
    </div>
  );
}

function OptionCard({
  index,
  total,
  option,
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
  onPatch: (patch: Partial<OptionState>) => void;
  onPatchComponent: (compKey: string, patch: Partial<ComponentState>) => void;
  onAddComponent: (type: ComponentType) => void;
  onRemoveComponent: (compKey: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const prefix = `ct_${index}`;
  const usedMonetary = option.components.find((c) => isMonetaryComponentType(c.component_type))?.component_type ?? null;

  function setMode(next: OptionCommercialMode) {
    if (wouldDiscard(option, next)) {
      const ok = window.confirm(
        next === "custom"
          ? "Switching to Custom Terms removes this Option's structured commercial terms. Continue?"
          : "Switching to Complimentary removes this Option's monetary and required In-Kind terms. Continue?"
      );
      if (!ok) return;
    }
    if (next === "custom") onPatch({ commercial_mode: next, components: [] });
    else if (next === "complimentary") onPatch({ commercial_mode: next, components: option.components.filter((c) => c.component_type === "in_kind" && !c.in_kind_required) });
    else onPatch({ commercial_mode: next });
  }

  return (
    <div className="rounded-2xl border border-black/10 bg-white/60 p-4">
      <Hidden name={`${prefix}_id`} value={option.id ?? ""} />
      <Hidden name={`${prefix}_comp_count`} value={option.components.length} />

      {total > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-ink/50">Option {index + 1}</span>
          <input
            type="text"
            name={`${prefix}_name`}
            value={option.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            placeholder="Option name (e.g. Resident Demo + Content)"
            className={`${inputClass} max-w-xs`}
          />
        </div>
      )}
      {total === 1 && <Hidden name={`${prefix}_name`} value={option.name} />}
      <Hidden name={`${prefix}_description`} value={option.description} />

      <div className="flex flex-wrap items-center gap-2">
        {OPTION_COMMERCIAL_MODES.map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={modeBtn(option.commercial_mode === m)}>
            {OPTION_COMMERCIAL_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <Hidden name={`${prefix}_commercial_mode`} value={option.commercial_mode} />

      {option.commercial_mode === "custom" && (
        <div className="mt-3">
          <textarea
            name={`${prefix}_custom_terms_note`}
            value={option.custom_terms_note}
            onChange={(e) => onPatch({ custom_terms_note: e.target.value })}
            rows={3}
            placeholder="Describe the negotiated arrangement…"
            className={`${inputClass} resize-y`}
          />
        </div>
      )}
      {option.commercial_mode !== "custom" && <Hidden name={`${prefix}_custom_terms_note`} value={option.custom_terms_note} />}

      {option.commercial_mode !== "custom" && (
        <div className="mt-3 flex flex-col gap-2">
          {option.components.map((c) => (
            <ComponentRow
              key={c.key}
              prefix={`${prefix}_c_${option.components.indexOf(c)}`}
              component={c}
              optionMode={option.commercial_mode}
              onChange={(patch) => onPatchComponent(c.key, patch)}
              onRemove={() => onRemoveComponent(c.key)}
            />
          ))}

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

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3">
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className={smallBtn}>
          Move Up
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className={smallBtn}>
          Move Down
        </button>
        <button type="button" onClick={onDuplicate} className={smallBtn}>
          Duplicate Option
        </button>
        <button type="button" onClick={onRemove} disabled={total <= 1} className={dangerBtn} title={total <= 1 ? "An Opportunity needs at least one Option" : undefined}>
          Remove Option
        </button>
      </div>
    </div>
  );
}

export default function CommercialTermsBuilder({
  initialOptions,
  onFirstOptionModeChange,
}: {
  initialOptions: InitialOption[];
  /** Fires whenever the FIRST Option's commercial_mode changes, so a
   * parent form can keep its own unrelated Credits Eligible control in
   * sync (legacy credits_eligible has no meaning without an amount to
   * apply credits to — the same rule the old Pricing Mode dropdown
   * enforced for 'complimentary'). Optional — the builder works standalone
   * without it. */
  onFirstOptionModeChange?: (firstOptionComplimentary: boolean) => void;
}) {
  const [options, setOptions] = useState<OptionState[]>(() => (initialOptions.length ? initialOptions.map(optionToState) : [defaultOptionState()]));

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
          return { ...o, components: [defaultMonetaryComponent(type), ...o.components.filter((c) => !isMonetaryComponentType(c.component_type))] };
        }
        return { ...o, components: [...o.components, defaultInKindComponent(o.commercial_mode !== "complimentary")] };
      })
    );
  }
  function removeComponent(optKey: string, compKey: string) {
    setOptions((prev) => prev.map((o) => (o.key !== optKey ? o : { ...o, components: o.components.filter((c) => c.key !== compKey) })));
  }
  function addOption() {
    setOptions((prev) => [...prev, defaultOptionState()]);
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

  return (
    <div className="flex flex-col gap-3">
      <Hidden name="ct_count" value={options.length} />
      {options.map((o, i) => (
        <OptionCard
          key={o.key}
          index={i}
          total={options.length}
          option={o}
          onPatch={(patch) => patchOption(o.key, patch)}
          onPatchComponent={(compKey, patch) => patchComponent(o.key, compKey, patch)}
          onAddComponent={(type) => addComponent(o.key, type)}
          onRemoveComponent={(compKey) => removeComponent(o.key, compKey)}
          onDuplicate={() => duplicateOption(o.key)}
          onRemove={() => removeOption(o.key)}
          onMove={(dir) => moveOption(o.key, dir)}
        />
      ))}
      <button type="button" onClick={addOption} className="self-start rounded-full border border-dashed border-black/15 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink/50 transition hover:border-ink/30 hover:text-ink">
        + Add Option
      </button>
    </div>
  );
}
