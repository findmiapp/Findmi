"use client";

import { useState } from "react";
import Link from "next/link";
import type { EventWithCategories } from "@/lib/types";
import CompactEventCard from "./CompactEventCard";
import { HorizontalScroller } from "./Section";

// Homepage-only: the "Upcoming Near You" discovery filters + feed. All
// four data-backed tabs are fetched server-side up front (same
// prefetch-everything-then-swap-client-side pattern as HomeDiscoveryTabs)
// so switching tabs never triggers a network request. "Popular" is a real
// signal — events.is_featured, the same founder-curation flag Featured
// Events has always used (getFeaturedEvents) — not invented. "Near Me"
// has no real backing today: FindMi has no geolocation/distance feature,
// so rather than fabricate a sorted feed, it's a plain link to full event
// search instead of a fifth data tab. See the homepage implementation
// report for this and the missing availability/attendance signal.
const TABS = [
  { key: "today", label: "Today" },
  { key: "weekend", label: "This Weekend" },
  { key: "anytime", label: "All Events" },
  { key: "popular", label: "Popular" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function HomeEventDiscovery({
  today,
  weekend,
  anytime,
  popular,
}: Record<TabKey, EventWithCategories[]>) {
  const lists: Record<TabKey, EventWithCategories[]> = { today, weekend, anytime, popular };
  const [active, setActive] = useState<TabKey>("today");
  const items = lists[active];

  return (
    <div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:-mx-6 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
              active === t.key ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
            }`}
          >
            {t.label}
          </button>
        ))}
        <Link
          href="/businesses"
          className="shrink-0 whitespace-nowrap rounded-full border border-black/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-ink/60 transition hover:border-black/20"
        >
          Near Me
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 px-4 text-sm text-ink/45 sm:px-6">Nothing in this window yet — check back soon.</p>
      ) : (
        <div className="mt-3">
          <HorizontalScroller>
            {items.map((event) => (
              <div key={event.id} className="w-[42%] min-w-[148px] max-w-[172px] shrink-0 sm:w-56 sm:max-w-none">
                <CompactEventCard event={event} />
              </div>
            ))}
          </HorizontalScroller>
        </div>
      )}
    </div>
  );
}
