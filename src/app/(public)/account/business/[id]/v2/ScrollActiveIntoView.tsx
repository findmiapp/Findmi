"use client";

import { useEffect, useRef } from "react";

/** Renders nothing: on mount, scrolls the sibling tab marked
 * aria-current="page" into view inside its horizontally scrolling tab rail,
 * so the active tab is never left half-clipped at the edge on a narrow
 * phone. Scrolls only the rail (never the page). */
export default function ScrollActiveIntoView() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const rail = ref.current?.parentElement;
    const active = rail?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!rail || !active) return;
    const target = active.offsetLeft - (rail.clientWidth - active.offsetWidth) / 2;
    rail.scrollTo({ left: Math.max(0, target) });
  }, []);
  return <span ref={ref} aria-hidden="true" className="hidden" />;
}
