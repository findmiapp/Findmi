"use client";

import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import LiveDot from "@/components/LiveDot";
import type { EventWithCategories } from "@/lib/types";
import { cityState, formatTime, getTemporalLabel } from "@/lib/format";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Events Discovery V4 — a dedicated DENSE result presentation for /events'
 * own results grid, deliberately separate from HomeEventCard (which stays
 * unchanged, since it's also the Homepage's discovery card — see that
 * file's own doc comment about the "one dominant card, next peeking"
 * horizontal scroller it's tuned for). That full-bleed aspect-[4/5]
 * poster-with-overlay treatment is right for a single showcased card; it's
 * not the shape a scanning /events visitor needs when comparing many
 * upcoming Events in a grid. Same split BusinessDiscoveryCard already
 * drew against BusinessLogoCard for /businesses.
 *
 * Image-led but shorter (aspect-[4/3] rather than 4/5) with a flat white
 * content block below instead of overlaid gradient text, so a title never
 * fights the photo for legibility and the flyer keeps a consistent,
 * predictable crop regardless of its native upload ratio. Date line uses
 * getTemporalLabel's real TODAY/TOMORROW/weekday bucketing (not a raw
 * calendar date) — the concrete gap HomeEventCard's own date line doesn't
 * cover. Location line reuses the exact same venue_name/city/state fields
 * HomeEventCard already reads — these already carry the real Findmi
 * Location's name when an occurrence has one linked (applyOccurrenceOverride
 * in lib/data.ts), so no new query is needed to prefer real Location
 * naming over legacy manual venue text.
 *
 * No participating-Business count/list — FindmiEvent carries no such
 * field and getEventsDiscovery does no such join, so that signal simply
 * isn't available without a new query and is left off rather than
 * fabricated. No Tickets/RSVP badge either — the Event detail page is
 * where that full action hierarchy belongs; a discovery card's job is
 * still just "what/when/where," same as HomeEventCard's existing scope. */
export default function EventDiscoveryCard({
  event,
  analyticsContext,
}: {
  event: EventWithCategories;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const category = event.categories[0]?.name ?? null;
  const location = [event.venue_name, cityState(event.city, event.state)].filter(Boolean).join(" · ");
  const { label, live } = getTemporalLabel(event.start_at, event.end_at);
  const dateLine = live ? label : `${label} · ${formatTime(event.start_at)}`;

  const analyticsFields = buildEntityEventFields("event", event.id, { eventId: event.id }, analyticsContext);
  const impressionRef = useViewportImpression<HTMLAnchorElement>({ event_name: "entity_impression", ...analyticsFields });

  return (
    <Link
      ref={impressionRef}
      href={`/event/${event.slug}`}
      onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
      className="flex flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition active:scale-[0.98] hover:border-black/10 hover:shadow"
    >
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-black/5">
        {event.cover_image_url ? (
          <SupabaseImage
            src={event.cover_image_url}
            alt={event.name}
            fill
            sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 46vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-findmi-700 to-ink">
            <CalendarGlyph className="h-10 w-10 text-white/20" />
          </div>
        )}
        {(live || category) && (
          <div className="absolute left-2 top-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                live ? "bg-findmi text-white" : "bg-black/45 text-white backdrop-blur-sm"
              }`}
            >
              {live && <LiveDot className="animate-happening-now-glow rounded-full text-red-600" />}
              {live ? "Happening Now" : category}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <p className="truncate text-[11px] font-bold uppercase tracking-wide text-findmi-700">{dateLine}</p>
        <h3 className="line-clamp-2 font-display text-sm font-bold leading-snug text-ink">{event.name}</h3>
        {location && (
          <p className="mt-auto flex items-center gap-1 text-xs text-ink/55">
            <PinGlyph className="h-3 w-3 shrink-0" />
            <span className="truncate">{location}</span>
          </p>
        )}
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
