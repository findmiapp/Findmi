"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

export interface JournalSearchResult {
  value: string;
  label: string;
  sublabel?: string;
  image_url?: string | null;
}

/** Journal V1 — a small debounced search-and-pick control over the
 * existing member-facing /api/account/search route (already used by Event
 * Manager's own Business/Location pickers; this pass only adds "products"
 * and "events" branches to that same route — see its own comment). Used
 * for both Step 2 (Location, single-select, wrapped by the caller) and
 * Step 3 (Business/Product/Event, multi-select, one instance per entity).
 * Deliberately not RelationPicker.tsx (admin-only, gated by requireAdmin()
 * and a different backing route) — this is the consumer-facing
 * counterpart, same "search real, existing, publicly-visible Findmi
 * objects only" rule either way. */
export default function JournalSearchSelect({
  entity,
  placeholder,
  onSelect,
  excludeIds = [],
}: {
  entity: "locations" | "businesses" | "products" | "events";
  placeholder: string;
  onSelect: (result: JournalSearchResult) => void;
  excludeIds?: string[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<JournalSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed && entity !== "locations") {
      setResults([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      fetch(`/api/account/search?entity=${entity}&q=${encodeURIComponent(trimmed)}`)
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((data: { results: JournalSearchResult[] }) => setResults(data.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, entity]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const visibleResults = results.filter((r) => !excludeIds.includes(r.value));

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-black/10 bg-white px-3.5 text-sm text-ink placeholder:text-ink/40 focus:border-findmi/50 focus:outline-none"
      />
      {open && (query.trim() || entity === "locations") && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-black/10 bg-white py-1 shadow-lg">
          {loading && <p className="px-3.5 py-2.5 text-xs text-ink/40">Searching…</p>}
          {!loading && visibleResults.length === 0 && <p className="px-3.5 py-2.5 text-xs text-ink/40">No matches.</p>}
          {!loading &&
            visibleResults.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => {
                  onSelect(r);
                  setQuery("");
                  setResults([]);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-findmi-50/60"
              >
                <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-black/5">
                  {r.image_url && <Image src={r.image_url} alt="" fill unoptimized sizes="32px" className="object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{r.label}</span>
                  {r.sublabel && <span className="block truncate text-xs text-ink/50">{r.sublabel}</span>}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
