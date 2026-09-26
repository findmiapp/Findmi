"use client";

import SupabaseImage from "./SupabaseImage";
import Link from "next/link";
import type { EventWithCategories } from "@/lib/types";
import { cityState, formatCardDateRange, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";
import WantHeartButton from "./WantHeartButton";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Compact Event Carousel pass — the premium, short/wide, image-led
 * preview card for a horizontal event rail, sized/proportioned like the
 * site's existing city/location discovery cards (LocationCard's
 * aspect-[16/10] full-bleed photo) rather than the tall aspect-[4/5]
 * "story" card (HomeEventCard/PostCard/EventCard — untouched, still the
 * right shape for a single signature moment or a full grid page).
 *
 * Same shared plumbing every other card here already uses — nothing new
 * invented:
 *  - Save: WantHeartButton, the exact same guest-localStorage/account
 *    hook (useAccountSaved) EventSaveButton/ProductSaveButton already use.
 *  - Analytics: buildEntityEventFields + useViewportImpression + trackEvent,
 *    the same shared attribution plumbing HomeEventCard/BusinessCard/
 *    ProductCard/LocationCard/CompactCard/AppearanceCard use — an
 *    analyticsContext from the caller (see lib/analytics/context.ts)
 *    still identifies which homepage section/placement this rendered in.
 *  - Live/category badge + dark-glass "Happening Now" treatment: the
 *    exact same classes as HomeEventCard/ConnectionCard/EventDiscoveryCard
 *    (protected — never teal).
 *  - Date: formatCardDateRange (lib/format.ts) — a new, dedicated concise
 *    formatter (see its own doc comment for why formatDateRange doesn't
 *    fit a card this short).
 *  - Location: the same `[venue_name, cityState(city,state)].join(" · ")`
 *    every other event card already builds — no new location formatter.
 *
 * NOT implemented (see this pass's report — no real data source exists
 * yet, and none is fabricated here):
 *  - A "Free" badge — FindmiEvent has no price/is-free column today.
 *  - A business/brand logo — would need a new per-event bulk query this
 *    pass doesn't add; the image fallback chain below stops at the
 *    event's own cover photo, same as HomeEventCard.
 */
export default function CompactEventCard({
  event,
  analyticsContext,
}: {
  event: EventWithCategories;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const { live } = getTemporalLabel(event.start_at, event.end_at);
  const category = event.categories[0]?.name ?? null;
  // Up to 3 useful chips (real data — event_categories), never padded out
  // with placeholders when an event has fewer.
  const chips = event.categories.slice(0, 3).map((c) => c.name);
  const location = [event.venue_name, cityState(event.city, event.state)].filter(Boolean).join(" · ");
  const dateLabel = formatCardDateRange(event.start_at, event.end_at);

  const analyticsFields = buildEntityEventFields("event", event.id, { eventId: event.id }, analyticsContext);
  const impressionRef = useViewportImpression<HTMLAnchorElement>({ event_name: "entity_impression", ...analyticsFields });

  return (
    <Link
      href={`/event/${event.slug}`}
      ref={impressionRef}
      onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
      className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black/5 transition active:scale-[0.98]"
    >
      {event.cover_image_url ? (
        <SupabaseImage
          src={event.cover_image_url}
          alt={event.name}
          fill
          sizes="(min-width: 768px) 320px, 80vw"
          className="object-cover transition duration-300 group-hover:scale-105"
        />
      ) : (
        // Same category-tinted no-image fallback HomeEventCard already
        // established — reused, not reinvented, so a sparse/logo-only
        // event still reads as an intentional branded card here too.
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-gradient-to-br from-findmi-700 to-ink">
          <CalendarGlyph className="h-14 w-14 text-white/15" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

      {(live || category) && (
        <div className="absolute left-3 top-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
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

      <WantHeartButton type="event" slug={event.slug} id={event.id} className="absolute right-3 top-3 h-8 w-8" />

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3">
        {/* Title — strongest typography on the card, controlled 2-line
            clamp so a long real title (a genuine production concern —
            see this pass's report) never produces an awkward
            single-line truncation like "Global Citizen Festival: N...".
            leading-snug + a fixed min-height reserve enough room that a
            2-line title never collides with the metadata below it,
            whether the title is 1 line or 2. */}
        <h3 className="line-clamp-2 min-h-[2.5em] font-display text-[15px] font-bold leading-snug text-white">
          {event.name}
        </h3>
        <p className="flex items-center gap-1.5 text-xs text-white/90">
          <CalendarGlyph className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{dateLabel}</span>
        </p>
        {location && (
          <p className="flex items-center gap-1.5 text-xs text-white/80">
            <PinGlyph className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{location}</span>
          </p>
        )}
        {chips.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {chips.map((name) => (
              <span
                key={name}
                className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm"
              >
                {name}
              </span>
            ))}
          </div>
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
