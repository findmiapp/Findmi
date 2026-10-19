"use client";

import { isFollowed, markFollowed } from "@/lib/followed";
import { useFollowControl } from "@/components/useFollowControl";

// The single Follow action for a business profile — Follow / Following.
// Follow is an account relationship, but a signed-out visitor's FIRST
// Follow tap succeeds silently (Guest-First Creation pass): it's recorded
// on this device (lib/followed.ts, the same marker a legacy guest device
// already had) and shows Following right away, no account prompt. Tapping
// it again (to unfollow, or to see it's only local) opens the account
// prompt to sign up/log in and keep it; signed in, Follow is one tap and
// "Following" opens the Unfollow confirmation. All of that behavior is
// shared (components/useFollowControl.tsx); this file is only the
// Business control's sizes and visuals. The legacy guest email API
// (/api/follow) and its data are untouched, just no longer reachable from
// here.
export default function FollowButton({
  businessId,
  businessSlug,
  businessName,
  /** "compact" is purely a sizing/typography variant (h-9/text-xs vs
   * h-12/text-sm) — behavior is identical between the two sizes. */
  size = "default",
}: {
  businessId: string;
  businessSlug: string;
  businessName: string;
  size?: "default" | "compact";
}) {
  const { following, buttonProps, overlays } = useFollowControl({
    kind: "business",
    slug: businessSlug,
    name: businessName,
    entityId: businessId,
    guestFollowed: () => isFollowed(businessSlug),
    markGuestFollowed: () => markFollowed(businessSlug),
  });

  const compact = size === "compact";
  const h = compact ? "h-9" : "h-12";
  const text = compact ? "text-xs" : "text-sm";

  return (
    <>
      {/* One element for every state, so a tap never remounts it and
          keyboard focus stays put. Compact keeps the check-only square
          footprint when following (meaning carried by aria-label/title);
          default size spells out "Following". */}
      <button
        {...buttonProps}
        className={
          following
            ? compact
              ? `flex ${h} w-9 shrink-0 items-center justify-center rounded-lg bg-findmi text-white transition hover:bg-findmi-600`
              : `flex ${h} shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-findmi px-3 ${text} font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600`
            : `flex ${h} shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-findmi px-2.5 ${text} font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600`
        }
      >
        {following ? (
          <>
            <CheckGlyph className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} />
            {!compact && "Following"}
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
