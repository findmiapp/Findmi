"use client";

import { useMemo, useState } from "react";

export interface EventPickerOption {
  value: string;
  name: string;
  dateLabel?: string;
  venueLabel?: string;
}

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

/**
 * Owner Action UX pass — replaces the plain native <select> (which
 * doesn't scale as the Event catalog grows) with a compact searchable
 * picker. `options` is the same server-computed, already-bounded
 * requestOptions list the manager page builds today (upcoming, non-demo
 * events/occurrences not already on this business's own calendar) — no
 * new search backend, just client-side filtering of it (Section 2's own
 * "acceptably bounded list" guidance).
 *
 * Where I'll Be V3.1 — this component now owns the WHOLE "search → select
 * → confirm" progression, not just the picker: the Note field and Apply
 * button used to render unconditionally in the parent regardless of
 * whether anything was actually selected yet (backwards — application UI
 * showing before a decision was made). They're pulled in here instead, so
 * they only exist once `selected` is real, reusing this component's own
 * existing selection state rather than lifting it into new parent-level
 * architecture. Nothing about the submitted fields changed: `target` and
 * `note` are the same names the parent's <form action={addFromEvent}>
 * already expects.
 */
export default function EventSearchPicker({ options }: { options: EventPickerOption[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EventPickerOption | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? options.filter((o) => [o.name, o.dateLabel, o.venueLabel].filter(Boolean).some((v) => v!.toLowerCase().includes(q)))
      : options;
    // Trimmed from 8/20 — a composer that opens onto a long scrolling
    // result list is the exact "too much application UI before a
    // decision" problem this pass corrects; a shorter default browse set
    // plus a still-generous searched-match cap keeps it findable without
    // the list dominating the screen.
    return pool.slice(0, q ? 8 : 5);
  }, [query, options]);

  if (selected) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-findmi/25 bg-findmi-50 px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-findmi-700">Selected</p>
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

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink/60">
            Note to organizer <span className="font-normal text-ink/40">Optional</span>
          </span>
          <textarea
            name="note"
            rows={2}
            placeholder="e.g. We'd love to bring our food truck…"
            className={inputClass}
          />
        </label>

        <button
          type="submit"
          className="flex h-9 w-fit items-center rounded-full bg-findmi px-5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Apply
        </button>
      </div>
    );
  }

  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/40">Search Findmi</span>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search events, markets or places…"
        className={inputClass}
      />
      {results.length > 0 ? (
        <div className="mt-2 flex flex-col divide-y divide-black/[0.06]">
          {results.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                setSelected(o);
                setQuery("");
              }}
              className="flex w-full flex-col items-start gap-0.5 py-2.5 text-left transition hover:bg-black/[0.02]"
            >
              <span className="text-sm font-semibold text-ink">{o.name}</span>
              {(o.dateLabel || o.venueLabel) && (
                <span className="text-xs text-ink/50">{[o.dateLabel, o.venueLabel].filter(Boolean).join(" · ")}</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink/50">
          No matching events{query ? ` for "${query}"` : ""}. You can add it below instead.
        </p>
      )}
    </div>
  );
}
