"use client";

import { useState } from "react";
import { AUDIT_DETAIL_MAX, type AuditOption } from "@/lib/brand-audit-domain";

export type AuditSelection = Record<string, string>;

/** Brand Audit Goals / Challenges — one stacked column. Each row: a
 * prominent checkbox on the left, a bold Title Case name, a short italic
 * explanation and, once selected, its own inline "Describe Or Elaborate
 * (Optional)" textarea. "Other" opens its textarea as soon as it's chosen.
 * Every choice stays visible; multiple selection. `value` maps each
 * selected key to its (possibly empty) elaboration. */
export default function AuditChoiceList({
  keys,
  options,
  value,
  onChange,
  disabled,
  placeholder,
  otherPlaceholder,
}: {
  keys: readonly string[];
  options: Record<string, AuditOption>;
  value: AuditSelection;
  onChange: (next: AuditSelection) => void;
  disabled?: boolean;
  placeholder: string;
  otherPlaceholder: string;
}) {
  // Elaborations already written start open; others open on request.
  const [open, setOpen] = useState<Set<string>>(() => new Set(Object.keys(value).filter((k) => value[k]?.trim())));

  const toggle = (key: string) => {
    if (disabled) return;
    const next = { ...value };
    if (key in next) delete next[key];
    else next[key] = "";
    onChange(next);
  };

  return (
    <ul className="flex flex-col gap-2">
      {keys.map((key) => {
        const option = options[key];
        const selected = key in value;
        const isOther = key === "other";
        const showText = selected && (isOther || open.has(key));
        const inputId = `audit-detail-${key}`;
        return (
          <li
            key={key}
            className={`rounded-2xl border transition ${selected ? "border-findmi/45 bg-findmi-50/50" : "border-black/[0.08] bg-white hover:border-black/15"}`}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => toggle(key)}
              className="flex w-full items-start gap-3 px-3.5 py-3 text-left disabled:cursor-default"
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition ${selected ? "border-findmi bg-findmi text-white" : "border-black/25 bg-white"}`}
              >
                {selected && (
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="m5 10.5 3.2 3.2L15 7" />
                  </svg>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-card-title font-bold text-primary">{option.label}</span>
                <span className="mt-0.5 block text-metadata italic text-muted">{option.description}</span>
              </span>
            </button>
            {selected && !isOther && !showText && !disabled && (
              <button
                type="button"
                onClick={() => setOpen((prev) => new Set(prev).add(key))}
                className="-mt-1 mb-2.5 ml-[3.25rem] text-metadata font-semibold text-accent hover:underline"
              >
                Describe Or Elaborate (Optional)
              </button>
            )}
            {showText && (
              <div className="px-3.5 pb-3 pl-[3.25rem]">
                <label htmlFor={inputId} className="sr-only">
                  {isOther ? `Describe your other ${option.label}` : `Describe or elaborate on ${option.label}`}
                </label>
                <textarea
                  id={inputId}
                  autoCapitalize="sentences"
                  rows={3}
                  maxLength={AUDIT_DETAIL_MAX}
                  disabled={disabled}
                  value={value[key] ?? ""}
                  onChange={(e) => onChange({ ...value, [key]: e.target.value })}
                  placeholder={isOther ? otherPlaceholder : placeholder}
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-body text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20"
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
