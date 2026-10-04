"use client";

import { useEffect, useState } from "react";
import type { EventBusinessListing, EventOccurrenceWithLocation } from "@/lib/data";
import type { ResolvedForm } from "@/lib/forms";
import { HorizontalScroller } from "./Section";
import EventOccurrenceCard, { describeOccurrence } from "./EventOccurrenceCard";
import { useEventOccurrence } from "./EventOccurrenceContext";
import EventOccurrenceQuickView from "./EventOccurrenceQuickView";
import type { EventLocationCardLocation } from "./EventLocationCard";

const VISIBLE_COUNT = 10;
const VIEW_STORAGE_KEY = "findmi:event-dates-view";
type DatesView = "cards" | "list";

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
  // Public Event V2.1 — Cards / List preference. Per-device localStorage
  // (same no-account pattern as Follow/Save); SSR and first paint are
  // always Cards, the stored choice applies after mount, so it never
  // blocks rendering. Read/write wrapped — storage can be unavailable.
  const [view, setView] = useState<DatesView>("cards");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_STORAGE_KEY) === "list") setView("list");
    } catch {
      // Storage unavailable — stay on the Cards default.
    }
  }, []);
  function chooseView(next: DatesView) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }

  const hasMore = occurrences.length > VISIBLE_COUNT;
  const visible = expanded || !hasMore ? occurrences : occurrences.slice(0, VISIBLE_COUNT);
  const openOccurrence = occurrences.find((o) => o.id === openId) ?? null;
  const count = occurrences.length;

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-section-title-lg font-bold text-primary">Upcoming dates</h2>
          <p className="mt-0.5 text-metadata text-muted">
            {count} upcoming date{count === 1 ? "" : "s"}
          </p>
        </div>
        {count > 1 && (
          <div role="group" aria-label="Show dates as" className="flex shrink-0 items-center gap-0.5 rounded-full border border-black/[0.08] p-0.5">
            <ViewToggleButton label="Cards" active={view === "cards"} onClick={() => chooseView("cards")}>
              <GridGlyph className="h-4 w-4" />
            </ViewToggleButton>
            <ViewToggleButton label="List" active={view === "list"} onClick={() => chooseView("list")}>
              <ListGlyph className="h-4 w-4" />
            </ViewToggleButton>
          </div>
        )}
      </div>

      {view === "list" ? (
        <ul className="mt-3 divide-y divide-black/[0.06] border-y border-black/[0.06]">
          {visible.map((occ) => (
            <li key={occ.id}>
              <OccurrenceListRow occurrence={occ} canonicalLocation={canonicalLocation} onOpenQuickView={setOpenId} />
            </li>
          ))}
          {hasMore && !expanded && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="flex h-11 w-full items-center justify-center gap-1 text-metadata font-bold text-findmi-700 transition hover:bg-findmi-50/60"
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
          <HorizontalScroller className="snap-x snap-mandatory scroll-px-4 pt-2 sm:scroll-px-6 lg:scroll-px-0 lg:px-0">
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

function ViewToggleButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`flex h-8 w-9 items-center justify-center rounded-full transition ${
        active ? "bg-findmi-50 text-findmi-700" : "text-ink/45 hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

/** Public Event V2.1 — a dense LIST row for one date. Same selection
 * contract as EventOccurrenceCard (select + open the shared Quick View),
 * same date/time/venue derivation (describeOccurrence) — one schedule
 * system, two presentations. */
function OccurrenceListRow({
  occurrence,
  canonicalLocation,
  onOpenQuickView,
}: {
  occurrence: EventOccurrenceWithLocation;
  canonicalLocation: EventLocationCardLocation | null;
  onOpenQuickView: (id: string) => void;
}) {
  const { selected, select } = useEventOccurrence();
  const isSelected = selected?.id === occurrence.id;
  const { cancelled, live, dateLabel, timeLabel, venueLabel } = describeOccurrence(occurrence, canonicalLocation);
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={() => {
        select(occurrence.id);
        onOpenQuickView(occurrence.id);
      }}
      className={`flex w-full items-center gap-3 px-1 py-2.5 text-left transition ${
        isSelected ? "bg-findmi-50/70" : "hover:bg-black/[0.02]"
      } ${cancelled && !isSelected ? "opacity-60" : ""}`}
    >
      <span className={`h-8 w-1 shrink-0 rounded-full ${isSelected ? "bg-findmi" : "bg-transparent"}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-bold text-primary">{dateLabel}</span>
        <span className="block truncate text-metadata text-muted">
          {[cancelled ? null : timeLabel, venueLabel].filter(Boolean).join(" · ")}
        </span>
      </span>
      {cancelled ? (
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-red-600">Cancelled</span>
      ) : live ? (
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-red-600">Now</span>
      ) : isSelected ? (
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-findmi-700">Selected</span>
      ) : null}
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink/25">
        <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function GridGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ListGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="4.75" cy="6" r="1.1" fill="currentColor" />
      <circle cx="4.75" cy="12" r="1.1" fill="currentColor" />
      <circle cx="4.75" cy="18" r="1.1" fill="currentColor" />
    </svg>
  );
}

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
