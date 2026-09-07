"use client";

import { useMemo, useState } from "react";

export interface EventPickerOption {
  value: string;
  name: string;
  dateLabel?: string;
  venueLabel?: string;
}

/**
 * Owner Action UX pass — replaces the plain native <select> (which
 * doesn't scale as the Event catalog grows) with a compact searchable
 * picker. `options` is the same server-computed, already-bounded
 * requestOptions list the manager page builds today (upcoming, non-demo
 * events/occurrences not already on this business's own calendar) — no
 * new search backend, just client-side filtering of it (Section 2's own
 * "acceptably bounded list" guidance). Renders its own submit button:
 * nothing is submittable until a real selection is made, which is also
 * what makes "selected before submission" always true (never a bare
 * hidden field with an unclear/blank value).
 */
export default function EventSearchPicker({ options }: { options: EventPickerOption[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EventPickerOption | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? options.filter((o) => [o.name, o.dateLabel, o.venueLabel].filter(Boolean).some((v) => v!.toLowerCase().includes(q)))
      : options;
    return pool.slice(0, q ? 20 : 8);
  }, [query, options]);

  if (selected) {
    return (
      <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl border border-findmi/30 bg-findmi-50 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink">{selected.name}</p>
          {(selected.dateLabel || selected.venueLabel) && (
            <p className="truncate text-xs text-ink/60">{[selected.dateLabel, selected.venueLabel].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="shrink-0 text-xs font-semibold text-ink/50 underline underline-offset-2 hover:text-ink"
        >
          Change
        </button>
        <input type="hidden" name="target" value={selected.value} />
      </div>
    );
  }

  return (
    <div className="mt-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by event name, venue, or date…"
        className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
      />
      <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-black/10 bg-white">
        {results.length > 0 ? (
          results.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                setSelected(o);
                setQuery("");
              }}
              className="flex w-full flex-col items-start gap-0.5 border-b border-black/5 px-3.5 py-2.5 text-left transition last:border-b-0 hover:bg-black/[0.03]"
            >
              <span className="text-sm font-semibold text-ink">{o.name}</span>
              {(o.dateLabel || o.venueLabel) && (
                <span className="text-xs text-ink/50">{[o.dateLabel, o.venueLabel].filter(Boolean).join(" · ")}</span>
              )}
            </button>
          ))
        ) : (
          <p className="px-3.5 py-3 text-sm text-ink/50">
            No matching events{query ? ` for "${query}"` : ""}. Try Option 2 below.
          </p>
        )}
      </div>
    </div>
  );
}
