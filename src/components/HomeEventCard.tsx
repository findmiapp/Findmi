"use client";

import Image from "@/components/SupabaseImage";
import Link from "next/link";
import type { EventWithCategories, FindmiEvent } from "@/lib/types";
import { cityState, formatDateShort, formatTime, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";
import WantHeartButton from "./WantHeartButton";
import AddToCalendarButton from "./AddToCalendarButton";
import EventShareButton from "./EventShareButton";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

// Homepage discovery event card (2026 feed-builder pass, Part 2) —
// deliberately NOT built on EventCard/PostCard (both kept untouched/safe
// per that pass's constraints), even though it borrows the same
// photo-dominant, dark-gradient-overlay visual language those already
// use. Two real differences justify a dedicated component rather than
// reusing PostCard directly: (1) the badge here shows the event's real
// CATEGORY when one exists, not PostCard's fixed temporal-label badge —
// see the report on event_categories currently having zero rows, so this
// often renders with no badge at all, which is the honest state, not a
// bug; (2) sizing is tuned for the homepage's "one dominant card, next
// peeking" horizontal scroller (~70-78vw on mobile), not PostCard's fixed
// per-kind aspect ratios. No attendee/RSVP/popularity data is shown —
// FindmiEvent has no such column (see CompactEventCard's same note) —
// and no price, since events carry no price field in the schema today.

/** Real Tickets > RSVP > Apply to Vend precedence, direct-URL tier only —
 * mirrors EventPublicView's own Tier A CTA priority, skipping the Form
 * Manager/occurrence-override resolution that requires its own async
 * lookup (not worth an extra query per card in a homepage carousel). The
 * event's own direct URL fields are already real, founder-configured
 * data, just like every other field this card reads. Returns null (no
 * fabricated CTA) when none of the three toggles has both its flag AND a
 * destination — including a vendor-application deadline that's passed. */
function resolvePrimaryCta(
  event: FindmiEvent
): { label: string; url: string; eventName: "click_tickets" | "click_rsvp" | "click_apply_to_vend" } | null {
  if (event.tickets_enabled && event.tickets_url) return { label: "Get Tickets", url: event.tickets_url, eventName: "click_tickets" };
  if (event.rsvp_enabled && event.rsvp_url) return { label: "RSVP", url: event.rsvp_url, eventName: "click_rsvp" };
  const deadlinePassed = event.vendor_application_deadline ? new Date(event.vendor_application_deadline) < new Date() : false;
  if (event.vendor_applications_enabled && event.vendor_application_url && !deadlinePassed) {
    return { label: "Apply to Vend", url: event.vendor_application_url, eventName: "click_apply_to_vend" };
  }
  return null;
}

/** Same Directions formula EventScheduleCtas/EventPublicView's legacy
 * path already use, duplicated here rather than imported — same
 * precedent EventScheduleCtas itself already follows (see its own note)
 * for a component that needs to make its own self-contained decision. */
function resolveDirectionsHref(event: FindmiEvent): string | null {
  if (!event.directions_enabled) return null;
  const mapQuery = [event.venue_name, event.address, cityState(event.city, event.state)].filter(Boolean).join(", ");
  return mapQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}` : null;
}

/** Home Event Card Reconstruction pass — the shared glass treatment every
 * action in the bottom dock (CTA/Directions) uses: translucent black,
 * backdrop blur, a faint white border. Never a solid teal fill — that
 * treatment was specifically rejected for covering photography/poster
 * artwork. Teal is reserved for the tiny active-state glow a filled
 * icon/heart already uses elsewhere (WantHeartButton), not for these. */
const GLASS_BUTTON = "border border-white/20 bg-black/40 text-white backdrop-blur-md transition active:scale-95";

export default function HomeEventCard({
  event,
  analyticsContext,
}: {
  event: EventWithCategories;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const category = event.categories[0]?.name ?? null;
  const { live } = getTemporalLabel(event.start_at, event.end_at);
  const cta = resolvePrimaryCta(event);
  const directionsHref = resolveDirectionsHref(event);
  const venueLine = event.venue_name || null;
  const cityStateLine = cityState(event.city, event.state);
  const calendarLocation = [venueLine, cityStateLine].filter(Boolean).join(" · ") || null;

  const analyticsFields = buildEntityEventFields("event", event.id, { eventId: event.id }, analyticsContext);
  const impressionRef = useViewportImpression<HTMLAnchorElement>({ event_name: "entity_impression", ...analyticsFields });

  // Home Event Card Reconstruction pass — the card is no longer a single
  // <Link> wrapping everything: Calendar's own dropdown renders a real
  // <a> (Google Calendar) inside its trigger's subtree, and Save/CTA/
  // Directions are now real functioning controls rather than decorative
  // spans. Nesting any of those inside another real <a> (this card's own
  // "open the event" link) would be invalid, doubly-clickable HTML — the
  // exact thing explicitly ruled out for this pass. Instead the full-card
  // link is an absolutely-positioned SIBLING, first in paint order; every
  // purely decorative layer above it (image/gradient/badges/text) is
  // pointer-events-none so a tap anywhere non-interactive still falls
  // through to it exactly like the old single-Link card did; the real
  // action controls are later siblings with normal pointer-events, so
  // they capture their own taps without ever being inside the link's DOM
  // subtree — no stopPropagation gymnastics needed anywhere.
  return (
    <div className="group relative block aspect-[4/5] w-full overflow-hidden rounded-3xl bg-black/5 transition active:scale-[0.98]">
      <Link
        href={`/event/${event.slug}`}
        ref={impressionRef}
        onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
        aria-label={event.name}
        className="absolute inset-0 z-0"
      />

      {event.cover_image_url ? (
        // unoptimized — bypasses Vercel's next/image optimizer (the
        // /_next/image proxy) for this Supabase Storage-hosted cover,
        // fetching the original file directly instead. Root-caused
        // against production data: this exact URL resolves to a real,
        // correctly-uploaded object in the findmi-media bucket (verified
        // via Storage — right size/mimetype, a recorded 200 at upload
        // time), so the file itself isn't the problem; the optimizer
        // request for it was failing while the plain origin file is
        // fine. No onError/fallback state needed here — bypassing the
        // optimizer is the fix, not papering over a still-failing load.
        <Image
          src={event.cover_image_url}
          alt={event.name}
          fill
          unoptimized
          sizes="(min-width: 768px) 360px, 76vw"
          className="pointer-events-none object-cover transition duration-300 group-hover:scale-105"
        />
      ) : (
        // No fabricated event photo (live QA correction, 2026 nav pass,
        // Part B5) — a real, currently-common case (most production
        // events have no cover_image_url yet), so this needs to read as
        // an intentional branded card, not a broken/black placeholder.
        // Same watermark-icon treatment PostCard uses for its own no-
        // image case, on a findmi-tinted diagonal instead of PostCard's
        // neutral stone→ink one, so it still feels like FindMi rather
        // than a generic dark box.
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden bg-gradient-to-br from-findmi-700 to-ink">
          <CalendarGlyph className="h-20 w-20 text-white/15" />
        </div>
      )}

      {/* Home Event Card Reconstruction pass — concentrated toward the
          bottom (a tight multi-stop scrim, not a long even fade) so a
          poster-style cover (embedded titles/dates of its own, e.g. Perk
          Up Fest) keeps its own upper artwork visible instead of the
          whole image darkening evenly. Legibility for our own text still
          comes from a near-solid zone right behind it, just a shorter
          one than before. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.72) 26%, rgba(0,0,0,0.22) 52%, rgba(0,0,0,0) 72%)",
        }}
      />

      {(live || category) && (
        <div className="pointer-events-none absolute left-3 top-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide ${
              live
                ? "border border-[rgba(255,255,255,0.12)] bg-[rgba(10,10,10,0.78)] text-white backdrop-blur-md"
                : "bg-black/45 text-white backdrop-blur-sm"
            }`}
          >
            {/* Happening Now badge — UNCHANGED. Dark glass pill (near-
                black translucent + faint white border + blur). The dot
                still carries the red "actively live" signal, pulsing/
                glowing via the shared animate-happening-now-glow
                treatment. Every other live-state surface (event detail
                hero, Upcoming Dates tile, AppearanceCard) already uses
                its own red-filled treatment, untouched by this pass. */}
            {live && <LiveDot className="animate-happening-now-glow rounded-full text-red-600" />}
            {live ? "Happening Now" : category}
          </span>
        </div>
      )}

      {/* Home Event Card Reconstruction pass — Save, top-right, reusing
          the SAME shared glass/circular affordance ProductCard's own
          photo tiles already use (WantHeartButton — real useAccountSaved
          toggle, already stops its own propagation). No new save
          mechanism invented. */}
      <div className="absolute right-3 top-3 z-10">
        <WantHeartButton type="event" slug={event.slug} id={event.id} className="h-9 w-9" />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-4">
        <h3 className="line-clamp-2 font-display text-xl font-extrabold leading-snug tracking-tight text-white sm:text-2xl">
          {event.name}
        </h3>
        <p className="flex items-center gap-1.5 text-sm text-white/90">
          <CalendarGlyph className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {formatDateShort(event.start_at)} · {formatTime(event.start_at)}
            {event.end_at ? ` – ${formatTime(event.end_at)}` : ""}
          </span>
        </p>
        {(venueLine || cityStateLine) && (
          // Full location, real data, two lines (venue then city/state)
          // rather than one middot-joined line — each truncates on its
          // own instead of wrapping, so this can't push the fixed-height
          // card's bottom content taller than before. Micro polish pass —
          // venue semibold, city/state regular weight, so the two lines
          // read as a clear hierarchy rather than equal weight.
          <p className="flex items-start gap-1.5 text-sm text-white/80">
            <PinGlyph className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">
              {venueLine && <span className="block truncate font-semibold">{venueLine}</span>}
              {cityStateLine && <span className="block truncate font-normal text-white/60">{cityStateLine}</span>}
            </span>
          </p>
        )}

        {/* Home Event Card Reconstruction pass — the bottom action dock.
            Calendar/Share are always real (no data gate); CTA/Directions
            render only when the event actually has one, so the row's
            width just redistributes rather than leaving an empty cell —
            it can never be fully empty since Calendar/Share are always
            present. Every control is now a REAL action, not a decorative
            span: CTA/Directions are plain buttons (never a second <a>
            nested in the card's own link — see the top-level note on
            why) that open the real destination in a new tab; Calendar/
            Share reuse the existing components as-is via their new
            "glass" layout variant. pointer-events are re-enabled here
            (the parent block above is pointer-events-none) since these
            are the one real interactive region in this text block. */}
        <div className="pointer-events-auto mt-1 flex items-center gap-1.5">
          {cta && (
            <button
              type="button"
              onClick={() => {
                trackEvent({ event_name: cta.eventName, subject_type: "event", subject_id: event.id, event_id: event.id });
                window.open(cta.url, "_blank", "noopener,noreferrer");
              }}
              className={`flex h-10 flex-1 items-center justify-between gap-2 whitespace-nowrap rounded-2xl pl-3 pr-1.5 text-[11px] font-bold uppercase ${GLASS_BUTTON}`}
            >
              <span className="truncate">{cta.label}</span>
              {/* Micro polish pass — a rounded-square glass inset holding
                  the chevron, visually distinct from the outer pill but
                  NOT a second click target: this whole button is still
                  one action (the inset has no handler of its own). */}
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/25 bg-white/15">
                <ChevronRightGlyph className="h-3 w-3" />
              </span>
            </button>
          )}
          {directionsHref && (
            <button
              type="button"
              aria-label="Directions"
              onClick={() => {
                trackEvent({ event_name: "click_directions", subject_type: "event", subject_id: event.id, event_id: event.id });
                window.open(directionsHref, "_blank", "noopener,noreferrer");
              }}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${GLASS_BUTTON}`}
            >
              <DirectionsGlyph className="h-4 w-4" />
            </button>
          )}
          <AddToCalendarButton
            title={event.name}
            description={event.description}
            location={calendarLocation}
            startAt={event.start_at}
            endAt={event.end_at}
            layout="glass"
          />
          <EventShareButton
            title={event.name}
            url={typeof window !== "undefined" ? `${window.location.origin}/event/${event.slug}` : `/event/${event.slug}`}
            track={{ subject_type: "event", subject_id: event.id, event_id: event.id }}
            layout="glass"
          />
        </div>
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

// Right-facing chevron inside the primary CTA's glass inset — a plain
// ">" shape, never the diagonal external-link arrow used elsewhere.
function ChevronRightGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Same glyph EventScheduleCtas' own Directions link uses (currentColor,
// strokeWidth 1.8).
function DirectionsGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 2L4.5 20.5l.9.9L12 18l6.6 3.4.9-.9L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
