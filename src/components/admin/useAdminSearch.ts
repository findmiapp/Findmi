"use client";

import { useEffect, useState } from "react";

export interface SearchResult {
  value: string;
  label: string;
  sublabel?: string;
  image_url?: string | null;
}

/** Debounced, cancellable search against /admin/api/search — backs every
 * relationship picker so typing never fires a request per keystroke and a
 * stale response can't clobber a newer one. Returns at most ~20 results;
 * never the whole table (see Part I — bounded relationship search). */
export function useAdminSearch(entity: "businesses" | "events" | "products", query: string) {
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
