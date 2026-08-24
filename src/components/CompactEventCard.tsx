import Image from "next/image";
import Link from "next/link";
import type { EventWithCategories } from "@/lib/types";
import { cityState, formatDateShort, formatTime, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";

// A dense, carousel-forward alternative to EventCard/PostCard's tall
// photo-overlay "story" card — that one is right for a signature moment or
// a full grid page, but at ~2.2 cards visible on a phone it's too tall.
// Everything here lives in normal document flow (image on top, compact
// text block below) at a fixed width the homepage carousel controls, the
// same "compact card, not a giant one" pattern CompactCard/ProductCard
// already use for dense homepage rows.
//
// Availability/attendance isn't shown: FindmiEvent has no capacity, RSVP
// count, or attendee-count column today, so there's nothing real to
// display there — see the homepage implementation report.
export default function CompactEventCard({ event }: { event: EventWithCategories }) {
  const { label: when, live } = getTemporalLabel(event.start_at, event.end_at);
  const location = [event.venue_name, cityState(event.city, event.state)].filter(Boolean).join(" · ");
  const category = event.categories[0]?.name ?? null;

  return (
    <Link
      href={`/event/${event.slug}`}
      className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-black/5 bg-white transition active:scale-[0.98]"
    >
      <div className="relative aspect-[4/3] w-full shrink-0 bg-mist">
        {event.cover_image_url ? (
          <Image
            src={event.cover_image_url}
            alt={event.name}
            fill
            sizes="(min-width: 768px) 220px, 42vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <CalendarGlyph className="h-6 w-6 text-white/25" />
          </div>
        )}
        <span
          className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
            live ? "bg-findmi text-white" : "bg-black/55 text-white backdrop-blur-sm"
          }`}
        >
          {live && <LiveDot className="text-white" />}
          {formatDateShort(event.start_at)}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        {category && <p className="truncate text-[10px] font-bold uppercase tracking-wide text-ink/40">{category}</p>}
        <p className="line-clamp-2 font-display text-sm font-semibold leading-snug text-ink">{event.name}</p>
        {location && <p className="truncate text-xs text-ink/50">{location}</p>}
        <p className={`mt-auto truncate text-xs font-medium ${live ? "text-findmi-700" : "text-ink/45"}`}>
          {live ? when : formatTime(event.start_at)}
        </p>
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
