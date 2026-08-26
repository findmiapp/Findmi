"use client";

import { useRef, useState } from "react";
import { useAdminSearch, type SearchResult } from "./useAdminSearch";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

function Avatar({ url, label }: { url?: string | null; label: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/5 text-xs font-bold text-ink/40">
      {url ? (
        // Tiny fixed-size avatar in a dropdown/row — next/image's
        // remote-domain config and layout machinery aren't worth it here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        label.charAt(0).toUpperCase()
      )}
    </span>
  );
}

function ResultsDropdown({
  loading,
  results,
  onPick,
}: {
  loading: boolean;
  results: SearchResult[];
  onPick: (r: SearchResult) => void;
}) {
  return (
    <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-black/10 bg-white shadow-lg">
      {loading ? (
        <p className="px-3.5 py-2.5 text-sm text-ink/40">Searching…</p>
      ) : results.length === 0 ? (
        <p className="px-3.5 py-2.5 text-sm text-ink/40">No matches.</p>
      ) : (
        results.map((r) => (
          <button
            key={r.value}
            type="button"
            // onMouseDown (not onClick) fires before the input's onBlur, so
            // the dropdown-close-on-blur below doesn't swallow the pick.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(r);
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-black/[0.03]"
          >
            <Avatar url={r.image_url} label={r.label} />
            <span className="min-w-0">
              <span className="block truncate text-sm text-ink">{r.label}</span>
              {r.sublabel && <span className="block truncate text-xs text-ink/45">{r.sublabel}</span>}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

/** Single-relationship searchable picker — replaces a giant <select> of
 * every row in the table. Renders a hidden input under `name` so it drops
 * straight into an existing Server Action form; posts "" when cleared. */
export function RelationField({
  label,
  name,
  hint,
  placeholder,
  initial,
  entity,
  createHref,
  createLabel,
  clearLabel = "None",
  onSelect,
}: {
  label: string;
  name: string;
  hint?: string;
  placeholder?: string;
  initial: SearchResult | null;
  entity: "businesses" | "events" | "products" | "people";
  createHref?: string;
  createLabel?: string;
  /** Shown as the selectable "no relationship" option, e.g. for Appearance's
   * optional event link. Omit for a required relationship. */
  clearLabel?: string | null;
  /** Optional — lets a parent that isn't a plain `<form action>` (e.g. a
   * multi-step client wizard building its own FormData) track the current
   * selection too, instead of only the hidden input this already renders.
   * Every existing caller omits this; behavior for them is unchanged. */
  onSelect?: (value: SearchResult | null) => void;
}) {
  const [selected, setSelectedState] = useState<SearchResult | null>(initial);
  const setSelected = (value: SearchResult | null) => {
    setSelectedState(value);
    onSelect?.(value);
  };
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { results, loading } = useAdminSearch(entity, query);

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <input type="hidden" name={name} value={selected?.value ?? ""} />
      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-black/10 bg-white px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar url={selected.image_url} label={selected.label} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">{selected.label}</span>
              {selected.sublabel && (
                <span className="block truncate text-xs text-ink/45">{selected.sublabel}</span>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setQuery("");
            }}
            className="shrink-0 text-xs font-semibold text-ink/50 hover:text-ink"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            placeholder={placeholder ?? `Search ${entity}…`}
            className={inputClass}
          />
          {clearLabel !== null && !query && (
            <p className="mt-1 text-xs text-ink/40">Leave blank for &ldquo;{clearLabel}&rdquo;.</p>
          )}
          {open && query.trim() && (
            <ResultsDropdown
              loading={loading}
              results={results}
              onPick={(r) => {
                setSelected(r);
                setQuery("");
                setOpen(false);
              }}
            />
          )}
        </div>
      )}
      {hint && <p className="mt-1 text-xs text-ink/45">{hint}</p>}
      {createHref && !selected && (
        <a
          href={createHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-block text-xs font-semibold text-findmi-700 hover:underline"
        >
          + {createLabel ?? "Create New"}
        </a>
      )}
    </div>
  );
}

/** Multi-relationship "search and add" box — used by EventParticipationEditor
 * to add a business to an event's roster without scrolling every business in
 * the system. Already-added entities are excluded from results client-side. */
export function EntitySearchAdd({
  entity,
  placeholder,
  excludeIds,
  onAdd,
}: {
  entity: "businesses" | "events" | "products" | "people";
  placeholder: string;
  excludeIds: Set<string>;
  onAdd: (r: SearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, loading } = useAdminSearch(entity, query);
  const filtered = results.filter((r) => !excludeIds.has(r.value));

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        className={inputClass}
      />
      {open && query.trim() && (
        <ResultsDropdown
          loading={loading}
          results={filtered}
          onPick={(r) => {
            onAdd(r);
            setQuery("");
            setOpen(false);
            inputRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

export { Avatar };
export type { SearchResult };
