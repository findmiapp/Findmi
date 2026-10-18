"use client";

import { useEffect, useRef, useState } from "react";
import { searchCanonicalGeography, type CanonicalGeographyHit } from "@/app/(public)/actions/entity-geo-search";

const DEBOUNCE_MS = 300;

/** Canonical Entity Geography — the one shared Census-aware picker every
 * geography wrapper (Business/Event/Location *GeographyFields) can use
 * instead of each hand-rolling its own search. Purely presentational +
 * search: it emits the chosen geo_key/label via onSelect and nothing
 * else — the actual save-time resolution/validation of that key always
 * happens again server-side (lib/geo/entity-geo.ts), never trusted from
 * here alone, same "server re-validates regardless of what the client
 * picked" rule every other picker in this codebase already follows.
 *
 * A typed phrase that doesn't resolve to anything selectable is not an
 * error — see this pass's own product note: a business/event/location is
 * never required to pick a canonical Place to save normally. */
export default function CanonicalGeographyPicker({
  label = "Place",
  placeholder = "City, ZIP, or neighborhood",
  defaultLabel = "",
  onSelect,
}: {
  label?: string;
  placeholder?: string;
  /** The already-saved selection's display label, if editing an entity
   * that already has a canonical key — shown until the visitor types
   * something new. */
  defaultLabel?: string;
  onSelect: (hit: CanonicalGeographyHit | null) => void;
}) {
  const [query, setQuery] = useState(defaultLabel);
  const [results, setResults] = useState<CanonicalGeographyHit[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState(defaultLabel);
  const latest = useRef("");

  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (!q || q === selectedLabel) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      searchCanonicalGeography(q).then((hits) => {
        if (latest.current !== q) return; // a newer keystroke superseded this lookup
        setResults(hits);
        setOpen(true);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, selectedLabel]);

  function pick(hit: CanonicalGeographyHit) {
    setQuery(hit.label);
    setSelectedLabel(hit.label);
    setOpen(false);
    setResults([]);
    onSelect(hit);
  }

  return (
    <div className="relative">
      <span className="mb-1.5 block text-xs font-medium text-ink/60">{label}</span>
      <input
        type="text"
        value={query}
        autoCapitalize="words"
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim() !== selectedLabel) onSelect(null);
        }}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-black/10 bg-white py-1 shadow-lg">
          {results.map((hit) => (
            <li key={hit.geo_key}>
              <button
                type="button"
                onClick={() => pick(hit)}
                className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm text-ink hover:bg-black/[0.03]"
              >
                <span>{hit.label}</span>
                <span className="text-xs text-ink/35">{hit.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
