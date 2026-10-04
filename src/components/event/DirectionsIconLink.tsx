"use client";

import { trackEvent, type TrackEventPayload } from "@/lib/analytics/track";

/** Event Essentials — the compact square Directions control attached to
 * the WHERE column. Same maps URL and click_directions payload the old
 * text link carried; only the presentation changed. */
export default function DirectionsIconLink({
  href,
  placeName,
  trackPayload,
}: {
  href: string;
  placeName: string | null;
  trackPayload: TrackEventPayload;
}) {
  const label = placeName ? `Directions to ${placeName}` : "Directions";
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      onClick={() => trackEvent(trackPayload)}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-findmi/30 bg-findmi-50 text-findmi-700 transition hover:border-findmi/50 hover:bg-findmi-50/70 active:scale-95"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px]">
        <path d="M20 4L4 10.5l6.5 3 3 6.5L20 4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
