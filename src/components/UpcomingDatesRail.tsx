"use client";

import { useState } from "react";
import type { EventOccurrenceWithLocation } from "@/lib/data";
import { HorizontalScroller } from "./Section";
import EventOccurrenceCard from "./EventOccurrenceCard";

const VISIBLE_COUNT = 10;

/** Public Upcoming Dates Mobile UX pass — "View all N" lives as the FINAL
 * item inside the same horizontal scroll rail as the date cards, never a
 * second line/section underneath the carousel. Bounded initial render is
 * preserved: only VISIBLE_COUNT real date cards (plus this one compact
 * trigger) ever mount before the visitor asks for more — tapping the
 * trigger simply widens the same rail to include every remaining date,
 * the smallest possible disclosure (no separate panel/section, nothing
 * outside this one scroll container). Every occurrence is already passed
 * to EventOccurrenceProvider by the caller regardless of how many cards
 * are visible here — the date SELECTOR context (and therefore Tier A
 * CTAs/Location/roster switching) is unaffected either way, exactly as
 * before this pass. */
export default function UpcomingDatesRail({ occurrences }: { occurrences: EventOccurrenceWithLocation[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = occurrences.length > VISIBLE_COUNT;
  const visible = expanded || !hasMore ? occurrences : occurrences.slice(0, VISIBLE_COUNT);

  return (
    <HorizontalScroller className="pt-2">
      {visible.map((occ) => (
        <EventOccurrenceCard key={occ.id} occurrence={occ} />
      ))}
      {hasMore && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-20 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border border-black/10 bg-black/[0.02] text-center text-findmi-700 transition hover:border-findmi/40 hover:bg-findmi-50"
        >
          <span className="text-[10px] font-bold uppercase leading-tight tracking-wide">View all</span>
          <span className="text-sm font-bold leading-none">{occurrences.length}</span>
        </button>
      )}
    </HorizontalScroller>
  );
}
