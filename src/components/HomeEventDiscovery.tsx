"use client";

import { useState } from "react";
import type { Category, EventWithCategories } from "@/lib/types";
import HomeEventCard from "./HomeEventCard";

// Homepage "Upcoming Events Near You" discovery — primary time filters +
// a secondary, visually lighter event category filter beneath them, and
// the two COMBINE (This Weekend + a category = both conditions applied
// together), per the 2026 feed-builder pass (Part 3).
//
// "Up Next" is the default tab (not "Today" — a homepage that goes quiet
// whenever nothing's happening in the next 24h reads as dead). It's the
// exact same real, chronological, unfiltered upcoming-events query "All
// Events" already uses — nearest start time first. That overlap is
// intentional and disclosed, not a bug.
//
// The four time windows are prefetched server-side (zero latency, the
// common no-category case). Selecting a category re-fetches from
// /api/homepage-events (live, combining both filters server-side via the
// same getEventsDiscovery() every other events query uses) rather than
// prefetching every Time×Category combination, which doesn't scale as
// more categories get used — see that route's own note. Results are
// cached per (time, category) combo for the life of the page so flipping
// between already-seen filters doesn't re-fetch.
//
// A fetch failure is tracked separately from "the combo genuinely has no
// events" (live-QA fix pass) — the two used to be indistinguishable (a
// caught error just left the cache empty, so it rendered the same
// "Nothing in this category" copy a real empty result would), which
// meant a transient failure silently read as "your filters are broken."
const TIME_TABS = [
  { key: "upNext", label: "Up Next" },
  { key: "today", label: "Today" },
  { key: "weekend", label: "This Weekend" },
  { key: "anytime", label: "All Events" },
] as const;

type TimeKey = (typeof TIME_TABS)[number]["key"];

export default function HomeEventDiscovery({
  upNext,
  today,
  weekend,
  anytime,
  eventCategories,
}: Record<TimeKey, EventWithCategories[]> & { eventCategories: Category[] }) {
  const prefetched: Record<TimeKey, EventWithCategories[]> = { upNext, today, weekend, anytime };
  const [activeTime, setActiveTime] = useState<TimeKey>("upNext");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, EventWithCategories[]>>({});
  const [loading, setLoading] = useState(false);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const cacheKey = `${activeTime}:${activeCategory ?? ""}`;
  const items = activeCategory ? (cache[cacheKey] ?? []) : prefetched[activeTime];
  const failed = activeCategory ? failedKey === cacheKey : false;

  async function loadCombo(timeKey: TimeKey, categorySlug: string) {
    const key = `${timeKey}:${categorySlug}`;
    if (cache[key]) return;
    setLoading(true);
    setFailedKey(null);
    try {
      const res = await fetch(`/api/homepage-events?when=${timeKey}&category=${encodeURIComponent(categorySlug)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`homepage-events ${res.status}`);
      const data: { events: EventWithCategories[] } = await res.json();
      setCache((prev) => ({ ...prev, [key]: data.events }));
    } catch {
      // Distinct from a genuinely empty result — see the file's own note.
      setFailedKey(key);
    } finally {
      setLoading(false);
    }
  }

  function selectCategory(slug: string | null) {
    setActiveCategory(slug);
    if (slug) loadCombo(activeTime, slug);
  }

  function selectTime(key: TimeKey) {
    setActiveTime(key);
    if (activeCategory) loadCombo(key, activeCategory);
  }

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-0.5 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TIME_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => selectTime(t.key)}
            className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
              activeTime === t.key ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Secondary category filter — visually lighter/smaller than the
          time pills above. Sourced from getEventCategories() (events
          actually tagged via event_categories on a real, upcoming event
          — see that function's note), never business categories.
          Renders nothing at all (not even "All Categories") when no
          event has a real category yet, rather than showing a filter
          with nothing to filter. */}
      {eventCategories.length > 0 && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => selectCategory(null)}
            className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              !activeCategory ? "bg-ink/10 text-ink" : "text-ink/40 hover:text-ink/60"
            }`}
          >
            All Categories
          </button>
          {eventCategories.map((c) => (
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
        <p className="mt-4 px-4 text-sm text-ink/45 sm:px-6">Loading…</p>
      ) : failed ? (
        <div className="mt-4 px-4 sm:px-6">
          <p className="text-sm text-ink/45">Couldn&rsquo;t load this — try again.</p>
          <button
            type="button"
            onClick={() => activeCategory && loadCombo(activeTime, activeCategory)}
            className="mt-1.5 text-xs font-bold uppercase tracking-wide text-findmi-700 hover:underline"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        // Compact, honest empty state — Today especially must never
        // silently substitute other events while staying highlighted.
        <p className="mt-4 px-4 text-sm text-ink/45 sm:px-6">
          {activeTime === "today"
            ? "Nothing today — check This Weekend or All Events."
            : activeCategory
              ? "No events here yet. Try another date or category."
              : "Nothing in this window yet."}
        </p>
      ) : (
        <div className="mt-3 flex gap-3 overflow-x-auto px-4 pb-1 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:snap-center [scroll-snap-type:x_mandatory]">
          {items.map((event) => (
            <div key={event.id} className="w-[74vw] max-w-[320px] shrink-0 sm:w-72">
              <HomeEventCard event={event} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
