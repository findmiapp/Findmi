"use client";

import Link from "next/link";
import SupabaseImage from "./SupabaseImage";
import WantHeartButton from "./WantHeartButton";
import type { EventWithCategories } from "@/lib/types";
import { cityState, formatDateShort, formatTime, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Consumer Experience V1 — the Brand -> Place -> Moment connection-card
 * grammar: an event's own real time/place (Moment + Place, same visual
 * language HomeEventCard already established — photo, gradient, badge,
 * title, date, location) with a real approved participating business
 * (Brand) surfaced underneath, never fabricated. `brand`/`place` are
 * optional and omitted entirely (no placeholder/fake row) when the anchor
 * genuinely has no approved participant or no resolvable Location — see
 * page.tsx's selection, which never invents either.
 *
 * Presentation reworked this pass to make the relationship itself
 * legible (a small "Showing up at" connective line) and to make every
 * known relationship a real, separate destination — the brand links to
 * its business profile, the place links to its Location profile when one
 * exists — rather than plain text. The image block is its own Link (to
 * the event); the footer's brand/place links are siblings, not nested
 * inside it, so no link ever ends up inside another link. Selection logic
 * (which event/brand this receives) is untouched — see page.tsx.
 *
 * Deliberately NOT built on HomeEventCard (protected, commit
 * 1f63a4f — do not touch) even though it reuses that component's exact
 * photo/gradient/badge/glyph treatment for visual consistency: this card
 * adds a distinct footer region HomeEventCard has no concept of, and is
 * sized as the homepage's one anchor moment (a distinct compositional
 * ROLE) rather than a same-size rail card. */
export default function ConnectionCard({
  event,
  brand,
  place,
  analyticsContext,
}: {
  event: EventWithCategories;
  brand?: { name: string; slug: string; logo_url: string | null } | null;
  /** A real, resolvable Findmi Location for this specific occurrence
   * (Recurring Events V2's occurrence->location link) — omitted, never
   * fabricated, when the occurrence has no first-class Location on file
   * (legacy text-only venue fields still render as plain text below). */
  place?: { name: string; slug: string } | null;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const category = event.categories[0]?.name ?? null;
  const cityStateLabel = cityState(event.city, event.state);
  const locationLabel = [event.venue_name, cityStateLabel].filter(Boolean).join(" · ");
  const { live } = getTemporalLabel(event.start_at, event.end_at);

  const analyticsFields = buildEntityEventFields("event", event.id, { eventId: event.id }, analyticsContext);
  const impressionRef = useViewportImpression<HTMLDivElement>({ event_name: "entity_impression", ...analyticsFields });

  return (
    <div ref={impressionRef} className="overflow-hidden rounded-3xl bg-black/5 shadow-sm">
      <Link
        href={`/event/${event.slug}`}
        onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
        className="group relative block aspect-[4/5] w-full sm:aspect-[2.35/1]"
      >
        {event.cover_image_url ? (
          <SupabaseImage
            src={event.cover_image_url}
            alt={event.name}
            fill
            sizes="(min-width: 640px) 1100px, 100vw"
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          // Same category-based no-image fallback HomeEventCard already
          // established — reused, not reinvented, so a sparse/logo-only
          // event still reads as an intentional branded card here too.
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-gradient-to-br from-findmi-700 to-ink">
            <CalendarGlyph className="h-24 w-24 text-white/15" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

        {(live || category) && (
          <div className="absolute left-4 top-4">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide ${
                live
                  ? "border border-[rgba(255,255,255,0.12)] bg-[rgba(10,10,10,0.78)] text-white backdrop-blur-md"
                  : "bg-black/45 text-white backdrop-blur-sm"
              }`}
            >
              {live && <LiveDot className="animate-happening-now-glow rounded-full text-red-600" />}
              {live ? "Happening Now" : category}
            </span>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-5 sm:p-6">
          {brand && (
            <p className="text-xs font-bold uppercase tracking-wide text-white/70 sm:text-sm">
              {brand.name} · Showing up at
            </p>
          )}
          <h2 className="line-clamp-2 font-display text-2xl font-bold leading-snug tracking-tight text-white sm:text-3xl">
            {event.name}
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-white/90 sm:text-base">
            <CalendarGlyph className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {formatDateShort(event.start_at)} · {formatTime(event.start_at)}
            </span>
          </p>
          {locationLabel && (
            <p className="flex items-start gap-1.5 text-sm text-white/80 sm:text-base">
              <PinGlyph className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="line-clamp-2">{locationLabel}</span>
            </p>
          )}
        </div>
      </Link>

      {/* Footer — the rest of the connection grammar as real, separate
          destinations (never nested inside the image Link above): the
          Brand to its business profile, the Place to its Location profile
          when one exists, plus the "Want to do" save action. Omitted
          entirely (not a blank/placeholder row) when the anchor has no
          real approved participant or resolvable Location. */}
      <div className="flex items-center justify-between gap-3 bg-white px-4 py-3.5 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {brand ? (
            <Link href={`/business/${brand.slug}`} className="flex min-w-0 items-center gap-2.5 group/brand">
              <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-black/5">
                {brand.logo_url ? (
                  <SupabaseImage src={brand.logo_url} alt="" fill sizes="32px" className="object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[11px] font-bold text-ink/40">
                    {brand.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="truncate text-sm font-semibold text-ink group-hover/brand:underline">{brand.name}</span>
            </Link>
          ) : (
            <span className="truncate text-sm text-ink/50">
              {formatDateShort(event.start_at)} · {formatTime(event.start_at)}
            </span>
          )}
          {place && (
            <>
              <span className="text-ink/25">·</span>
              <Link href={`/location/${place.slug}`} className="truncate text-sm text-ink/55 hover:text-ink hover:underline">
                {place.name}
              </Link>
            </>
          )}
        </div>
        <WantHeartButton type="event" slug={event.slug} id={event.id} className="h-9 w-9 shrink-0 !bg-findmi-50 !text-findmi-700" />
      </div>
    </div>
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
        d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
