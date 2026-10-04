"use client";

import { useState } from "react";
import SectionHeading from "./SectionHeading";
import ViewToggle, { useStoredView } from "./ViewToggle";
import type { EventBusinessListing, EventOccurrenceWithLocation } from "@/lib/data";
import type { ResolvedForm } from "@/lib/forms";
import { HorizontalScroller } from "./Section";
import EventOccurrenceCard, { describeOccurrence } from "./EventOccurrenceCard";
import SupabaseImage from "./SupabaseImage";
import LiveDot from "./LiveDot";
import { resolveAppearanceDisplayImage } from "@/lib/appearance-image";
import { useEventOccurrence } from "./EventOccurrenceContext";
import EventOccurrenceQuickView from "./EventOccurrenceQuickView";
import type { EventLocationCardLocation } from "./EventLocationCard";

const VISIBLE_COUNT = 10;
const VIEW_STORAGE_KEY = "findmi:event-dates-view";

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
  galleryImages,
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
  /** Location + Event Moment Continuity pass — the Event's own gallery
   * (event_images), already fetched once by EventPublicView.tsx for its
   * own cover lightbox; threaded through purely so each occurrence card
   * can deterministically vary its image when the Event has no cover of
   * its own, or when several occurrence cards would otherwise all repeat
   * it. No new query. */
  galleryImages: string[];
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
  // Cards / List preference — per device, Cards on first paint (shared
  // ViewToggle / useStoredView).
  const [view, chooseView] = useStoredView(VIEW_STORAGE_KEY);

  const hasMore = occurrences.length > VISIBLE_COUNT;
  const visible = expanded || !hasMore ? occurrences : occurrences.slice(0, VISIBLE_COUNT);
  const openOccurrence = occurrences.find((o) => o.id === openId) ?? null;
  const count = occurrences.length;
  // When a date is live right now (already announced by the hero), the
  // header counts the dates still to come — computed from the real
  // schedule, never estimated.
  const liveCount = occurrences.filter((o) => describeOccurrence(o, canonicalLocation).live).length;
  const countLabel =
    liveCount > 0 && count > liveCount
      ? `${count - liveCount} more date${count - liveCount === 1 ? "" : "s"}`
      : `${count} upcoming date${count === 1 ? "" : "s"}`;

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionHeading>Upcoming Dates</SectionHeading>
          <p className="mt-0.5 text-metadata text-muted">
            {countLabel}
          </p>
        </div>
        {count > 1 && (
          <ViewToggle view={view} onChange={chooseView} label="Show dates as" />
        )}
      </div>

      {view === "list" ? (
        <ul className="mt-3 flex flex-col gap-2">
          {visible.map((occ) => (
            <li key={occ.id}>
              <OccurrenceListRow
                occurrence={occ}
                canonicalLocation={canonicalLocation}
                coverImageUrl={coverImageUrl}
                galleryImages={galleryImages}
                onOpenQuickView={setOpenId}
              />
            </li>
          ))}
          {hasMore && !expanded && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="flex h-10 w-full items-center justify-center gap-1 rounded-xl text-metadata font-bold text-findmi-700 transition hover:bg-findmi-50/60"
              >
                View all {count} dates
              </button>
            </li>
          )}
        </ul>
      ) : (
        // Edge alignment: the rail bleeds to the page edge on phones and
        // tablets (first card starts exactly at the page gutter, snapping
        // back to it), and aligns with the column on desktop.
        <div className="-mx-4 mt-1 sm:-mx-6 lg:mx-0">
          <HorizontalScroller className="snap-x snap-mandatory scroll-px-4 pt-2 !gap-3 sm:scroll-px-6 lg:scroll-px-0 lg:px-0">
            {visible.map((occ) => (
              <div key={occ.id} className="shrink-0 snap-start">
                <EventOccurrenceCard
                  occurrence={occ}
                  canonicalLocation={canonicalLocation}
                  coverImageUrl={coverImageUrl}
                  galleryImages={galleryImages}
                  onOpenQuickView={setOpenId}
                />
              </div>
            ))}
            {hasMore && !expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="flex w-16 shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-2xl text-center text-findmi-700 transition hover:bg-findmi-50"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-findmi/30">
                  <ArrowGlyph className="h-4 w-4" />
                </span>
                <span className="text-[11px] font-bold leading-tight">View all {count}</span>
              </button>
            )}
            {/* Trailing spacer so the last card can snap with the same gutter. */}
            <span aria-hidden="true" className="w-px shrink-0" />
          </HorizontalScroller>
        </div>
      )}
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

/** Public Event V2.1 — a dense LIST row for one date. Same selection
 * contract as EventOccurrenceCard (select + open the shared Quick View),
 * same date/time/venue derivation (describeOccurrence) — one schedule
 * system, two presentations. */
/** A photographic LIST row for one date — thumbnail, date, time, place,
 * chevron. Same selection contract as EventOccurrenceCard (select + open
 * the shared Quick View) and the same date/time/venue derivation
 * (describeOccurrence) and image resolution — one schedule, two views. */
function OccurrenceListRow({
  occurrence,
  canonicalLocation,
  coverImageUrl,
  galleryImages,
  onOpenQuickView,
}: {
  occurrence: EventOccurrenceWithLocation;
  canonicalLocation: EventLocationCardLocation | null;
  coverImageUrl: string | null;
  galleryImages: string[];
  onOpenQuickView: (id: string) => void;
}) {
  const { selected, select } = useEventOccurrence();
  const isSelected = selected?.id === occurrence.id;
  const { cancelled, live, dateLabel, timeLabel, venueLabel } = describeOccurrence(occurrence, canonicalLocation);
  const imageUrl = resolveAppearanceDisplayImage({
    appearanceId: occurrence.id,
    specificImageUrl: coverImageUrl,
    galleryImages,
    businessCoverUrl: null,
  });
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={() => {
        select(occurrence.id);
        onOpenQuickView(occurrence.id);
      }}
      className={`flex w-full items-center gap-3 rounded-2xl border p-2 pr-3 text-left transition active:scale-[0.99] ${
        isSelected ? "border-findmi/50 bg-findmi-50/60" : "border-black/[0.05] bg-white hover:border-black/15"
      } ${cancelled && !isSelected ? "opacity-60" : ""}`}
    >
      <span className="relative h-[68px] w-[84px] shrink-0 overflow-hidden rounded-xl bg-mist">
        {imageUrl ? (
          <SupabaseImage src={imageUrl} alt="" fill sizes="84px" className="object-cover" />
        ) : (
          <span className="block h-full w-full bg-ink" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-body font-bold uppercase text-primary">{dateLabel}</span>
          {live && (
            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-red-600">
              <LiveDot className="text-red-500" />
              Live
            </span>
          )}
        </span>
        {cancelled ? (
          <span className="mt-0.5 block text-metadata font-semibold uppercase tracking-wide text-red-600">Cancelled</span>
        ) : (
          <span className="mt-0.5 block truncate text-metadata text-secondary">{timeLabel}</span>
        )}
        {venueLabel && (
          <span className="mt-0.5 flex items-center gap-1 text-metadata text-muted">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3 w-3 shrink-0 text-findmi-600">
              <path d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="2" />
            </svg>
            <span className="truncate">{venueLabel}</span>
          </span>
        )}
      </span>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4 shrink-0 text-ink/25">
        <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
