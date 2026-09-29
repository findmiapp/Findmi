"use client";

import { useState } from "react";
import type { EventOccurrenceWithLocation } from "@/lib/data";
import { HorizontalScroller } from "./Section";
import EventOccurrenceCard from "./EventOccurrenceCard";
import EventOccurrenceQuickView from "./EventOccurrenceQuickView";

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
 * before this pass.
 *
 * QA Correction pass — this is also now the ONE shared
 * EventOccurrenceQuickView instance for every card in the rail (same
 * "one shared Quick View, owned by the parent" pattern
 * AppearanceFindMiHere already established for Appearance cards), so
 * opening one occurrence's modal from any card never duplicates it. */
export default function UpcomingDatesRail({
  occurrences,
  eventName,
}: {
  occurrences: EventOccurrenceWithLocation[];
  eventName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const hasMore = occurrences.length > VISIBLE_COUNT;
  const visible = expanded || !hasMore ? occurrences : occurrences.slice(0, VISIBLE_COUNT);
  const openOccurrence = occurrences.find((o) => o.id === openId) ?? null;

  return (
    <>
      <HorizontalScroller className="pt-2">
        {visible.map((occ) => (
          <EventOccurrenceCard key={occ.id} occurrence={occ} onOpenQuickView={setOpenId} />
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
      {openOccurrence && (
        <EventOccurrenceQuickView occurrence={openOccurrence} eventName={eventName} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}
