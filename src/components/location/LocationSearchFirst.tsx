"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import NavIcon from "@/components/NavIcon";

/** Add Location — SEARCH FINDMI FIRST (Findmi Consolidation pass).
 *
 * A prominent "Search for a location or address" box searches existing
 * Findmi Locations as the person types (debounced, ≥ 2 characters, ≤ 20
 * rows from the trigram-indexed /api/account/search). For each match:
 *   - a Location this person manages  → Connect (to the current Business)
 *   - any other public Location       → View · Request To Manage (the
 *                                        existing claim flow)
 *   - a Location still in review      → shown as already submitted
 * Only when nothing fits does "Create New Location" reveal the quick-create
 * form (`children`), with what was typed carried into its Name field.
 * Never a nested <form>: Connect posts through the parent-supplied action. */

export const LOCATION_SEARCH_DEBOUNCE_MS = 300;
export const LOCATION_SEARCH_MIN_CHARS = 2;

export interface LocationSearchResult {
  value: string;
  label: string;
  slug: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  is_public: boolean;
  managed?: boolean;
  image_url: string | null;
}

type SearchState = { status: "idle" } | { status: "loading" } | { status: "done"; results: LocationSearchResult[] } | { status: "error" };

export default function LocationSearchFirst({
  initialQuery = "",
  startCreating = false,
  businessName = null,
  connectAction = null,
  signedIn,
  children,
}: {
  initialQuery?: string;
  /** Skip straight to the form (an error round-trip, or a resumed draft). */
  startCreating?: boolean;
  /** The Business this Location is being added for, when known. */
  businessName?: string | null;
  /** Business context: connects a Location this person manages. */
  connectAction?: ((formData: FormData) => void | Promise<void>) | null;
  signedIn: boolean;
  /** The quick-create form (server-rendered), revealed by "Create New
   * Location"; what was typed is carried into its empty Name field. */
  children: ReactNode;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [creating, setCreating] = useState(startCreating);
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const requestRef = useRef(0);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (creating) return;
    const q = query.trim();
    const request = ++requestRef.current;
    if (q.length < LOCATION_SEARCH_MIN_CHARS) {
      setSearch({ status: "idle" });
      return;
    }
    setSearch({ status: "loading" });
    const t = setTimeout(async () => {
      try {
        // Signed in: also known-but-unlisted places (so a pending
        // submission isn't submitted twice). Signed out: public only.
        const scope = signedIn ? "&scope=place" : "";
        const res = await fetch(`/api/account/search?entity=locations${scope}&q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { results?: LocationSearchResult[] };
        if (request === requestRef.current) setSearch({ status: "done", results: data.results ?? [] });
      } catch {
        if (request === requestRef.current) setSearch({ status: "error" });
      }
    }, LOCATION_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, creating, signedIn]);

  const startCreate = () => {
    setCreating(true);
    requestAnimationFrame(() => {
      const nameInput = formRef.current?.querySelector<HTMLInputElement>('input[name="name"]');
      if (nameInput && !nameInput.value && query.trim()) nameInput.value = query.trim();
      nameInput?.focus();
    });
  };

  if (creating) {
    return (
      <div ref={formRef}>
        <button type="button" onClick={() => setCreating(false)} className="mb-3 text-metadata font-semibold text-muted hover:text-primary">
          &larr; Back to search
        </button>
        {children}
      </div>
    );
  }

  const results = search.status === "done" ? search.results : [];
  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="sr-only">Search for a location or address</span>
        <span className="relative block">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-subtle">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            autoCapitalize="words"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
            placeholder="Search for a location or address"
            autoFocus
            autoComplete="off"
            className="h-12 w-full rounded-2xl border border-black/10 bg-white pl-11 pr-3.5 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20"
          />
        </span>
      </label>

      <div aria-live="polite" className="flex flex-col gap-2">
        {search.status === "idle" && <p className="text-metadata text-muted">Search Findmi first — the place may already be here.</p>}
        {search.status === "loading" && <p className="text-metadata text-muted">Searching Findmi…</p>}
        {search.status === "error" && <p className="text-metadata text-muted">Couldn&rsquo;t search right now — you can still add it below.</p>}
        {search.status === "done" && results.length === 0 && <p className="text-metadata text-muted">No Findmi Location matches &ldquo;{query.trim()}&rdquo;.</p>}
        {results.length > 0 && (
          <>
            <p className="text-label font-bold uppercase text-subtle">Already On Findmi?</p>
            <ul className="flex flex-col gap-2">
              {results.map((r) => (
                <li key={r.value}>
                  <ResultCard result={r} businessName={businessName} connectAction={connectAction} signedIn={signedIn} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={startCreate}
        className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl border border-dashed border-black/15 bg-white px-4 py-3 text-left transition hover:border-findmi/50"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-lg font-bold text-findmi-700">+</span>
        <span className="min-w-0 flex-1">
          <span className="block text-card-title font-semibold text-primary">Create New Location</span>
          <span className="block text-metadata text-muted">{results.length > 0 ? "None of these is the right place" : "Add a place that isn’t on Findmi yet"}</span>
        </span>
      </button>
    </div>
  );
}

function ResultCard({
  result: r,
  businessName,
  connectAction,
  signedIn,
}: {
  result: LocationSearchResult;
  businessName: string | null;
  connectAction: ((formData: FormData) => void | Promise<void>) | null;
  signedIn: boolean;
}) {
  const line = [r.address, [r.city, r.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const claimHref = signedIn ? `/location/${r.slug}?claim=1` : `/login?next=${encodeURIComponent(`/location/${r.slug}?claim=1`)}`;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-black/[0.08] bg-white p-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-findmi-50 text-findmi-700">
        {r.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- small preview of a stored Location image
          <img src={r.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <NavIcon name="pin" className="h-5 w-5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold text-primary">
          {r.is_public ? (
            <Link href={`/location/${r.slug}`} className="hover:underline">
              {r.label}
            </Link>
          ) : (
            r.label
          )}
        </span>
        {line && <span className="block truncate text-metadata text-muted">{line}</span>}
        {!r.is_public && <span className="block text-microcopy font-semibold text-amber-700">Already submitted · Pending review</span>}
      </span>
      {r.managed && connectAction ? (
        <form action={connectAction}>
          <input type="hidden" name="location_id" value={r.value} />
          <button type="submit" className="flex h-9 shrink-0 items-center rounded-full bg-findmi px-3.5 text-metadata font-bold text-white transition hover:bg-findmi-600">
            Connect
          </button>
        </form>
      ) : r.managed ? (
        <span className="shrink-0 text-microcopy font-semibold text-findmi-700">You manage this</span>
      ) : r.is_public ? (
        <Link
          href={claimHref}
          aria-label={`Request to manage ${r.label}${businessName ? ` for ${businessName}` : ""}`}
          className="flex h-9 shrink-0 items-center rounded-full border border-black/10 px-3.5 text-metadata font-bold text-primary transition hover:border-black/20"
        >
          Request To Manage
        </Link>
      ) : null}
    </div>
  );
}
