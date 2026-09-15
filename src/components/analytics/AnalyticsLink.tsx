"use client";

import type { AnchorHTMLAttributes } from "react";
import { trackEvent, type TrackEventPayload } from "@/lib/analytics/track";

/** A plain <a> that also fires one analytics event on click — used where
 * a Server Component renders a real link (BusinessLinksRow's Call/Email/
 * Website/social pills) and needs a click recorded without becoming a
 * client component itself or changing the link's own behavior. Never
 * calls preventDefault — tel:/mailto:/external navigation always proceeds
 * exactly as it did before this pass; the analytics call is fired
 * alongside it, not instead of it, and never blocks it (trackEvent
 * itself is fire-and-forget). */
export default function AnalyticsLink({
  trackPayload,
  onClick,
  ...anchorProps
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  trackPayload: Omit<TrackEventPayload, "referrer" | "utm_source" | "utm_medium" | "utm_campaign">;
}) {
  return (
    <a
      {...anchorProps}
      onClick={(e) => {
        trackEvent(trackPayload);
        onClick?.(e);
      }}
    />
  );
}
