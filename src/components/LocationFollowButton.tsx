"use client";

import { isLocationFollowed } from "@/lib/followedLocations";
import { useFollowControl } from "@/components/useFollowControl";

// Location-side Follow / Following — same shared behavior as the Business
// and Event controls (components/useFollowControl.tsx): signed in,
// Follow is one tap and Following opens the Unfollow confirmation; not
// signed in, Follow opens the account prompt; a legacy guest follow on
// this device (lib/followedLocations.ts) still shows Following and opens
// the account prompt. Following a Location never touches the Business or
// Event follow tables. Only this control's sizes/tones live here. The
// legacy guest email API (/api/follow-location) and its data are
// untouched, just no longer reachable from here.
export default function LocationFollowButton({
  locationId,
  locationSlug,
  locationName,
  size = "default",
  tone = "primary",
}: {
  locationId: string;
  locationSlug: string;
  locationName: string;
  /** "action" (Location Page Final Composition): sized to sit in the
   * Location action row beside Directions / Save / Share (h-10, sm:h-11,
   * rounded-xl like those squares), with a labelled "Following" state. */
  size?: "default" | "compact" | "action";
  /** "accent" (Location Hero Follow Composition pass; was Pass 2's
   * "quiet") — aqua text + aqua border on white, for a page where another
   * action is the aqua-filled primary (the Location page's Directions).
   * Following then reads as a pale-aqua filled check. */
  tone?: "primary" | "accent";
}) {
  const { following, buttonProps, overlays } = useFollowControl({
    kind: "location",
    slug: locationSlug,
    name: locationName,
    entityId: locationId,
    guestFollowed: () => isLocationFollowed(locationId),
  });

  const compact = size === "compact";
  const action = size === "action";
  const h = action ? "h-10 sm:h-11" : compact ? "h-9" : "h-12";
  const text = action ? "text-[13px]" : compact ? "text-xs" : "text-sm";
  const radius = action ? "rounded-xl" : "rounded-lg";
  const accent = tone === "accent";
  const followingTone = accent ? "border border-findmi/40 bg-findmi-50 text-findmi-700 hover:bg-findmi-100" : "bg-findmi text-white hover:bg-findmi-600";

  return (
    <>
      {/* One element for every state, so a tap never remounts it and
          keyboard focus stays put. "action" spells out "✓ Following" (a
          bare check would be ambiguous in that icon row; the check drops
          below 375px so the label never crowds Directions); compact/default
          keep the check-only square footprint, with the meaning carried
          by aria-label/title. */}
      <button
        {...buttonProps}
        className={
          following
            ? action
              ? `flex ${h} shrink-0 items-center justify-center gap-1 whitespace-nowrap ${radius} px-2.5 ${text} font-bold transition ${followingTone}`
              : `flex ${h} w-9 shrink-0 items-center justify-center rounded-lg transition ${followingTone}`
            : `flex ${h} shrink-0 items-center justify-center whitespace-nowrap ${radius} ${action ? "px-3" : "px-2.5 uppercase tracking-wide"} ${text} font-bold transition ${
                accent ? "border border-findmi bg-white text-findmi-700 hover:bg-findmi-50" : "bg-findmi text-white hover:bg-findmi-600"
              }`
        }
      >
        {following ? (
          action ? (
            <>
              <CheckGlyph className="hidden h-3.5 w-3.5 shrink-0 min-[375px]:block" />
              Following
            </>
          ) : (
            <CheckGlyph className="h-4 w-4" />
          )
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
