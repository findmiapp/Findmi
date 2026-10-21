"use client";

import { useState } from "react";
import type { QrCreatorOption } from "@/lib/qr-manager";

/** A searchable, scroll-contained single-select for the QR creator's
 * context / destination choices — replaces a long flat button list. Filters
 * as you type over each option's label and secondary line; the picker never
 * hides the current selection's identity. Options are the Business's own
 * bounded set (loaded server-side), so filtering here is local. */
export default function QrOptionPicker({
  options,
  value,
  onChange,
  noun,
}: {
  options: QrCreatorOption[];
  value: string;
  onChange: (id: string) => void;
  /** Singular lower-case noun for the placeholder/empty copy ("event"). */
  noun: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => `${o.label} ${o.meta ?? ""}`.toLowerCase().includes(q)) : options;
  const searchable = options.length > 5;

  return (
    <div className="flex flex-col gap-2">
      {searchable && (
        <input
          type="search"
          autoCapitalize="none"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${noun}s`}
          aria-label={`Search ${noun}s`}
          className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
        />
      )}
      <div role="listbox" aria-label={`Choose ${noun}`} className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-xl border border-black/10 bg-white p-1.5">
        {shown.length === 0 ? (
          <p className="px-3 py-3 text-metadata text-muted">No {noun}s match &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          shown.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={value === o.id}
              onClick={() => onChange(o.id)}
              className={`rounded-lg px-3 py-2.5 text-left transition ${value === o.id ? "bg-findmi-50 text-accent" : "text-primary hover:bg-black/[0.03]"}`}
            >
              <span className={`block text-body ${value === o.id ? "font-semibold" : ""}`}>{o.label}</span>
              {o.meta && <span className="block text-metadata text-muted">{o.meta}</span>}
            </button>
          ))
        )}
      </div>
      {searchable && (
        <p className="text-microcopy text-subtle">
          {shown.length} of {options.length}
        </p>
      )}
    </div>
  );
}
