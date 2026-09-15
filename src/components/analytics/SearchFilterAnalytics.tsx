"use client";

import { useEffect, useRef } from "react";
import { trackEvent } from "@/lib/analytics/track";
import type { AnalyticsPageType } from "@/lib/analytics/taxonomy";

/** Mounted once per public discovery route (/businesses, /events, /find,
 * /locations, /marketplace, /discover) to record real consumer search/
 * filter interactions — never the page's initial load, even when it
 * loads with a non-default query string (a shared/bookmarked link is not
 * "a consumer changing a filter"). Compares the current URL's tracked
 * params against a per-pathname snapshot in sessionStorage: only a
 * DIFFERENCE from a snapshot that already exists (i.e. this route was
 * already visited once this session) counts as a real change, and each
 * route's own <form method="get"> filters are left completely
 * untouched — this only observes the resulting URL after Next.js
 * re-renders the page, it doesn't intercept the submit. Renders nothing.
 *
 * `q` is treated as `search` (metadata: `has_query`, `query_length` only
 * — see the privacy note in the completed audit: normalized/capped, but
 * even the raw value is never sent here at all, since these are public
 * entity/category discovery searches with no reliable way to guarantee a
 * consumer never types something personal). Every other tracked param is
 * `filter_change` with `filter_type`/`selected_value` (the param's own
 * canonical slug/key — never a display label). */
export default function SearchFilterAnalytics({
  pageType,
  filterParams,
}: {
  pageType: AnalyticsPageType;
  /** Which query-string params on THIS route represent a real filter —
   * e.g. ["category", "market", "area", "when"]. Route-specific because
   * each discovery route's own filter vocabulary differs (see the
   * completed audit — never invented here). */
  filterParams: string[];
}) {
  const filterParamsRef = useRef(filterParams);
  filterParamsRef.current = filterParams;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname;
    const storageKey = `findmi_discovery_params:${path}`;
    const params = new URLSearchParams(window.location.search);

    const current: Record<string, string> = {};
    const q = params.get("q");
    if (q) current.q = q;
    for (const key of filterParamsRef.current) {
      const value = params.get(key);
      if (value) current[key] = value;
    }

    let previous: Record<string, string> | null = null;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      previous = raw ? (JSON.parse(raw) as Record<string, string>) : null;
    } catch {
      previous = null;
    }

    if (previous) {
      if (current.q && current.q !== previous.q) {
        trackEvent({
          event_name: "search",
          page_type: pageType,
          page_path: path,
          metadata: { has_query: true, query_length: current.q.length },
        });
      }
      for (const key of filterParamsRef.current) {
        if (current[key] && current[key] !== previous[key]) {
          trackEvent({
            event_name: "filter_change",
            page_type: pageType,
            page_path: path,
            metadata: { filter_type: key, selected_value: current[key] },
          });
        }
      }
    }

    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(current));
    } catch {
      // sessionStorage unavailable (private browsing, quota) — this
      // route just won't detect a change on the NEXT navigation either;
      // never a user-visible failure.
    }
    // Intentionally re-runs whenever the route's own searchParams change
    // (Next.js remounts/reuses this component across the same layout on
    // navigation) — re-reading window.location on each commit is exactly
    // the point.
  });

  return null;
}
