"use client";

import { useState } from "react";
import BusinessLogoCard from "./BusinessLogoCard";
import type { NextAppearanceHint } from "@/lib/data";
import type { BusinessWithCategories, Category } from "@/lib/types";

/** Brands We Love (and any other "businesses" Homepage Row) gets its own
 * compact business-category filter directly beneath the row's title —
 * Part 11/12 of the live-QA pass. `categories` is scoped to THIS row's
 * own filters (see page.tsx's getCategoriesForDynamicBusinessRow /
 * dedupeCategories) — never the generic homepage-wide category list —
 * so a shown chip can never be a guaranteed dead end. The default ("All")
 * state is exactly what the server already rendered; selecting a
 * category re-fetches from /api/homepage-business-row, which keeps a
 * curated row's results within its own curated set (see that route's own
 * note) rather than ever expanding to the global businesses table.
 *
 * A fetch failure is tracked separately from "the combo genuinely has no
 * businesses" (live-QA fix pass) — previously indistinguishable, so a
 * transient failure silently read as "the filter is broken."
 *
 * Homepage Market Filtering V1 — `marketSlug` is passed down from the
 * page's own ?market= only for a DYNAMIC row (the parent never passes it
 * for a curated row — see page.tsx's HomepageRowSection — so a curated
 * row's re-fetch here is byte-identical to before this pass regardless of
 * the homepage's selected Market). When present, every category re-fetch
 * stays scoped to that same Market — no separate persistence, just the
 * one value already threaded down from the page's own query string. */
export default function HomepageBusinessRow({
  rowId,
  pageId,
  contentType,
  mode,
  pinnedIds,
  initialItems,
  categories,
  appearanceHints,
  marketSlug,
}: {
  rowId: string;
  initialItems: BusinessWithCategories[];
  categories: Category[];
  /** Bulk-fetched server-side, one call per row (visual polish pass item
   * 2) — never one query per card. Keyed by business id; a business with
   * nothing upcoming just has no entry, so BusinessLogoCard's NEXT UP
   * module correctly omits itself rather than fabricating anything. */
  appearanceHints: Record<string, NextAppearanceHint>;
  marketSlug?: string;
  /** Analytics Phase 2A — Discovery Page Builder attribution. `pinnedIds`
   * stays correct even after a client-side category re-fetch: origin is
   * purely id-membership in the row's own founder-configured pin list,
   * never dependent on which query produced the currently-shown items. */
  pageId: string;
  contentType: string;
  mode: string;
  pinnedIds: string[];
}) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, BusinessWithCategories[]>>({});
  const [hintsCache, setHintsCache] = useState<Record<string, Record<string, NextAppearanceHint>>>({});
  const [loading, setLoading] = useState(false);
  const [failedCategory, setFailedCategory] = useState<string | null>(null);

  const items = activeCategory ? (cache[activeCategory] ?? []) : initialItems;
  const hints = activeCategory ? (hintsCache[activeCategory] ?? {}) : appearanceHints;
  const failed = activeCategory !== null && failedCategory === activeCategory;

  async function loadCategory(slug: string) {
    if (cache[slug]) return;
    setLoading(true);
    setFailedCategory(null);
    try {
      const marketParam = marketSlug ? `&market=${encodeURIComponent(marketSlug)}` : "";
      const res = await fetch(
        `/api/homepage-business-row?rowId=${rowId}&category=${encodeURIComponent(slug)}${marketParam}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`homepage-business-row ${res.status}`);
      const data: { businesses: BusinessWithCategories[]; appearanceHints: Record<string, NextAppearanceHint> } =
        await res.json();
      setCache((prev) => ({ ...prev, [slug]: data.businesses }));
      setHintsCache((prev) => ({ ...prev, [slug]: data.appearanceHints }));
    } catch {
      setFailedCategory(slug);
    } finally {
      setLoading(false);
    }
  }

  function selectCategory(slug: string | null) {
    setActiveCategory(slug);
    if (slug) loadCategory(slug);
  }

  return (
    <div>
      {categories.length > 0 && (
        <div className="mb-3 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => selectCategory(null)}
            className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              !activeCategory ? "bg-ink/10 text-ink" : "text-ink/40 hover:text-ink/60"
            }`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => selectCategory(c.slug)}
              className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                activeCategory === c.slug ? "bg-ink/10 text-ink" : "text-ink/40 hover:text-ink/60"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="px-4 text-sm text-ink/45 sm:px-6">Loading…</p>
      ) : failed ? (
        <div className="px-4 sm:px-6">
          <p className="text-sm text-ink/45">Couldn&rsquo;t load this — try again.</p>
          <button
            type="button"
            onClick={() => activeCategory && loadCategory(activeCategory)}
            className="mt-1.5 text-xs font-bold uppercase tracking-wide text-findmi-700 hover:underline"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="px-4 text-sm text-ink/45 sm:px-6">No brands in this category yet.</p>
      ) : (
        /* Brands We Love Card Width Consistency hotfix — the Discovery
           Home Composition Reset's index-based `i === 0 ? wide : narrow`
           ternary made every card's outer geometry depend on its
           position in the row rather than on the viewport, so which
           business rendered "wide" changed with every shuffle-within-tier
           reshuffle (see lib/data.ts's shuffleWithinFeaturedTiers) — the
           rail visibly changed card widths as a user scrolled, which read
           as broken, not as an intentional lead card. Reverted to the one
           uniform width this exact call site used before that pass
           (w-[76vw] max-w-[340px] shrink-0 sm:w-96) — every card the same
           size at a given viewport, BusinessLogoCard itself untouched
           (it's `w-full`, purely wrapper-driven). */
        <div className="flex gap-3 overflow-x-auto px-4 pb-2 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((b, i) => (
            <div key={b.id} className="w-[76vw] max-w-[340px] shrink-0 sm:w-96">
              <BusinessLogoCard
                business={b}
                nextAppearance={hints[b.id]}
                analyticsContext={{
                  pageType: "home",
                  placement: "homepage_row",
                  discoveryPageId: pageId,
                  discoverySectionId: rowId,
                  sectionContentType: contentType,
                  sectionMode: mode,
                  origin: mode === "hybrid" ? (pinnedIds.includes(b.id) ? "pinned" : "auto") : undefined,
                  position: i + 1,
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
