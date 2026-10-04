"use client";

import { useState } from "react";
import type { AccountSearchResult } from "@/components/account/useAccountSearch";
import type { SelectedLocationDetail } from "@/components/account/EventLocationField";
import PlaceFindOrCreate, { NotPublicBadge, placeLine } from "./PlaceFindOrCreate";

/** Find-or-Create V1 — a single place field for simple forms (Presence
 * items): selected-place card + hidden `name` input + PlaceFindOrCreate.
 * Speaks the same AccountSearchResult shape AccountRelationField did, so
 * swapping it in leaves the parent form's own logic unchanged. */
function toResult(p: SelectedLocationDetail): AccountSearchResult {
  return {
    value: p.id,
    label: p.name,
    sublabel: [p.city, p.state].filter(Boolean).join(", ") || undefined,
    slug: p.slug,
    city: p.city,
    state: p.state,
    address: p.address,
    postal_code: p.postal_code,
    category: p.category,
    is_public: p.is_public,
  };
}

export default function PlaceField({
  label,
  name,
  hint,
  initial,
  onSelect,
  selectedBadge,
}: {
  label: string;
  name: string;
  hint?: string;
  initial: AccountSearchResult | null;
  onSelect?: (value: AccountSearchResult | null) => void;
  selectedBadge?: string;
}) {
  const [selected, setSelectedState] = useState<AccountSearchResult | null>(initial);
  const setSelected = (value: AccountSearchResult | null) => {
    setSelectedState(value);
    onSelect?.(value);
  };
  const line = selected ? placeLine({ address: selected.address ?? null, city: selected.city ?? null, state: selected.state ?? null }) || selected.sublabel : null;

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <input type="hidden" name={name} value={selected?.value ?? ""} />
      {selected ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-3.5 py-3">
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-body font-semibold text-primary">{selected.label}</span>
              {selected.is_public === false && <NotPublicBadge />}
            </span>
            {line && <span className="block truncate text-metadata text-muted">{line}</span>}
            {selectedBadge && <span className="mt-0.5 block text-microcopy font-semibold text-findmi-700">✓ {selectedBadge}</span>}
          </span>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="h-10 shrink-0 px-2 text-metadata font-semibold text-muted hover:text-primary"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <PlaceFindOrCreate onSelect={(p) => setSelected(toResult(p))} />
          {hint && <p className="mt-1 text-xs text-ink/45">{hint}</p>}
        </>
      )}
    </div>
  );
}
