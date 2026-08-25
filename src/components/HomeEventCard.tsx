import Image from "next/image";
import Link from "next/link";
import type { EventWithCategories } from "@/lib/types";
import { cityState, formatDateShort, formatTime, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";

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
export default function HomeEventCard({ event }: { event: EventWithCategories }) {
  const category = event.categories[0]?.name ?? null;
  const location = [event.venue_name, cityState(event.city, event.state)].filter(Boolean).join(" · ");
  const { live } = getTemporalLabel(event.start_at, event.end_at);

  return (
    <Link
      href={`/event/${event.slug}`}
      className="group relative block aspect-[4/5] w-full overflow-hidden rounded-2xl bg-black/5 transition active:scale-[0.98]"
    >
      {event.cover_image_url ? (
        <Image
          src={event.cover_image_url}
          alt={event.name}
          fill
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
          gradient reached the text block against a bright photo). */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

      {(live || category) && (
        <div className="absolute left-3 top-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide ${
              live ? "bg-findmi text-white" : "bg-black/45 text-white backdrop-blur-sm"
            }`}
          >
            {live && <LiveDot className="text-white" />}
            {live ? "Here Now" : category}
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-4">
        <h3 className="line-clamp-2 font-display text-lg font-bold leading-snug text-white sm:text-xl">
          {event.name}
        </h3>
        <p className="flex items-center gap-1.5 text-sm text-white/90">
          <CalendarGlyph className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {formatDateShort(event.start_at)} · {formatTime(event.start_at)}
          </span>
        </p>
        {location && (
          <p className="flex items-center gap-1.5 text-sm text-white/80">
            <PinGlyph className="h-4 w-4 shrink-0" />
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
