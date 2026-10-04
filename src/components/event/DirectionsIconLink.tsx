"use client";

import { trackEvent, type TrackEventPayload } from "@/lib/analytics/track";
import { EVENT_PRIMARY_CTA_CLASS } from "@/lib/event-actions";

/** Event Directions — part of the utility action family (never inside the
 * WHERE column). "icon": a compact square matching Save / Calendar /
 * Share; "expanded": the primary action when the Event has no ticket /
 * RSVP action. Same maps URL and click_directions payload either way. */
export default function DirectionsIconLink({
  href,
  placeName,
  trackPayload,
  variant = "icon",
}: {
  href: string;
  placeName: string | null;
  trackPayload: TrackEventPayload;
  variant?: "icon" | "expanded";
}) {
  const label = placeName ? `Directions to ${placeName}` : "Directions";
  const glyph = (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px]">
      <path d="M20 4L4 10.5l6.5 3 3 6.5L20 4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
  if (variant === "expanded") {
    return (
      <a href={href} target="_blank" rel="noreferrer" aria-label={label} onClick={() => trackEvent(trackPayload)} className={`${EVENT_PRIMARY_CTA_CLASS} gap-2`}>
        {glyph}
        Directions
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      onClick={() => trackEvent(trackPayload)}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-white text-ink/70 transition hover:border-ink/30 hover:text-ink active:scale-95 sm:h-11 sm:w-11"
    >
      {glyph}
    </a>
  );
}
