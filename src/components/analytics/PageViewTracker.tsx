"use client";

import { useEffect, useRef } from "react";
import { trackEvent, type TrackEventPayload } from "@/lib/analytics/track";

/** Mount this once on a public detail page (Business/Event/Location/
 * Product — see each *PublicView.tsx / page.tsx) to record a real,
 * human page_view. Deliberately client-side: a Server Component's own
 * render is not a human viewing the page (bots, prefetches, and SSR
 * itself would all count otherwise) — see the completed audit's
 * Impression/View Definitions section. Fires exactly once per real
 * mount (the ref guard also protects against React StrictMode's
 * dev-only double-effect, so local testing doesn't see doubled counts
 * either). Renders nothing. */
export default function PageViewTracker(
  props: Omit<TrackEventPayload, "event_name" | "referrer" | "utm_source" | "utm_medium" | "utm_campaign">
) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackEvent({ event_name: "page_view", ...props });
    // Intentionally fires once on mount only — this is NOT meant to
    // re-fire if `props` identity changes (e.g. a parent re-render);
    // navigating to a genuinely different entity remounts this
    // component fresh (different key implied by the route itself).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
