"use client";

import { useCallback, useRef } from "react";
import { trackEvent, type TrackEventPayload } from "./track";

/** The one reusable viewport-impression primitive — used by every shared
 * card (entity_impression) and by discovery section wrappers
 * (discovery_section_impression). A server render, a mount, or a card
 * merely existing below the fold is NOT an impression; this only fires
 * once the element is actually ~50% visible in the viewport, and at most
 * once per mounted instance (a re-render never re-fires, and a card
 * genuinely rendered in two different placements — two separate mounted
 * instances — legitimately fires twice, once per placement, per the
 * completed audit's Impression/View Definitions).
 *
 * Deliberately a hook returning a CALLBACK ref (not a RefObject) — this
 * assigns cleanly to any host element's `ref` prop across the React/DOM
 * typings this project uses, and naturally covers remounts (a fresh
 * element swapping in re-runs the callback, correctly re-observing)
 * without any extra effect/dependency wiring. Attach it directly to a
 * card's own existing root element (its <Link>/<a>/<div>) so this adds
 * zero extra DOM nodes and cannot affect layout — a wrapping element
 * risked breaking grid/flex sizing, and a `display:contents` wrapper
 * would have broken IntersectionObserver's own bounding-box detection
 * entirely.
 *
 * `payload` is captured once, from the value passed on first attach —
 * the entities this observes are rendered from already-resolved data,
 * never a value that legitimately changes identity on the same mounted
 * card. Pass `null` to skip observing entirely (e.g. a non-clickable/
 * placeholder card with nothing meaningful to attribute). */
export function useViewportImpression<T extends Element>(payload: TrackEventPayload | null): (node: T | null) => void {
  const fired = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  return useCallback(
    (node: T | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node || !payload || fired.current || typeof IntersectionObserver === "undefined") return;

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !fired.current) {
              fired.current = true;
              trackEvent(payload);
              observer.disconnect();
              break;
            }
          }
        },
        { threshold: 0.5 }
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}
