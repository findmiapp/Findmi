"use client";

import Image from "next/image";
import Link from "next/link";
import type { EventWithCategories } from "@/lib/types";
import { cityState, formatDateShort, formatTime, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields } from "@/lib/analytics/context";

// Consumer Discovery Homepage V2 — the one "editorial feature" moment
// (task Section 7.C / 10): a single real discovery object given
// meaningfully more visual weight than the standard card rails around it.
//
// SELECTION RULE (documented per the task's own instruction): this shows
// the single soonest real upcoming event — literally nextEvents[0], the
// first item of the exact same chronological getUpcomingEvents("anytime")
// query that already powers the "Next Up"/"All" tabs in
// HomeEventDiscovery immediately above it on the page. Zero new query,
// zero randomization, zero fabricated "featured" flag — deterministic by
// construction (whatever is soonest wins), and identical to what a
// visitor would find themselves if they opened that same tab. If there is
// no upcoming event at all, the caller renders nothing here — never a
// fabricated placeholder.
//
// Visual language is deliberately borrowed from HomeEventCard (same
// photo-dominant/dark-gradient-overlay treatment, same real
// getTemporalLabel() live/date logic — never a separate "Happening Now"
// check, so the midnight-label fix that logic already has is inherited
// for free) rather than invented from scratch, just scaled up into a
// landscape, editorial composition instead of a small vertical card.
export default function HomeEditorialFeature({ event }: { event: EventWithCategories }) {
  const category = event.categories[0]?.name ?? null;
  const location = [event.venue_name, cityState(event.city, event.state)].filter(Boolean).join(" · ");
  const { live } = getTemporalLabel(event.start_at, event.end_at);

  const analyticsFields = buildEntityEventFields(
    "event",
    event.id,
    { eventId: event.id },
    { pageType: "home", placement: "homepage_editorial_feature" }
  );
  const impressionRef = useViewportImpression<HTMLAnchorElement>({ event_name: "entity_impression", ...analyticsFields });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink/35">Coming Up</p>
      <Link
        href={`/event/${event.slug}`}
        ref={impressionRef}
        onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
        className="group relative block aspect-[16/10] w-full overflow-hidden rounded-3xl bg-black/5 shadow-sm transition active:scale-[0.99] sm:aspect-[21/9]"
      >
        {event.cover_image_url ? (
          <Image
            src={event.cover_image_url}
            alt={event.name}
            fill
            unoptimized
            sizes="(min-width: 1024px) 1152px, 100vw"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-gradient-to-br from-findmi-700 to-ink">
            <CalendarGlyph className="h-24 w-24 text-white/15" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

        {(live || category) && (
          <div className="absolute left-4 top-4 sm:left-6 sm:top-6">
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

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-6">
          <div className="min-w-0">
            <h2 className="line-clamp-2 font-display text-2xl font-bold leading-tight text-white sm:text-3xl md:text-4xl">
              {event.name}
            </h2>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85">
              <span className="flex items-center gap-1.5">
                <CalendarGlyph className="h-4 w-4 shrink-0" />
                {formatDateShort(event.start_at)} · {formatTime(event.start_at)}
              </span>
              {location && (
                <span className="flex items-center gap-1.5">
                  <PinGlyph className="h-4 w-4 shrink-0" />
                  <span className="truncate">{location}</span>
                </span>
              )}
            </p>
          </div>
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-white/95 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink transition group-hover:bg-white sm:inline-flex">
            See What&rsquo;s Happening
            <ChevronGlyph className="h-3.5 w-3.5" />
          </span>
        </div>
      </Link>
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

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
