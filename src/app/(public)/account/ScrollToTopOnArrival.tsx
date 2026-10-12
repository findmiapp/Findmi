"use client";

import { useEffect } from "react";

/** VCL A2 — the completion state is reached by a redirect from the Review
 * form's server action, and Next.js keeps the scroll position across that
 * navigation, so the visitor arrived partway down Account Home with the
 * confirmation above the viewport. Rendered only with the completion
 * card: one deterministic scroll to the top on arrival (an effect, after
 * the router's own scroll handling — no timers). Ordinary /account visits
 * are untouched. */
export default function ScrollToTopOnArrival() {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);
  return null;
}
