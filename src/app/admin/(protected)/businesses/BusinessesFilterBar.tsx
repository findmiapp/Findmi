"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";

interface Category {
  id: string;
  name: string;
}

const selectClass =
  "rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none";

/** Admin Businesses Live Search + Instant Filtering pass — replaces the old
 * `<form method="get">` + Filter button with a controlled client component
 * that pushes URL search params (via router.replace, wrapped in
 * useTransition) as the admin types (debounced ~300ms) or changes a select
 * (immediately, no debounce). The server-rendered results list is passed in
 * as `children` — a Server Component's already-resolved output — so this
 * component never re-fetches or re-implements the businesses query itself;
 * it only drives the same URL/searchParams the page already reads
 * (getAdminBusinesses stays the sole, authoritative query). isPending from
 * useTransition dims the results while the new RSC payload streams in,
 * giving "Updating…" feedback without a custom loading state. */
export default function BusinessesFilterBar({
  categories,
  initialQ,
  initialCategory,
  initialPublished,
  children,
}: {
  categories: Category[];
  initialQ: string;
  initialCategory: string;
  initialPublished: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Only the text field needs local state (for responsive typing +
  // debounce). The two selects are fully controlled by the current URL
  // params (passed in as props) so browser Back/Forward — which changes
  // those props via a fresh server render — is reflected immediately
  // without any extra sync logic.
  const [q, setQ] = useState(initialQ);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keeps the input in sync with external navigation (browser Back/Forward,
  // or the "Clear filters" reset below), without fighting the debounce
  // timer that drives our OWN navigations.
  useEffect(() => {
    setQ(initialQ);
  }, [initialQ]);

  function navigate(next: { q?: string; category?: string; published?: string }) {
    const params = new URLSearchParams();
    const nextQ = next.q ?? q;
    const nextCategory = next.category ?? initialCategory;
    const nextPublished = next.published ?? initialPublished;
    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextCategory) params.set("category", nextCategory);
    if (nextPublished) params.set("published", nextPublished);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  function handleQueryChange(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ q: value }), 300);
  }

  function handleSubmit(e: React.FormEvent) {
    // Enter key (or a mobile keyboard's "Go"/"Search" action) applies the
    // current value immediately rather than waiting out the debounce.
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    navigate({ q });
  }

  const hasActiveFilters = Boolean(q.trim() || initialCategory || initialPublished);

  function clearFilters() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQ("");
    navigate({ q: "", category: "", published: "" });
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="search"
          name="q"
          value={q}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search by name, slug, or city…"
          className="w-full min-w-0 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none sm:max-w-xs sm:flex-1"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={initialCategory}
            onChange={(e) => navigate({ category: e.target.value })}
            className={selectClass}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={initialPublished}
            onChange={(e) => navigate({ published: e.target.value })}
            className={selectClass}
          >
            <option value="">Published: All</option>
            <option value="public">Public only</option>
            <option value="pending_review">Pending Review only</option>
            <option value="demo">Demo/hidden only</option>
          </select>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-semibold text-ink/50 hover:text-ink"
            >
              Clear filters
            </button>
          )}
          {isPending && <span className="text-xs text-ink/40">Updating…</span>}
        </div>
      </form>

      <div className={`mt-4 transition-opacity ${isPending ? "opacity-50" : "opacity-100"}`}>{children}</div>
    </div>
  );
}
