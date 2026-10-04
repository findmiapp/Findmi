"use client";

import { useState, type ReactNode } from "react";

/**
 * FIND-OR-CREATE — Findmi's standard interaction for connecting one Findmi
 * object to another (an Event to its place, a Presence item to where it's
 * happening, and — later — Events, Businesses, Products):
 *
 *   FIND EXISTING FIRST.
 *   IF IT DOESN'T EXIST AND THE USER IS ALLOWED TO CREATE IT,
 *   COLLECT THE MINIMUM REQUIRED DETAILS INLINE.
 *   CREATE IT. SELECT IT. CONTINUE.
 *
 * The user never leaves the parent workflow, never navigates to another
 * manager, and never loses what they already typed: everything here is
 * buttons (type="button") inside the parent's form — never a nested
 * <form>, never a submit — and Enter is swallowed so it can't submit the
 * parent form by accident.
 *
 * This component owns only the generic interaction (search box, results,
 * "No exact match / + Add …", swapping in the inline create panel). Each
 * entity supplies an ADAPTER — its search hook, how a result row reads,
 * what counts as an exact match, and its own minimum-details create panel
 * (see components/places/PlaceFindOrCreate.tsx, the first adapter). The
 * parent owns the selected value and renders its own selected state.
 *
 * Results render in normal document flow (not a floating dropdown), so on
 * a phone they can't extend past the viewport or hide under the keyboard,
 * and there's no nested scroll area.
 */
export interface FindOrCreatePickerProps<T> {
  placeholder: string;
  /** Called unconditionally on every render with the current query — pass a
   * stable, module-level hook. */
  useResults: (query: string) => { results: T[]; loading: boolean };
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** True when a result IS what was typed — suppresses "No exact match". */
  isExactMatch: (item: T, query: string) => boolean;
  onPick: (item: T) => void;
  /** Omit when the user may not create this entity here (search-only). */
  renderCreate?: (args: { initialName: string; onDone: () => void }) => ReactNode;
  createLabel?: (query: string) => string;
  maxResults?: number;
  autoFocus?: boolean;
}

const inputClass =
  "h-12 w-full rounded-xl border border-black/10 bg-white px-3.5 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20";

export default function FindOrCreatePicker<T>({
  placeholder,
  useResults,
  getKey,
  renderItem,
  isExactMatch,
  onPick,
  renderCreate,
  createLabel = (q) => `Add “${q}”`,
  maxResults = 8,
  autoFocus = false,
}: FindOrCreatePickerProps<T>) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const { results, loading } = useResults(query);

  const trimmed = query.trim();
  const visible = results.slice(0, maxResults);
  const hasExact = trimmed.length > 0 && results.some((r) => isExactMatch(r, trimmed));
  const offerCreate = Boolean(renderCreate) && trimmed.length >= 2 && !loading && !hasExact;

  if (creatingName !== null && renderCreate) {
    return (
      <>
        {renderCreate({
          initialName: creatingName,
          onDone: () => {
            setCreatingName(null);
            setQuery("");
            setOpen(false);
          },
        })}
      </>
    );
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        className={inputClass}
      />
      {open && (
        <div className="mt-1.5 overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
          {loading && visible.length === 0 ? (
            <p className="px-3.5 py-3 text-body text-muted">Searching…</p>
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {visible.map((item) => (
                <li key={getKey(item)}>
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onPick(item);
                      setQuery("");
                      setOpen(false);
                    }}
                    className="flex min-h-[52px] w-full items-center px-3.5 py-2.5 text-left transition hover:bg-black/[0.03] focus-visible:bg-black/[0.04] focus-visible:outline-none"
                  >
                    {renderItem(item)}
                  </button>
                </li>
              ))}
              {offerCreate && (
                <li>
                  {visible.length === 0 && <p className="px-3.5 pt-3 text-metadata text-muted">No exact match</p>}
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => setCreatingName(trimmed)}
                    className="flex min-h-[52px] w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-body font-semibold text-findmi-700 transition hover:bg-findmi-50/60 focus-visible:bg-findmi-50 focus-visible:outline-none"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-findmi text-white">
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
                        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span className="min-w-0 truncate">{createLabel(trimmed)}</span>
                  </button>
                </li>
              )}
              {visible.length === 0 && !offerCreate && (
                <li>
                  <p className="px-3.5 py-3 text-body text-muted">
                    {trimmed ? (trimmed.length < 2 && renderCreate ? "Keep typing…" : "No matches.") : "Start typing to search."}
                  </p>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
