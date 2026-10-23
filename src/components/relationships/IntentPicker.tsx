"use client";

import { COMMERCIAL_INTENT_LABELS, INTENTS_BY_KIND, type CommercialIntent, type TargetKind } from "@/lib/commercial-intents";

const chipClass = (on: boolean) => `flex h-9 items-center gap-1.5 rounded-full px-3.5 text-metadata font-semibold transition ${on ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`;

/** Why — the compatible intents for one counterparty kind, as toggles
 * (canonical order). `exclude` hides intents handled elsewhere (e.g. Event
 * Participation, which has its own workflow). */
export function IntentPicker({
  kind,
  value,
  onChange,
  disabled,
  exclude = [],
}: {
  kind: TargetKind;
  value: readonly CommercialIntent[];
  onChange: (next: CommercialIntent[]) => void;
  disabled?: boolean;
  exclude?: readonly CommercialIntent[];
}) {
  const options = INTENTS_BY_KIND[kind].filter((i) => !exclude.includes(i));
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Why">
      {options.map((i) => {
        const on = value.includes(i);
        return (
          <button
            key={i}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((v) => v !== i) : INTENTS_BY_KIND[kind].filter((x) => x === i || value.includes(x)))}
            className={`${chipClass(on)} disabled:opacity-50`}
          >
            {COMMERCIAL_INTENT_LABELS[i]}
          </button>
        );
      })}
    </div>
  );
}
