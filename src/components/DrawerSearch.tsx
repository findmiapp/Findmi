"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SupabaseImage from "./SupabaseImage";

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

/**
 * Live search built into the mobile drawer — same query/debounce/results
 * shape as SearchBar (homepage) and HeaderSearch (desktop/mobile-icon
 * dropdown): all three call the exact same /api/homepage-search route,
 * which just fans out to the same public searchBusinesses/
 * getEventsDiscovery/getMarketplaceProducts functions every other page
 * already uses — no second search backend, no different ranking. The
 * difference here is purely presentational: results render INLINE, as
 * part of the drawer's own scrollable body (no `absolute`/`fixed` panel,
 * no floating card/shadow) so it reads as native drawer content instead
 * of a desktop dropdown pasted into a mobile sheet. Deliberately not
 * sharing a hook with SearchBar/HeaderSearch — same small, self-contained
 * duplication precedent those two already established over each other.
 */
export default function DrawerSearch({ onNavigate }: { onNavigate: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
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

  const term = q.trim();
  const hasQuery = term.length >= MIN_CHARS;
  const hasResults = results.businesses.length + results.events.length + results.products.length > 0;

  return (
    <div className="shrink-0 border-b border-black/5 px-3 py-2.5">
      <div className="flex items-center gap-2 rounded-full border border-black/10 bg-black/[0.02] px-3.5 py-2">
        <SearchGlyph className="h-4 w-4 shrink-0 text-ink/40" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="text"
          role="combobox"
          aria-expanded={hasQuery}
          aria-controls="drawer-search-results"
          aria-autocomplete="list"
          placeholder="Search FindMi..."
          className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink/40 focus:outline-none"
        />
      </div>

      {hasQuery && (
        <div id="drawer-search-results" role="listbox" className="mt-1 max-h-[45vh] overflow-y-auto">
          {loading && !hasResults ? (
            <p className="px-3 py-3 text-center text-sm text-ink/45">Searching…</p>
          ) : !hasResults ? (
            <p className="px-3 py-3 text-center text-sm text-ink/45">No matches for &ldquo;{term}&rdquo; yet.</p>
          ) : (
            <>
              <ResultGroup label="Businesses" items={results.businesses} onSelect={onNavigate} />
              <ResultGroup label="Events" items={results.events} onSelect={onNavigate} />
              <ResultGroup label="Products" items={results.products} onSelect={onNavigate} />
              <Link
                href={`/businesses?q=${encodeURIComponent(term)}`}
                onClick={onNavigate}
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

function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
