"use client";

import { isEventFollowed } from "@/lib/followedEvents";
import { useFollowControl } from "@/components/useFollowControl";

// Event-side Follow / Following — same shared behavior as the Business
// and Location controls (components/useFollowControl.tsx): signed in,
// Follow is one tap and "✓ Following" opens the Unfollow confirmation;
// not signed in, Follow opens the account prompt; a legacy guest follow
// on this device (lib/followedEvents.ts) still shows Following and opens
// the account prompt. Only this control's sizes/shapes live here. The
// legacy guest email API (/api/follow-event) and its data are untouched,
// just no longer reachable from here.
export default function EventFollowButton({
  eventId,
  eventSlug,
  eventName,
  size = "default",
  shape = "pill",
}: {
  eventId: string;
  eventSlug: string;
  eventName: string;
  size?: "default" | "compact";
  /** "block": fills its slot with a softer rounded-xl shape — used when
   * Follow takes the primary slot of the Event action row (no ticket/RSVP
   * action). Default "pill" is unchanged. */
  shape?: "pill" | "block";
}) {
  const { following, buttonProps, overlays } = useFollowControl({
    kind: "event",
    slug: eventSlug,
    name: eventName,
    entityId: eventId,
    guestFollowed: () => isEventFollowed(eventId),
  });

  const compact = size === "compact";
  const h = compact ? "h-9" : "h-11";
  const text = compact ? "text-xs" : "text-sm";
  const shapeCls = shape === "block" ? "w-full justify-center rounded-xl" : "rounded-full";

  return (
    <>
      {/* One element for every state, so a tap never remounts it and
          keyboard focus stays put. Public Event V2 — outline until
          followed, so it never competes with the organizer's primary
          action (RSVP/Tickets); the filled "✓ Following" state is the
          confirmation. */}
      <button
        {...buttonProps}
        className={
          following
            ? `flex ${h} items-center gap-1.5 ${shapeCls} bg-findmi px-4 ${text} font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600`
            : `flex ${h} items-center justify-center ${shapeCls} border border-findmi/40 bg-white px-5 ${text} font-bold uppercase tracking-wide text-findmi-700 transition hover:border-findmi/60 hover:bg-findmi-50`
        }
      >
        {following ? (
          <>
            <CheckGlyph className="h-3.5 w-3.5" />
            Following
          </>
        ) : (
          "Follow"
        )}
      </button>
      {overlays}
    </>
  );
}

function CheckGlyph({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="M4 10.5l3.5 3.5L16 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
