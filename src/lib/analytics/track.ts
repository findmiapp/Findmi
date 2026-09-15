"use client";

// Findmi Analytics — the one client-side entry point every instrumented
// component calls. Analytics is strictly subordinate to real product
// behavior: this never throws, never blocks the caller, and never
// prevents/delays the actual navigation, save, follow, or share it's
// reporting on. No console output in production — a dropped analytics
// beacon should never look like an app error to anyone watching devtools.
//
// Transport: navigator.sendBeacon first (survives the page unloading
// immediately after a click — e.g. an outbound Website/social link),
// falling back to fetch(..., { keepalive: true }) where sendBeacon isn't
// available. Both are fire-and-forget; neither is awaited by callers.
import type { AnalyticsEventName } from "./taxonomy";

const ENDPOINT = "/api/analytics/track";

export interface TrackEventPayload {
  event_name: AnalyticsEventName;
  subject_type?: string;
  subject_id?: string;
  business_id?: string;
  event_id?: string;
  event_occurrence_id?: string;
  appearance_id?: string;
  location_id?: string;
  product_id?: string;
  discovery_page_id?: string;
  discovery_section_id?: string;
  page_type?: string;
  page_path?: string;
  placement?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  metadata?: Record<string, unknown>;
}

/** Reads document.referrer + the current URL's utm_* params once — the
 * only place this original-navigation context is actually available
 * (by the time a beacon reaches the server, its own request has no
 * memory of what page the VISITOR came from before landing here). Not
 * identity — safe, ordinary page context, same as any analytics SDK
 * would read. */
function currentPageContext(): Pick<TrackEventPayload, "referrer" | "utm_source" | "utm_medium" | "utm_campaign"> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  return {
    referrer: document.referrer || undefined,
    utm_source: params.get("utm_source") || undefined,
    utm_medium: params.get("utm_medium") || undefined,
    utm_campaign: params.get("utm_campaign") || undefined,
  };
}

/** Fire-and-forget. Never awaited, never throws into the caller. */
export function trackEvent(payload: TrackEventPayload): void {
  try {
    const body = JSON.stringify({ ...currentPageContext(), ...payload });

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const sent = navigator.sendBeacon(ENDPOINT, body);
      if (sent) return;
      // sendBeacon returned false (payload queue full/refused) — fall
      // through to fetch as a best-effort second attempt.
    }

    if (typeof fetch === "function") {
      fetch(ENDPOINT, {
        method: "POST",
        body,
        keepalive: true,
        headers: { "Content-Type": "text/plain" },
      }).catch(() => {
        // Best-effort — a dropped analytics event is never surfaced.
      });
    }
  } catch {
    // Never let an analytics failure become a visible error anywhere.
  }
}
