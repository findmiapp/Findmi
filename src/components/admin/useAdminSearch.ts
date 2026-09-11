"use client";

import { useEffect, useState } from "react";

export interface SearchResult {
  value: string;
  label: string;
  sublabel?: string;
  image_url?: string | null;
  // Event <-> Venue/Location Relational Workflow pass — additive, optional
  // fields the "locations" entity's results carry (see /admin/api/search's
  // own "locations" branch) so a caller (EventOccurrencesEditor) can show
  // a fuller selected-Location card without a second request. Every other
  // entity/caller leaves these undefined and is unaffected.
  slug?: string;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  postal_code?: string | null;
  category?: string | null;
}

/** Debounced, cancellable search against /admin/api/search — backs every
 * relationship picker so typing never fires a request per keystroke and a
 * stale response can't clobber a newer one. Returns at most ~20 results;
 * never the whole table (see Part I — bounded relationship search). */
export function useAdminSearch(entity: "businesses" | "events" | "products" | "people" | "locations", query: string) {
  const [results, setResults] = useState<SearchResult[]>([]);
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
      fetch(`/admin/api/search?entity=${entity}&q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data: { results?: SearchResult[] }) => setResults(data.results ?? []))
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
