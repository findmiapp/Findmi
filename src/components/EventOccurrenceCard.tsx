"use client";

import type { EventOccurrenceWithLocation } from "@/lib/data";
import {
  formatDateShortInZone,
  formatDayOfMonthInZone,
  formatMonthAbbrevInZone,
  formatTimeInZone,
  resolveVenueLabel,
} from "@/lib/format";
import { resolveAppearanceDisplayImage } from "@/lib/appearance-image";
import { useEventOccurrence } from "./EventOccurrenceContext";
import type { EventLocationCardLocation } from "./EventLocationCard";
import LiveDot from "./LiveDot";
import SupabaseImage from "./SupabaseImage";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** True when `iso`'s local wall-clock time in `timezone` is exactly
 * midnight (00:00) — Midnight Display Polish pass. Used ONLY to decide
 * how an occurrence's end timestamp should be represented in the DATE
 * LABEL below; the actual stored timestamp is never touched, and the
 * TIME line always renders the real end time regardless (so "ends at
 * midnight" still correctly shows "12:00 AM"). */
function isExactlyMidnightInZone(iso: string, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(
    new Date(iso)
  );
  const hour = parts.find((p) => p.type === "hour")?.value;
  const minute = parts.find((p) => p.type === "minute")?.value;
  return hour === "00" && minute === "00";
}

/** One card in the public event page's "Upcoming Dates" row — Recurring
 * Events V2 makes this the occurrence SELECTOR for the whole page (see
 * EventOccurrenceContext); tapping selects it AND opens a lightweight
 * occurrence Quick View (see handleSelect below) — it still never
 * navigates. Per-occurrence ticket/RSVP/vendor-apply link resolution
 * (this card's previous click-through behavior) is explicitly deferred to
 * a later "CTA parity" pass — see the pass report. Every date/time renders
 * in the OCCURRENCE'S OWN timezone (occurrence.timezone), never the app's
 * global APP_TIMEZONE or the viewer's device timezone.
 *
 * Date/Time Hierarchy Polish pass — "when is this" is the primary
 * consumer question, so the date is now the card's dominant element (a
 * real heading-weight line, never the small/gray month+day the old
 * left-side icon tile used), with the time directly beneath it.
 *
 * Final Event Experience Polish pass — rebuilt information hierarchy:
 * DATE (boldest) -> TIME (muted, directly beneath) -> VENUE (muted, up
 * to two lines, never aggressively truncated to an ugly ellipsis-mid-
 * word string) -> STATUS (always last/lowest — a small glowing red dot +
 * "HAPPENING NOW", never bare "Now", and only when genuinely live) —
 * NOW no longer sits in the middle of the card breaking vertical
 * alignment across cards. `canonicalLocation` (the event's own already-
 * resolved fallback Location, passed down from EventPublicView.tsx via
 * UpcomingDatesRail) fills the venue line when this specific occurrence
 * has no location of its own but the event unambiguously has a real
 * Location anyway — same fallback EventScheduleSummary/EventUtilityActions
 * already apply, via the same shared resolveVenueLabel() helper
 * AppearanceFindMiHere's own Quick View already uses, rather than a new
 * venue-text formula. Selected treatment is intentionally restrained — a
 * thin aqua border and a light aqua tint, no ring, no shadow — elegant
 * over loud.
 *
 * Location + Event Moment Continuity pass — adds a photographic image
 * band above the existing date/time/venue text, matching the same
 * real-world-moment card family Business's FindMi Here cards and
 * Location's own moment cards already use. Occurrences have no image
 * field of their own, so this uses the Event's own cover first, then a
 * deterministic (never random) pick from the Event's own gallery — via
 * the same generic resolveAppearanceDisplayImage resolver Business/
 * Location already share — so multiple occurrence cards for the same
 * Event don't all repeat the identical cover photo. Every existing
 * behavior (selection, live determination, cancelled styling, the
 * Quick View open-on-tap) is completely unchanged. */
export default function EventOccurrenceCard({
  occurrence,
  canonicalLocation,
  coverImageUrl,
  galleryImages,
  onOpenQuickView,
}: {
  occurrence: EventOccurrenceWithLocation;
  canonicalLocation: EventLocationCardLocation | null;
  /** The Event's own cover_image_url — already resolved/fetched once by
   * EventPublicView.tsx, never a new query here. */
  coverImageUrl: string | null;
  /** The Event's own gallery (event_images), already fetched once by
   * EventPublicView.tsx for its own cover lightbox — reused here purely
   * for deterministic per-occurrence image variation. */
  galleryImages: string[];
  onOpenQuickView: (id: string) => void;
}) {
  const { selected, select } = useEventOccurrence();
  const isSelected = selected?.id === occurrence.id;
  const cancelled = occurrence.status === "cancelled";
  const venueLabel = resolveVenueLabel({
    location: occurrence.location ?? canonicalLocation,
    venue_name: occurrence.venue_name,
    address: occurrence.address,
    city: occurrence.city,
    state: occurrence.state,
  });

  const now = Date.now();
  const live = !cancelled && new Date(occurrence.start_at).getTime() <= now && new Date(occurrence.end_at).getTime() > now;

  // Midnight Display Polish: an occurrence ending exactly at local midnight
  // (e.g. 11:30 AM -> 12:00 AM the next day) reads to a visitor as "the
  // day it started," not a two-day span — so for DATE-LABEL purposes only,
  // roll the effective end back to the prior local calendar day. The real
  // occurrence.end_at is never touched, and the TIME line below always
  // renders the true end time (still "12:00 AM") regardless.
  const dateLabelEndIso = isExactlyMidnightInZone(occurrence.end_at, occurrence.timezone)
    ? new Date(new Date(occurrence.end_at).getTime() - ONE_DAY_MS).toISOString()
    : occurrence.end_at;

  // A multi-day occurrence (its own start/end fall on different calendar
  // days in ITS OWN timezone — e.g. an overnight date) gets both bounds
  // ("Sep 25 – Sep 26"); a same-day occurrence gets the fuller
  // weekday-inclusive form ("Fri, Sep 25") — never collapsed to a single
  // date when the occurrence genuinely spans two. Both branches use only
  // real occurrence data already available on this object.
  const sameDay =
    formatMonthAbbrevInZone(occurrence.start_at, occurrence.timezone) ===
      formatMonthAbbrevInZone(dateLabelEndIso, occurrence.timezone) &&
    formatDayOfMonthInZone(occurrence.start_at, occurrence.timezone) === formatDayOfMonthInZone(dateLabelEndIso, occurrence.timezone);
  const dateLabel = sameDay
    ? formatDateShortInZone(occurrence.start_at, occurrence.timezone)
    : `${formatMonthAbbrevInZone(occurrence.start_at, occurrence.timezone)} ${formatDayOfMonthInZone(occurrence.start_at, occurrence.timezone)} – ${formatMonthAbbrevInZone(dateLabelEndIso, occurrence.timezone)} ${formatDayOfMonthInZone(dateLabelEndIso, occurrence.timezone)}`;
  // Time-of-day only for both bounds, regardless of same-day/multi-day —
  // the date line above already conveys any day-crossing, so this line
  // never needs to fall back to a combined date+time string the way
  // formatTimeRangeInZone's own multi-day branch does.
  const timeLabel = `${formatTimeInZone(occurrence.start_at, occurrence.timezone)} – ${formatTimeInZone(occurrence.end_at, occurrence.timezone)}`;
  const imageUrl = resolveAppearanceDisplayImage({
    appearanceId: occurrence.id,
    specificImageUrl: coverImageUrl,
    galleryImages,
    businessCoverUrl: null,
  });

  // QA Correction pass — the previous fix (select + scroll the details
  // card into view) wasn't the desired final interaction. Tapping now
  // still selects the occurrence (unchanged — keeps the shared context/
  // Tier A CTAs/roster in sync exactly as before) and additionally opens
  // a lightweight occurrence Quick View (EventOccurrenceQuickView, owned
  // by the parent rail — UpcomingDatesRail — so every card shares one
  // instance, same pattern as AppearanceFindMiHere's shared Quick View).
  // The scroll-into-view behavior is removed: the modal supersedes it.
  function handleSelect() {
    select(occurrence.id);
    onOpenQuickView(occurrence.id);
  }

  return (
    <button
      type="button"
      onClick={handleSelect}
      aria-pressed={isSelected}
      className={`flex w-40 shrink-0 flex-col overflow-hidden rounded-2xl border text-left transition ${
        cancelled
          ? isSelected
            ? "border-red-300 bg-red-50/60"
            : "border-black/5 bg-black/[0.02] opacity-70"
          : isSelected
            ? "border-findmi bg-findmi-50"
            : "border-black/5 bg-white hover:border-black/20"
      }`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-mist">
        {imageUrl ? (
          <SupabaseImage src={imageUrl} alt="" fill sizes="160px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <CalendarGlyph className="h-6 w-6 text-white/25" />
          </div>
        )}
        {live && (
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
            <LiveDot className="text-white" />
            Happening Now
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 p-2.5">
        <p className="text-sm font-bold uppercase leading-tight text-ink">{dateLabel}</p>
        {cancelled ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Cancelled</p>
        ) : (
          <p className="text-xs font-medium text-ink/55">{timeLabel}</p>
        )}
        {venueLabel && <p className="line-clamp-2 text-xs leading-snug text-ink/45">{venueLabel}</p>}
      </div>
    </button>
  );
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
