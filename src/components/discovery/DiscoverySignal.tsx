"use client";

import { useEffect } from "react";
import { trackEvent, type TrackEventPayload } from "@/lib/analytics/track";

/** Fires one raw Discovery interaction when a Topic / Area / search page
 * opens. Carries ids and the STRUCTURED query only — never raw search
 * text, never location. */
export default function DiscoverySignal(props: TrackEventPayload) {
  const key = JSON.stringify(props);
  useEffect(() => {
    trackEvent(JSON.parse(key) as TrackEventPayload);
  }, [key]);
  return null;
}
