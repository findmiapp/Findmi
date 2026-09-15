"use client";

import type { AnchorHTMLAttributes } from "react";
import { trackEvent, type TrackEventPayload } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";

/** A plain <a> that also fires analytics — used where a Server Component
 * renders a real link and needs tracking recorded without becoming a
 * client component itself or changing the link's own behavior. Never
 * calls preventDefault — tel:/mailto:/external navigation always proceeds
 * exactly as it did before; every tracked call is fire-and-forget and
 * never blocks it.
 *
 * `impressionPayload` (Phase 2B) is optional and separate from
 * `trackPayload`: a Server Component's own bespoke card markup (e.g.
 * /find's FindCarouselCard/FindAppearanceRow — real Appearance cards,
 * just not built on the shared AppearanceCard/AppearanceFeedCard
 * components) can get BOTH viewport-impression and click coverage from
 * this one wrapper without extracting a new client component file. Omit
 * it to keep this exactly the click-only behavior every existing caller
 * (BusinessLinksRow, Directions, product_external_click) already uses. */
export default function AnalyticsLink({
  trackPayload,
  impressionPayload,
  onClick,
  ...anchorProps
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  trackPayload: Omit<TrackEventPayload, "referrer" | "utm_source" | "utm_medium" | "utm_campaign">;
  impressionPayload?: TrackEventPayload | null;
}) {
  const impressionRef = useViewportImpression<HTMLAnchorElement>(impressionPayload ?? null);

  return (
    <a
      {...anchorProps}
      ref={impressionRef}
      onClick={(e) => {
        trackEvent(trackPayload);
        onClick?.(e);
      }}
    />
  );
}
