"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import AddToCalendarButton from "./AddToCalendarButton";
import type { EventOccurrenceWithLocation } from "@/lib/data";
import { cityState, cityStateZip, formatDateShortInZone, formatTimeInZone, resolveVenueLabel } from "@/lib/format";

/** QA Correction pass — occurrence Quick View. Reuses the same modal
 * interaction language AppearanceQuickView already established (fixed
 * overlay, bottom-sheet on mobile/centered on desktop, Escape + body-
 * scroll-lock, focus moved to the close control) rather than inventing a
 * new dialog primitive, but is its own small component: an Event
 * occurrence has no single Business to anchor a Quick View around (several
 * businesses can participate in one occurrence), so AppearanceQuickView's
 * own business-identity header/View Business button genuinely don't fit
 * here — see EventOccurrenceCard's own note on why this pass didn't force
 * that shape onto occurrences. Deliberately small: date/time/venue/address
 * plus the two actions that are genuinely occurrence-specific (Directions,
 * Add to Calendar) — never a second copy of the full Event page. */
export default function EventOccurrenceQuickView({
  occurrence,
  eventName,
  onClose,
}: {
  occurrence: EventOccurrenceWithLocation;
  eventName: string;
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

  const venueLabel = resolveVenueLabel(occurrence);
  const location = cityState(occurrence.city, occurrence.state);
  const fullAddress = [occurrence.address, cityStateZip(occurrence.city, occurrence.state, occurrence.postal_code)]
    .filter(Boolean)
    .join(", ");
  const mapsQuery = [venueLabel, occurrence.address, location].filter(Boolean).join(", ");
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
        className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:max-h-[80vh] sm:max-w-md sm:rounded-3xl sm:p-6"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-ink/60 transition hover:bg-black/5"
        >
          <CloseGlyph className="h-4 w-4" />
        </button>

        <h2 id="occurrence-quick-view-title" className="pr-8 font-display text-xl font-bold tracking-tight text-ink">
          {eventName}
        </h2>

        <div className="mt-4 flex items-start gap-3">
          <CalendarGlyph className="mt-0.5 h-4 w-4 shrink-0 text-findmi-700" />
          <div>
            <p className="text-sm font-semibold text-ink">{formatDateShortInZone(occurrence.start_at, occurrence.timezone)}</p>
            <p className="text-sm text-ink/60">
              {formatTimeInZone(occurrence.start_at, occurrence.timezone)} – {formatTimeInZone(occurrence.end_at, occurrence.timezone)}
            </p>
          </div>
        </div>

        {venueLabel && (
          <div className="mt-3 flex items-start gap-3">
            <PinGlyph className="mt-0.5 h-4 w-4 shrink-0 text-findmi-700" />
            <div className="min-w-0">
              {occurrence.location ? (
                <Link href={`/location/${occurrence.location.slug}`} className="block text-sm font-semibold text-ink hover:text-findmi-700">
                  {venueLabel}
                </Link>
              ) : (
                <p className="text-sm font-semibold text-ink">{venueLabel}</p>
              )}
              {fullAddress && <p className="text-sm text-ink/60">{fullAddress}</p>}
            </div>
          </div>
        )}

        <div className="mt-5 flex gap-2">
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

function PinGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 21s7-6.1 7-11.5A7 7 0 105 9.5C5 14.9 12 21 12 21z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
