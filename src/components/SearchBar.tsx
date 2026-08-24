"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SearchResultItem {
  id: string;
  name: string;
  href: string;
  image: string | null;
  subtitle: string;
}
interface SearchResults {
  businesses: SearchResultItem[];
  events: SearchResultItem[];
  products: SearchResultItem[];
}
const EMPTY: SearchResults = { businesses: [], events: [], products: [] };

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

// Homepage-only live search — routes into the existing /businesses search
// results page for "View all" (its own `q` param already drives
// searchBusinesses()), and the dropdown itself is powered by
// /api/homepage-search, which just fans out to the same existing public
// search functions used elsewhere (see that route). No parallel search
// system, no fabricated results.
export default function SearchBar() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < MIN_CHARS) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/homepage-search?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        const data: SearchResults = await res.json();
        setResults(data);
      } catch {
        setResults(EMPTY);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOpen(false);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    router.push(`/businesses${params.toString() ? `?${params.toString()}` : ""}`);
  }

  const term = q.trim();
  const hasQuery = term.length >= MIN_CHARS;
  const hasResults = results.businesses.length + results.events.length + results.products.length > 0;
  const showDropdown = open && hasQuery;

  return (
    <div ref={containerRef} className="relative w-full">
      <form
        onSubmit={handleSubmit}
        className="flex w-full items-center gap-2 rounded-full border border-black/10 bg-white py-2.5 pl-4 pr-1.5 shadow-sm transition focus-within:border-ink/25"
      >
        <SearchGlyph />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="homepage-search-results"
          aria-autocomplete="list"
          placeholder="Search businesses, events, products..."
          className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink/40 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Search"
          className="shrink-0 rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Search
        </button>
      </form>

      {showDropdown && (
        <div
          id="homepage-search-results"
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-black/10 bg-white p-2 shadow-lg"
        >
          {loading && !hasResults ? (
            <p className="px-3 py-4 text-center text-sm text-ink/45">Searching…</p>
          ) : !hasResults ? (
            <p className="px-3 py-4 text-center text-sm text-ink/45">No matches for &ldquo;{term}&rdquo; yet.</p>
          ) : (
            <>
              <ResultGroup label="Businesses" items={results.businesses} onSelect={() => setOpen(false)} />
              <ResultGroup label="Events" items={results.events} onSelect={() => setOpen(false)} />
              <ResultGroup label="Products" items={results.products} onSelect={() => setOpen(false)} />
              <Link
                href={`/businesses?q=${encodeURIComponent(term)}`}
                onClick={() => setOpen(false)}
                className="mt-1 block rounded-xl px-3 py-2.5 text-center text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
              >
                View all results →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroup({
  label,
  items,
  onSelect,
}: {
  label: string;
  items: SearchResultItem[];
  onSelect: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-1 last:mb-0">
      <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-ink/40">{label}</p>
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          onClick={onSelect}
          className="flex items-center gap-3 rounded-xl px-3 py-2 transition hover:bg-black/[0.03]"
        >
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-mist">
            {item.image && <Image src={item.image} alt="" fill sizes="36px" className="object-cover" />}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{item.name}</p>
            {item.subtitle && <p className="truncate text-xs text-ink/50">{item.subtitle}</p>}
          </div>
        </Link>
      ))}
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-ink/40">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
