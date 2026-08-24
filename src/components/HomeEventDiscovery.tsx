"use client";

import { useState } from "react";
import Link from "next/link";
import type { EventWithCategories } from "@/lib/types";
import CompactEventCard from "./CompactEventCard";

// Homepage-only: the "Upcoming Near You" discovery filters + feed. All
// data-backed tabs are fetched server-side up front (same prefetch-then-
// swap-client-side pattern as HomeDiscoveryTabs) so switching tabs never
// triggers a network request.
//
// "Up Next" is the default tab (not "Today" — a homepage that goes quiet
// whenever nothing's happening in the next 24h reads as dead; see the
// implementation report). It's the exact same real, chronological,
// unfiltered upcoming-events query "All Events" already used — nearest
// start time first, nothing editorial/random/popularity-sorted. There
// isn't a further legitimate distinction to draw between the two beyond
// which one is selected by default; that overlap is intentional, not a
// bug, and is disclosed in the report rather than papered over with a
// fake secondary sort.
//
// "Popular" reuses events.is_featured — the same founder-curation signal
// Featured Events has always used — since there's no real popularity
// metric (view/RSVP counts) to sort by. "Near Me" has no geolocation
// backing at all, so it's a plain link into full discovery rather than a
// sixth data tab pretending to be distance-sorted.
//
// This component owns its own left/right padding (px-4 sm:px-6, no
// negative-margin edge-bleed trick) so its alignment can't drift out of
// sync with whatever padding its parent happens to apply — see the
// "filter pill panned too far left" bug this replaced.
const TABS = [
  { key: "upNext", label: "Up Next" },
  { key: "today", label: "Today" },
  { key: "weekend", label: "This Weekend" },
  { key: "anytime", label: "All Events" },
  { key: "popular", label: "Popular" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function HomeEventDiscovery({
  upNext,
  today,
  weekend,
  anytime,
  popular,
}: Record<TabKey, EventWithCategories[]>) {
  const lists: Record<TabKey, EventWithCategories[]> = { upNext, today, weekend, anytime, popular };
  const [active, setActive] = useState<TabKey>("upNext");
  const items = lists[active];

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-0.5 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        // Compact, honest empty state — Today especially must never
        // silently substitute other events while staying highlighted.
        <p className="mt-4 px-4 text-sm text-ink/45 sm:px-6">
          {active === "today" ? "Nothing today — check This Weekend or All Events." : "Nothing in this window yet."}
        </p>
      ) : (
        <div className="mt-3 flex gap-3 overflow-x-auto px-4 pb-1 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((event) => (
            <div key={event.id} className="w-[38%] min-w-[132px] max-w-[160px] shrink-0 sm:w-48">
              <CompactEventCard event={event} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
