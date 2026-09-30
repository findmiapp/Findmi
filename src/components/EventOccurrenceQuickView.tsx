"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import SupabaseImage from "./SupabaseImage";
import AddToCalendarButton from "./AddToCalendarButton";
import EventScheduleCtas from "./EventScheduleCtas";
import { RosterListItem } from "./EventBusinessRoster";
import LiveDot from "./LiveDot";
import type { EventBusinessListing, EventOccurrenceWithLocation } from "@/lib/data";
import type { ResolvedForm } from "@/lib/forms";
import type { EventLocationCardLocation } from "./EventLocationCard";
import { cityState, cityStateZip, formatDateShortInZone, formatTimeInZone, resolveVenueLabel } from "@/lib/format";

/** Occurrence Quick View — a polished bottom sheet for one selected real
 * occurrence, reusing data this page already has in hand rather than a
 * second fetch or a separate `/appearance/[id]`-style destination.
 *
 * Final Event Experience Polish pass — upgraded from the previous bare
 * date/venue/Directions/Calendar sheet into a proper visual event-detail
 * sheet: a cover image (the event's own existing imagery — never a
 * duplicated/copied image), the same date/venue hierarchy the top
 * logistics module uses (canonicalLocation as the same fallback when this
 * occurrence has no Location of its own), the SAME primary Tier A action
 * the main page resolves (EventScheduleCtas, reused verbatim — no second
 * CTA resolver), and the same Directions/Add to Calendar pair as before.
 * Businesses only render here when the selected occurrence's own already-
 * fetched roster is small enough to stay compact (see the businesses
 * block below) — this sheet is a quick glance, not a second vendor
 * browser; "Who You'll Find Here" on the main page remains the full
 * experience for a richer lineup. */
export default function EventOccurrenceQuickView({
  occurrence,
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
  businesses,
  onClose,
}: {
  occurrence: EventOccurrenceWithLocation;
  eventName: string;
  /** Analytics attribution only — passed straight through to EventScheduleCtas. */
  eventId: string;
  canonicalLocation: EventLocationCardLocation | null;
  coverImageUrl: string | null;
  ticketsEnabled: boolean;
  ticketsUrl: string | null;
  rsvpEnabled: boolean;
  rsvp: ResolvedForm | null;
  vendorApplicationsEnabled: boolean;
  vendorApplication: ResolvedForm | null;
  /** This occurrence's own already-fetched event_occurrence_businesses
   * roster (EventPublicView.tsx's rostersByOccurrence, keyed by this
   * occurrence's id) — zero new queries. */
  businesses: EventBusinessListing[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const cancelled = occurrence.status === "cancelled";
  const now = Date.now();
  const live = !cancelled && new Date(occurrence.start_at).getTime() <= now && new Date(occurrence.end_at).getTime() > now;

  // Same location precedence as EventScheduleSummary/EventUtilityActions:
  // this occurrence's own linked Location wins, then the event's own
  // already-resolved canonicalLocation, then plain manual venue text —
  // never a second, independently-invented notion of "where."
  const location = occurrence.location ?? canonicalLocation;
  const venueLabel = resolveVenueLabel({
    location,
    venue_name: occurrence.venue_name,
    address: occurrence.address,
    city: occurrence.city,
    state: occurrence.state,
  });
  const fullAddress = location
    ? [location.address, cityState(location.city, location.state)].filter(Boolean).join(", ")
    : [occurrence.address, cityStateZip(occurrence.city, occurrence.state, occurrence.postal_code)].filter(Boolean).join(", ");
  const mapsQuery = location
    ? [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(", ")
    : [venueLabel, occurrence.address, cityState(occurrence.city, occurrence.state)].filter(Boolean).join(", ");
  const directionsHref = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}` : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="occurrence-quick-view-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-white pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:max-h-[85vh] sm:max-w-md sm:rounded-3xl"
      >
        {/* Cover image — the event's own existing cover (same imagery the
            hero above uses), substantial but not full-screen; a branded
            fallback when the event has no image at all. */}
        <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-t-3xl bg-ink sm:h-44">
          {coverImageUrl ? (
            <SupabaseImage src={coverImageUrl} alt={eventName} fill unoptimized sizes="480px" className="object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-ink">
              <CalendarGlyph className="h-10 w-10 text-white/15" />
            </div>
          )}
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 45%)" }}
          />
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/55"
          >
            <CloseGlyph className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          <h2 id="occurrence-quick-view-title" className="font-display text-xl font-bold tracking-tight text-ink">
            {eventName}
          </h2>

          <div className="mt-3 flex flex-col gap-0.5 text-sm">
            <p className="font-bold text-ink">{formatDateShortInZone(occurrence.start_at, occurrence.timezone)}</p>
            {cancelled ? (
              <span className="mt-0.5 inline-flex w-fit items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                Cancelled
              </span>
            ) : (
              <p className="text-ink/55">
                {formatTimeInZone(occurrence.start_at, occurrence.timezone)} – {formatTimeInZone(occurrence.end_at, occurrence.timezone)}
              </p>
            )}
            {live && (
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-red-600">
                <LiveDot className="animate-happening-now-glow rounded-full text-red-600" />
                Happening Now
              </span>
            )}
            {venueLabel &&
              (location ? (
                <Link href={`/location/${location.slug}`} className="group mt-1 w-fit">
                  <span className="font-semibold text-ink transition group-hover:text-findmi-700">{venueLabel}</span>
                  {fullAddress && <span className="block text-xs text-ink/50">{fullAddress}</span>}
                </Link>
              ) : (
                <div className="mt-1">
                  <p className="font-semibold text-ink">{venueLabel}</p>
                  {fullAddress && <p className="text-xs text-ink/50">{fullAddress}</p>}
                </div>
              ))}
          </div>

          {/* Primary CTA — the EXACT same Tier A action resolver the main
              Event page uses (RSVP/Tickets/Apply to Vend), never a second
              independent resolution. Reads the shared occurrence context,
              which the card that opened this modal already set to THIS
              occurrence (select(occurrence.id) before onOpenQuickView —
              see EventOccurrenceCard's own handleSelect). */}
          <EventScheduleCtas
            eventId={eventId}
            ticketsEnabled={ticketsEnabled}
            ticketsUrl={ticketsUrl}
            rsvpEnabled={rsvpEnabled}
            rsvp={rsvp}
            vendorApplicationsEnabled={vendorApplicationsEnabled}
            vendorApplication={vendorApplication}
          />

          <div className="mt-2.5 flex gap-2">
            {directionsHref && (
              <a
                href={directionsHref}
                target="_blank"
                rel="noreferrer"
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-black/10 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30"
              >
                Directions
              </a>
            )}
            <div className="flex-1">
              <AddToCalendarButton
                title={eventName}
                location={venueLabel}
                startAt={occurrence.start_at}
                endAt={occurrence.end_at}
                layout="row"
              />
            </div>
          </div>

          {/* Optional occurrence businesses — compact, only when the
              already-fetched roster is small. Exactly one confirmed
              business reuses the same compact row "Who You'll Find Here"
              uses elsewhere (RosterListItem); two or more stays a single
              summary line rather than embedding the full lineup browser
              here — that richer experience already lives right below on
              the main page itself. */}
          {businesses.length === 1 && (
            <div className="mt-4 border-t border-black/5 pt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/40">Who You&rsquo;ll Find Here</p>
              <RosterListItem business={businesses[0]} />
            </div>
          )}
          {businesses.length > 1 && (
            <p className="mt-4 border-t border-black/5 pt-4 text-xs font-semibold text-ink/50">
              {businesses.length} businesses confirmed for this date
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
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
