"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import SupabaseImage from "./SupabaseImage";
import AddToCalendarButton from "./AddToCalendarButton";
import ShareButton from "./ShareButton";
import { cityState, formatAppearanceTime, formatDateShort } from "@/lib/format";
import { validateCustomDestination } from "@/lib/navigation";
import { trackEvent } from "@/lib/analytics/track";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Appearance Quick View — Pass 1: the reusable consumer detail surface for
 * an Appearance, opened from a card instead of defaulting straight to GPS/
 * directions or a specific relationship (Event/Business). Metadata-driven,
 * no hero image (the card itself is the visual moment — see
 * AppearanceCarousel.tsx). Modeled on the existing overlay conventions
 * already in the codebase (ImageLightbox's Escape/body-scroll-lock,
 * FilterSheet's bottom-sheet-on-mobile/centered-on-desktop shell) rather
 * than a new dialog primitive or a third-party dependency — neither exists
 * in this codebase yet (see this pass's own audit).
 *
 * Deliberately dumb/presentational: every field it renders is passed in by
 * the caller, already resolved from a real query — this component never
 * fetches anything itself, so any future surface (homepage, discovery,
 * location/event pages, an appearance archive) can reuse it by supplying
 * the same shape, exactly as the task's own reusability goal asks for. */

export interface AppearanceQuickViewAppearance {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  external_url: string | null;
  event_id: string | null;
  location_id: string | null;
  location?: { name: string; slug: string } | null;
  event?: { slug: string; name?: string } | null;
}

export interface AppearanceQuickViewBusiness {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  /** Absolute, shareable URL for this business's own public profile.
   * Appearance has no canonical public detail URL of its own yet (see this
   * pass's audit note on Share) — the Quick View shares the parent
   * Business page instead of inventing /appearance/[id] this pass. */
  shareUrl: string;
}

export default function AppearanceQuickView({
  appearance,
  business,
  onClose,
  analyticsContext,
}: {
  appearance: AppearanceQuickViewAppearance;
  business: AppearanceQuickViewBusiness;
  onClose: () => void;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Accessibility — same Escape/body-scroll-lock convention as
  // ImageLightbox, plus focus moved to the close control on open and
  // restored to whatever triggered the Quick View (the card) on close, so
  // keyboard users never lose their place in the page.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
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
      restoreFocusRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const analyticsFields = buildEntityEventFields(
    "appearance",
    appearance.id,
    {
      appearanceId: appearance.id,
      businessId: business.id,
      eventId: appearance.event_id,
      locationId: appearance.location_id,
    },
    analyticsContext
  );

  function trackAction(action: string) {
    trackEvent({ event_name: "entity_click", ...analyticsFields, metadata: { action } });
  }

  const venueLabel = appearance.location?.name ?? appearance.venue_name;
  const location = cityState(appearance.city, appearance.state);
  // Same Directions URL construction AppearanceCard already uses — no
  // dedicated helper function exists in the codebase (see this pass's
  // audit), so this follows that exact established inline convention
  // rather than inventing a new one.
  const mapsQuery = [appearance.venue_name, appearance.address, location].filter(Boolean).join(", ");
  const directionsHref = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}` : null;

  const externalUrl = appearance.external_url && validateCustomDestination(appearance.external_url).ok ? appearance.external_url : null;
  const externalIsAbsolute = externalUrl ? /^https:\/\//i.test(externalUrl) : false;

  const hasEvent = Boolean(appearance.event?.slug);

  const viewBusinessButton = (
    <Link
      href={`/business/${business.slug}`}
      className={
        hasEvent
          ? "flex h-10 w-full items-center justify-center rounded-2xl border border-black/10 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30"
          : "flex h-11 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      }
      onClick={() => trackAction("view_business")}
    >
      View {business.name}
    </Link>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="appearance-quick-view-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:max-h-[85vh] sm:max-w-md sm:rounded-3xl sm:p-6"
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

        <div className="flex items-center gap-2 pr-10">
          {business.logo_url && (
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-black/10 bg-white">
              <SupabaseImage src={business.logo_url} alt="" fill sizes="36px" className="object-cover" />
            </div>
          )}
          <Link
            href={`/business/${business.slug}`}
            className="truncate text-sm font-semibold text-ink/70 transition hover:text-ink"
            onClick={() => trackAction("view_business")}
          >
            {business.name}
          </Link>
        </div>
        <h2 id="appearance-quick-view-title" className="mt-2 pr-6 font-display text-xl font-bold tracking-tight text-ink">
          {appearance.title}
        </h2>

        <div className="mt-4 flex items-start gap-3">
          <CalendarGlyph className="mt-0.5 h-4 w-4 shrink-0 text-findmi-700" />
          <div>
            <p className="text-sm font-semibold text-ink">{formatDateShort(appearance.start_at)}</p>
            <p className="text-sm text-ink/60">
              {formatAppearanceTime(appearance.start_at, appearance.end_at, appearance.description)}
            </p>
          </div>
        </div>

        {(venueLabel || appearance.address || location) && (
          <div className="mt-3 flex items-start gap-3">
            <PinGlyph className="mt-0.5 h-4 w-4 shrink-0 text-findmi-700" />
            <div className="min-w-0">
              {venueLabel &&
                (appearance.location ? (
                  <Link
                    href={`/location/${appearance.location.slug}`}
                    className="block text-sm font-semibold text-ink hover:text-findmi-700"
                  >
                    {venueLabel}
                  </Link>
                ) : (
                  <p className="text-sm font-semibold text-ink">{venueLabel}</p>
                ))}
              {appearance.address && <p className="text-sm text-ink/60">{appearance.address}</p>}
              {location && <p className="text-sm text-ink/60">{location}</p>}
            </div>
          </div>
        )}

        {hasEvent && (
          <div className="mt-4 rounded-2xl bg-findmi-50 px-3.5 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-findmi-700">Part of</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">{appearance.event!.name ?? "This Event"}</p>
            <Link
              href={`/event/${appearance.event!.slug}`}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-findmi-700"
              onClick={() => trackAction("view_event")}
            >
              View Event
              <ArrowGlyph className="h-3 w-3" />
            </Link>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {hasEvent && (
            <Link
              href={`/event/${appearance.event!.slug}`}
              className="flex h-11 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              onClick={() => trackAction("view_event")}
            >
              View Event
            </Link>
          )}
          {viewBusinessButton}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {directionsHref && (
            <a
              href={directionsHref}
              target="_blank"
              rel="noreferrer"
              className="flex h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-black/10 px-3 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30"
              onClick={() => trackEvent({ event_name: "click_directions", ...analyticsFields })}
            >
              Directions
            </a>
          )}
          {/* AddToCalendarButton has no click callback of its own — this
              wraps it rather than modifying a shared component used
              elsewhere; onClickCapture fires once a viewer actually picks
              Google Calendar or the .ics download inside it, before that
              link/download proceeds. */}
          <div onClickCapture={() => trackAction("add_to_calendar")}>
            <AddToCalendarButton
              title={appearance.title}
              description={appearance.description}
              location={[venueLabel, location].filter(Boolean).join(", ") || null}
              startAt={appearance.start_at}
              endAt={appearance.end_at}
            />
          </div>
          <ShareButton
            url={business.shareUrl}
            title={`${appearance.title} · ${business.name}`}
            track={{ subject_type: "appearance", subject_id: appearance.id, appearance_id: appearance.id, business_id: business.id }}
          />
        </div>

        {externalUrl &&
          (externalIsAbsolute ? (
            <a
              href={externalUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 flex h-10 w-full items-center justify-center rounded-xl border border-black/10 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30"
              onClick={() => trackAction("visit_link")}
            >
              Visit Link
            </a>
          ) : (
            <Link
              href={externalUrl}
              className="mt-2 flex h-10 w-full items-center justify-center rounded-xl border border-black/10 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30"
              onClick={() => trackAction("visit_link")}
            >
              Visit Link
            </Link>
          ))}
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

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
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
