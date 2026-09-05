"use client";

import { useEffect, useRef, useState } from "react";
import SupabaseImage from "./SupabaseImage";
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
//
// Homepage Market Filtering V1 — `marketSlug` (the homepage's own current
// ?market= value, if any) is threaded into the live-suggestions fetch and
// both outbound business-search links (submit + "View all results"), but
// ONLY affects the business branch server-side (see /api/homepage-search's
// own note) — event/product suggestions and their links are unaffected.
export default function SearchBar({ marketSlug }: { marketSlug?: string }) {
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
        const marketParam = marketSlug ? `&market=${encodeURIComponent(marketSlug)}` : "";
        const res = await fetch(`/api/homepage-search?q=${encodeURIComponent(term)}${marketParam}`, { cache: "no-store" });
        const data: SearchResults = await res.json();
        setResults(data);
      } catch {
        setResults(EMPTY);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, marketSlug]);

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
    if (marketSlug) params.set("market", marketSlug);
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
        className="flex w-full items-center gap-2 rounded-full border border-black/10 bg-white py-1.5 pl-4 pr-1.5 shadow-sm transition focus-within:border-ink/25"
      >
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
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-findmi text-white transition hover:bg-findmi-600"
        >
          <SearchGlyph className="h-5 w-5" />
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
                href={`/businesses?q=${encodeURIComponent(term)}${marketSlug ? `&market=${encodeURIComponent(marketSlug)}` : ""}`}
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
            {item.image && <SupabaseImage src={item.image} alt="" fill sizes="36px" className="object-cover" />}
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

function SearchGlyph({ className = "h-4 w-4 shrink-0 text-ink/40" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
