"use client";

import { useState } from "react";
import type { EventBusinessListing, EventOccurrenceWithLocation } from "@/lib/data";
import type { ResolvedForm } from "@/lib/forms";
import { HorizontalScroller } from "./Section";
import EventOccurrenceCard from "./EventOccurrenceCard";
import EventOccurrenceQuickView from "./EventOccurrenceQuickView";
import type { EventLocationCardLocation } from "./EventLocationCard";

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
 * opening one occurrence's modal from any card never duplicates it.
 *
 * Final Event Experience Polish pass — this is now also the thread-
 * through point for everything the upgraded Quick View needs but can't
 * compute itself: the event's own already-resolved canonicalLocation
 * (Location fallback), the SAME Tier A action-resolution props
 * EventScheduleCtas already consumes up on the main page (so the modal's
 * primary CTA reuses that exact resolver rather than a second one), the
 * event's own cover image (for the modal's cover), and the already-
 * fetched occurrence business rosters (so an occurrence's confirmed
 * businesses can show in the modal with zero new queries). All of this
 * was already computed once, server-side, in EventPublicView.tsx. */
export default function UpcomingDatesRail({
  occurrences,
  eventName,
  eventId,
  canonicalLocation,
  coverImageUrl,
  ticketsEnabled,
  ticketsUrl,
  rsvpEnabled,
  rsvp,
  vendorApplicationsEnabled,
  vendorApplication,
  rostersByOccurrence,
}: {
  occurrences: EventOccurrenceWithLocation[];
  eventName: string;
  eventId: string;
  canonicalLocation: EventLocationCardLocation | null;
  coverImageUrl: string | null;
  ticketsEnabled: boolean;
  ticketsUrl: string | null;
  rsvpEnabled: boolean;
  rsvp: ResolvedForm | null;
  vendorApplicationsEnabled: boolean;
  vendorApplication: ResolvedForm | null;
  rostersByOccurrence: Record<string, EventBusinessListing[]>;
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
          <EventOccurrenceCard key={occ.id} occurrence={occ} canonicalLocation={canonicalLocation} onOpenQuickView={setOpenId} />
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
        <EventOccurrenceQuickView
          occurrence={openOccurrence}
          eventName={eventName}
          eventId={eventId}
          canonicalLocation={canonicalLocation}
          coverImageUrl={coverImageUrl}
          ticketsEnabled={ticketsEnabled}
          ticketsUrl={ticketsUrl}
          rsvpEnabled={rsvpEnabled}
          rsvp={rsvp}
          vendorApplicationsEnabled={vendorApplicationsEnabled}
          vendorApplication={vendorApplication}
          businesses={rostersByOccurrence[openOccurrence.id] ?? []}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
