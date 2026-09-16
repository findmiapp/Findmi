"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { searchAdminGlobal, type AdminGlobalSearchEntityType, type AdminGlobalSearchResult } from "./search-actions";

const inputClass =
  "h-11 w-full rounded-xl border border-transparent bg-black/[0.04] pl-10 pr-3.5 text-sm text-ink placeholder:text-ink/40 transition focus:border-findmi/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-findmi/20";

const TYPE_LABELS: Record<AdminGlobalSearchEntityType, string> = {
  business: "Businesses",
  event: "Events",
  location: "Locations",
  product: "Products",
  appearance: "Appearances",
  account: "Accounts",
};

// Fixed display order, independent of whatever order results happen to
// resolve in from Promise.all in searchAdminGlobal.
const TYPE_ORDER: AdminGlobalSearchEntityType[] = ["business", "event", "location", "product", "appearance", "account"];

const MIN_QUERY_LENGTH = 2;
// Same 250ms debounce useAccountSearch (components/account/useAccountSearch.ts)
// already established for every other live-typeahead search in this
// codebase — one consistent convention, not a new one invented here.
const DEBOUNCE_MS = 250;

/** Admin Global Search — Findmi Admin's universal command/navigation
 * tool, so an admin can find any Business/Event/Location/Product/
 * Appearance/Account without first picking a section. Calls
 * searchAdminGlobal (search-actions.ts) directly — a plain admin-
 * authorized Server Action, not a new API route — the same "call a
 * server action from a client component via useTransition" shape
 * MemberLocationImageField/EventLocationField's own inline-creation panel
 * already use elsewhere in this codebase.
 *
 * Command Center V5 pass — visual treatment only (a muted "command
 * surface" that lifts to a focused Aqua-ringed field, plus a leading
 * search glyph) so it reads as Admin's primary instrument rather than a
 * generic form field; every state/query/debounce/routing behavior below
 * is byte-for-byte what shipped and was already live-verified in
 * production.
 *
 * Dismiss pattern mirrors EventLocationField's own search dropdown: a
 * blur-with-short-timeout close on the input, plus onMouseDown
 * preventDefault on each result so a pointer click still registers before
 * the timeout fires — the same proven mechanism, not a new one. This
 * pass deliberately does not add Arrow Up/Down keyboard navigation — no
 * existing Findmi search component has it to reuse, and building a full
 * command-palette interaction model is explicitly out of scope here. */
export default function AdminGlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<AdminGlobalSearchResult[]>([]);
  const [isPending, startTransition] = useTransition();
  const requestIdRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const found = await searchAdminGlobal(q);
        // Stale-response guard — a slower earlier request resolving after
        // a newer one would otherwise clobber the latest, correct results.
        if (requestId === requestIdRef.current) setResults(found);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const trimmed = query.trim();
  const showDropdown = open && trimmed.length >= MIN_QUERY_LENGTH;
  const groups = TYPE_ORDER.map((type) => ({ type, items: results.filter((r) => r.type === type) })).filter(
    (g) => g.items.length > 0
  );

  return (
    <div className="relative">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/35"
      >
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
        <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search Findmi…"
        className={inputClass}
      />
      {showDropdown && (
        <div className="absolute z-20 mt-1.5 max-h-[70vh] w-full overflow-y-auto rounded-xl border border-black/10 bg-white shadow-lg">
          {groups.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink/40">{isPending ? "Searching…" : "No results found"}</p>
          ) : (
            groups.map((group) => (
              <div key={group.type} className="border-b border-black/5 py-1 last:border-b-0">
                <p className="px-4 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-wide text-ink/35">
                  {TYPE_LABELS[group.type]}
                </p>
                {group.items.map((item) => (
                  <Link
                    key={`${item.type}-${item.id}`}
                    href={item.href}
                    onMouseDown={(e) => e.preventDefault()}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-black/[0.03]"
                  >
                    <span className="min-w-0 truncate text-sm text-ink">{item.label}</span>
                    <span className="ml-2 shrink-0 truncate text-xs text-ink/40">{item.subtitle}</span>
                  </Link>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
