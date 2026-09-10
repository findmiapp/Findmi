"use client";

import { useEffect, useState } from "react";

export interface AccountSearchResult {
  value: string;
  label: string;
  sublabel?: string;
  image_url?: string | null;
  // Event Manager Location UX pass — carried only by entity="locations"
  // results, so the picker can build a rich "selected Location" card
  // (name, category, full address, View Location link) without a second
  // fetch. Always undefined for entity="businesses".
  slug?: string;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  postal_code?: string | null;
  category?: string | null;
}

/** Debounced, cancellable search against /api/account/search — the
 * member-facing counterpart to components/admin/useAdminSearch.ts, same
 * shape, just pointed at the member-authenticated route (any signed-in
 * user, not just a founder admin session) and scoped to the two entity
 * types Event Manager needs: "businesses" (Participating Businesses
 * invite) and "locations" (Location tab).
 *
 * Event Manager Location UX pass — an opt-in `browseEmpty` flag additionally
 * fetches on an EMPTY query (debounced, same as any other keystroke) so a
 * picker can show an A-Z browse list the moment it's focused, not only once
 * someone starts typing (see EventLocationField, the only caller that
 * passes it). Defaults to false, so every existing caller of this hook —
 * Participating Businesses' entity="businesses" picker, and Business
 * Manager's own entity="locations" Appearance-venue picker — keeps its
 * exact original behavior (nothing fetched until a real query exists).
 * Never scoped by entity: it's the caller's choice, not the entity's. */
export function useAccountSearch(entity: "businesses" | "locations", query: string, options?: { browseEmpty?: boolean }) {
  const browseEmpty = options?.browseEmpty ?? false;
  const [results, setResults] = useState<AccountSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q && !browseEmpty) {
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
  }, [entity, query, browseEmpty]);

  return { results, loading };
}
