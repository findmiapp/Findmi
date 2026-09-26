"use client";

import Link from "next/link";
import SupabaseImage from "./SupabaseImage";
import type { EventWithCategories } from "@/lib/types";
import { cityState, formatDateShort, formatTime, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Discovery Foundation V1 — the Brand -> Place -> Moment connection-card
 * grammar the design package (16-artboard "Recommended System") called
 * for: an event's own real time/place (Moment + Place, same visual
 * language HomeEventCard already established — photo, gradient, badge,
 * title, date, location) with a real approved participating business
 * (Brand) surfaced underneath, never fabricated. `brand` is optional and
 * omitted entirely (no placeholder/fake row) when the anchor event
 * genuinely has no approved participant to show — see page.tsx's anchor
 * selection, which never invents one.
 *
 * Deliberately NOT built on HomeEventCard (protected, commit
 * 1f63a4f — do not touch) even though it reuses that component's exact
 * photo/gradient/badge/glyph treatment for visual consistency: this card
 * adds a second, distinct footer region (the Brand row) that HomeEventCard
 * has no concept of, and is sized as the homepage's one anchor moment
 * (a distinct compositional ROLE — see the design package's Recommended
 * Synthesis) rather than a same-size rail card. */
export default function ConnectionCard({
  event,
  brand,
  analyticsContext,
}: {
  event: EventWithCategories;
  brand?: { name: string; slug: string; logo_url: string | null } | null;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const category = event.categories[0]?.name ?? null;
  const location = [event.venue_name, cityState(event.city, event.state)].filter(Boolean).join(" · ");
  const { live } = getTemporalLabel(event.start_at, event.end_at);

  const analyticsFields = buildEntityEventFields("event", event.id, { eventId: event.id }, analyticsContext);
  const impressionRef = useViewportImpression<HTMLAnchorElement>({ event_name: "entity_impression", ...analyticsFields });

  return (
    <Link
      href={`/event/${event.slug}`}
      ref={impressionRef}
      onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
      className="group block overflow-hidden rounded-3xl bg-black/5 shadow-sm transition active:scale-[0.99]"
    >
      <div className="relative aspect-[4/5] w-full sm:aspect-[2.35/1]">
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
                live ? "bg-findmi text-white" : "bg-black/45 text-white backdrop-blur-sm"
              }`}
            >
              {live && <LiveDot className="animate-happening-now-glow rounded-full text-red-600" />}
              {live ? "Happening Now" : category}
            </span>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-5 sm:p-6">
          <h2 className="line-clamp-2 font-display text-2xl font-bold leading-snug tracking-tight text-white sm:text-3xl">
            {event.name}
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-white/90 sm:text-base">
            <CalendarGlyph className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {formatDateShort(event.start_at)} · {formatTime(event.start_at)}
            </span>
          </p>
          {location && (
            <p className="flex items-start gap-1.5 text-sm text-white/80 sm:text-base">
              <PinGlyph className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="line-clamp-2">{location}</span>
            </p>
          )}
        </div>
      </div>

      {/* Brand footer — the "Brand" leg of the connection grammar. Omitted
          entirely (not a blank/placeholder row) when the anchor has no
          real approved participant, per the task's data rules. */}
      <div className="flex items-center justify-between gap-3 bg-white px-4 py-3.5 sm:px-6">
        {brand ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-black/5">
              {brand.logo_url ? (
                <SupabaseImage src={brand.logo_url} alt="" fill sizes="32px" className="object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[11px] font-bold text-ink/40">
                  {brand.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>
            <span className="truncate text-sm font-semibold text-ink">{brand.name}</span>
          </div>
        ) : (
          <span className="truncate text-sm text-ink/50">
            {formatDateShort(event.start_at)} · {formatTime(event.start_at)}
          </span>
        )}
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-findmi-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-findmi-700">
          View details
          <ChevronGlyph className="h-2.5 w-2.5" />
        </span>
      </div>
    </Link>
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

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
