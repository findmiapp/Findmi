"use client";

import Image from "next/image";
import Link from "next/link";
import type { EventWithCategories, FindmiEvent } from "@/lib/types";
import { cityState, formatDateShort, formatTime, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";
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
 * Event Preview Card Visual Direction pass. This mirrors the same
 * priority EventPublicView's own Tier A CTAs use, but skips the Form
 * Manager/occurrence-override resolution that requires its own async
 * lookup (not worth an extra query per card in a homepage carousel): the
 * event's own direct URL fields are already real, founder-configured
 * data, just like every other field this card reads. Returns null (no
 * fabricated CTA) when none of the three toggles has both its flag AND a
 * destination — including a vendor-application deadline that's passed. */
function resolvePrimaryCta(event: FindmiEvent): string | null {
  if (event.tickets_enabled && event.tickets_url) return "Get Tickets";
  if (event.rsvp_enabled && event.rsvp_url) return "RSVP";
  const deadlinePassed = event.vendor_application_deadline ? new Date(event.vendor_application_deadline) < new Date() : false;
  if (event.vendor_applications_enabled && event.vendor_application_url && !deadlinePassed) return "Apply to Vend";
  return null;
}

export default function HomeEventCard({
  event,
  analyticsContext,
}: {
  event: EventWithCategories;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const category = event.categories[0]?.name ?? null;
  const location = [event.venue_name, cityState(event.city, event.state)].filter(Boolean).join(" · ");
  const { live } = getTemporalLabel(event.start_at, event.end_at);
  // Event Preview Card Visual Direction pass — a real signal (the same
  // direct-URL fields the event page itself reads), never a fabricated
  // one. Rendered as a plain span inside this same Link (same pattern
  // HappeningFeatureCard's own CTA badge already uses), not a second,
  // separately-tappable link/button — nesting a real <a>/<button> inside
  // this card's own outer Link would be invalid, doubly-clickable HTML.
  // Tapping anywhere on the card, including this pill, opens the event
  // page, where the real action (with full Form Manager/occurrence-
  // override resolution) actually lives — click behavior is otherwise
  // completely unchanged from before this pass.
  const primaryCta = resolvePrimaryCta(event);

  const analyticsFields = buildEntityEventFields("event", event.id, { eventId: event.id }, analyticsContext);
  const impressionRef = useViewportImpression<HTMLAnchorElement>({ event_name: "entity_impression", ...analyticsFields });

  return (
    <Link
      href={`/event/${event.slug}`}
      ref={impressionRef}
      onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
      className="group relative block aspect-[4/5] w-full overflow-hidden rounded-3xl bg-black/5 transition active:scale-[0.98]"
    >
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
          className="object-cover transition duration-300 group-hover:scale-105"
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
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-gradient-to-br from-findmi-700 to-ink">
          <CalendarGlyph className="h-20 w-20 text-white/15" />
        </div>
      )}
      {/* Legibility gradient for the white overlay text, bottom-anchored —
          same treatment PostCard uses (darkened in the visual-polish
          pass for the same reason: via/10 was too light by the time the
          gradient reached the text block against a bright photo).
          Event Preview Card Visual Direction pass — deepened further
          (85→92, 35→45) so the now-larger title/CTA block reads as
          intentionally layered onto the photo rather than merely
          legible. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/45 to-transparent" />

      {(live || category) && (
        <div className="absolute left-3 top-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide ${
              live
                ? "border border-[rgba(255,255,255,0.12)] bg-[rgba(10,10,10,0.78)] text-white backdrop-blur-md"
                : "bg-black/45 text-white backdrop-blur-sm"
            }`}
          >
            {/* Happening Now badge hotfix — dark glass pill (near-black
                translucent + faint white border + blur), replacing the
                earlier solid FindMi-aqua fill, which read as a loud
                promotional sticker over photography. The dot still carries
                the red "actively live" signal, pulsing/glowing via the
                shared animate-happening-now-glow treatment. Every other
                live-state surface (event detail hero, Upcoming Dates tile,
                AppearanceCard) already uses its own red-filled treatment,
                untouched by this pass. */}
            {live && <LiveDot className="animate-happening-now-glow rounded-full text-red-600" />}
            {live ? "Happening Now" : category}
          </span>
        </div>
      )}

      {/* Event Preview Card Visual Direction pass — title bumped up a
          weight/size step (lg/xl -> xl/2xl, font-extrabold) and given
          tracking-tight (which, paired with font-display, picks up
          globals.css's own softened -0.006em letter-spacing — never the
          harsher Tailwind default) for "substantially more presence,"
          per the reference direction. No secondary descriptor line: events
          have no short subtitle/tagline field today (only a long-form
          description), so nothing renders there rather than fabricating
          one. Bottom gap widened slightly (1.5->2) to give the now-larger
          title room to breathe from the date/location lines below it. */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4">
        <h3 className="line-clamp-2 font-display text-xl font-extrabold leading-snug tracking-tight text-white sm:text-2xl">
          {event.name}
        </h3>
        <p className="flex items-center gap-1.5 text-sm text-white/90">
          <CalendarGlyph className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {formatDateShort(event.start_at)} · {formatTime(event.start_at)}
          </span>
        </p>
        {location && (
          // Must Dos Event Card Visual Restoration pass — line-clamp-2
          // (was a hard single-line truncate) so "Venue Name · City,
          // State" gets a real second line on a wide card instead of
          // being cut mid-word; only relevant now that the homepage's
          // own wrapper is wide enough for it to matter (see page.tsx).
          <p className="flex items-start gap-1.5 text-sm text-white/80">
            <PinGlyph className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="line-clamp-2">{location}</span>
          </p>
        )}
        {/* Event Preview Card Visual Direction pass, correction — the
            card's own real primary-action signal (see resolvePrimaryCta
            above), now full-width and sized like the site's actual
            primary-button geometry (h-11/rounded-2xl — the same
            convention EventScheduleCtas' own solid CTA uses) so it reads
            as the bottom of one deliberate action composition, not a
            small pill dropped under the metadata. Still just a plain
            span within this same overlay block, not a second link/button
            — see resolvePrimaryCta's own note on why — and still omitted
            entirely (no reserved slot/empty gap) when the event has none,
            so the card looks complete either way. Card height/aspect
            ratio is unchanged; this only reshapes content already inside
            the existing bottom overlay. */}
        {primaryCta && (
          <span className="mt-1.5 flex h-11 w-full items-center justify-center gap-1.5 rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white">
            {primaryCta}
            <ArrowGlyph className="h-3.5 w-3.5 shrink-0" />
          </span>
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

// Event Preview Card Visual Direction pass, correction — small trailing
// affordance on the now full-width primary-action bar, same convention
// as the Directions glyph elsewhere (currentColor, strokeWidth 1.8).
function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
