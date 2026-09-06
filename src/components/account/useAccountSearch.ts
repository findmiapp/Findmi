"use client";

import { useEffect, useState } from "react";

export interface AccountSearchResult {
  value: string;
  label: string;
  sublabel?: string;
  image_url?: string | null;
}

/** Debounced, cancellable search against /api/account/search — the
 * member-facing counterpart to components/admin/useAdminSearch.ts, same
 * shape, just pointed at the member-authenticated route (any signed-in
 * user, not just a founder admin session) and scoped to the two entity
 * types Event Manager needs: "businesses" (Participating Businesses
 * invite) and "locations" (Location tab). */
export function useAccountSearch(entity: "businesses" | "locations", query: string) {
  const [results, setResults] = useState<AccountSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/account/search?entity=${entity}&q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data: { results?: AccountSearchResult[] }) => setResults(data.results ?? []))
        .catch(() => {
          // Aborted (superseded by a newer keystroke) or a network hiccup —
          // either way the next successful query replaces this state.
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [entity, query]);

  return { results, loading };
}
