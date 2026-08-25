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

/**
 * Shared header search — UI cleanup pass item 7. The header's search
 * icon/link used to just forward to /businesses; this replaces it with
 * the same live typeahead SearchBar already built for the homepage,
 * powered by the exact same /api/homepage-search route (no second search
 * backend — that route already just fans out to the same public
 * searchBusinesses/getEventsDiscovery/getMarketplaceProducts functions
 * every other page uses). People aren't included: there's no existing
 * people-search query to reuse, and this pass reuses architecture rather
 * than building new backend surface.
 *
 * The fetch/debounce logic is intentionally duplicated from SearchBar
 * rather than extracted into a shared hook — SearchBar stays exactly as
 * it is (the homepage's own always-visible instance), this is a second,
 * differently-shaped caller (a compact trigger + dropdown, not an
 * always-open bar), matching this codebase's existing precedent of small,
 * self-contained duplication over a premature shared abstraction.
 */
export default function HeaderSearch({ variant }: { variant: "icon" | "text" }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
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

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function openPanel() {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function closePanel() {
    setOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    closePanel();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    router.push(`/businesses${params.toString() ? `?${params.toString()}` : ""}`);
  }

  const term = q.trim();
  const hasQuery = term.length >= MIN_CHARS;
  const hasResults = results.businesses.length + results.events.length + results.products.length > 0;

  return (
    <div ref={containerRef} className="relative">
      {variant === "icon" ? (
        <button
          type="button"
          onClick={openPanel}
          aria-label="Search"
          aria-expanded={open}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink transition active:scale-90"
        >
          <SearchGlyph className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={openPanel}
          aria-expanded={open}
          className="text-sm font-medium text-ink/70 transition hover:text-ink"
        >
          Search
        </button>
      )}

      {/* Visual polish pass item 5: the icon (mobile) variant used to be
          `absolute right-0` + `w-[92vw]` relative to the trigger's own
          small container — but that container isn't at the viewport's
          right edge (CartBadge/HamburgerMenu sit to its right in
          MobileHeader), so a vw-wide panel anchored there overflowed off
          the LEFT edge of the viewport by ~50-60px at 360-430px widths.
          Fixed positioning with explicit left/right insets anchors the
          panel to the viewport itself instead of the trigger, guaranteeing
          it always stays within a real gutter regardless of where the
          trigger sits in the header. The text (desktop) variant is
          unaffected — that one isn't the reported bug and desktop
          viewports have enough room for the trigger-relative approach. */}
      {open && (
        <div
          className={
            variant === "icon"
              ? "fixed left-3 right-3 top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] z-50 rounded-2xl border border-black/10 bg-white p-3 shadow-lg"
              : "absolute right-0 top-full z-50 mt-2 w-96 rounded-2xl border border-black/10 bg-white p-3 shadow-lg"
          }
        >
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 rounded-full border border-black/10 bg-black/[0.02] px-3.5 py-2"
          >
            <SearchGlyph className="h-4 w-4 shrink-0 text-ink/40" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closePanel();
              }}
              type="text"
              role="combobox"
              aria-expanded={hasQuery}
              aria-controls="header-search-results"
              aria-autocomplete="list"
              placeholder="Search businesses, events, products..."
              className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink/40 focus:outline-none"
            />
          </form>

          <div id="header-search-results" role="listbox" className="mt-2 max-h-[60vh] overflow-y-auto">
            {!hasQuery ? (
              <p className="px-3 py-4 text-center text-sm text-ink/40">Start typing to search.</p>
            ) : loading && !hasResults ? (
              <p className="px-3 py-4 text-center text-sm text-ink/45">Searching…</p>
            ) : !hasResults ? (
              <p className="px-3 py-4 text-center text-sm text-ink/45">No matches for &ldquo;{term}&rdquo; yet.</p>
            ) : (
              <>
                <ResultGroup label="Businesses" items={results.businesses} onSelect={closePanel} />
                <ResultGroup label="Events" items={results.events} onSelect={closePanel} />
                <ResultGroup label="Products" items={results.products} onSelect={closePanel} />
                <Link
                  href={`/businesses?q=${encodeURIComponent(term)}`}
                  onClick={closePanel}
                  className="mt-1 block rounded-xl px-3 py-2.5 text-center text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
                >
                  View all results →
                </Link>
              </>
            )}
          </div>
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

function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
