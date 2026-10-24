"use client";

import { useRef, useState, type TouchEvent } from "react";
import { swipeDirection } from "@/lib/moment-filters";

/** Board-style view navigation (Todoist Boards): swipe the content surface
 * left / right to move to the next / previous view. The surface follows
 * the finger horizontally (damped) and snaps back; only a completed,
 * dominantly horizontal swipe (lib/moment-filters swipeDirection) changes
 * the view, so vertical scrolling never does. Individual cards are never
 * swiped away. Pair with `touch-action: pan-y` on the surface so the
 * browser keeps vertical scrolling and the page never scrolls sideways. */
export function useBoardSwipe(onSwipe: (direction: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    start.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!start.current || !t) return;
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    // Follow only clearly horizontal drags; never fight vertical scrolling.
    setOffset(Math.abs(dx) > Math.abs(dy) * 1.5 ? Math.max(-48, Math.min(48, dx * 0.25)) : 0);
  };
  const onTouchEnd = (e: TouchEvent) => {
    const t = e.changedTouches[0];
    const s = start.current;
    start.current = null;
    setOffset(0);
    if (!s || !t) return;
    const dir = swipeDirection(t.clientX - s.x, t.clientY - s.y);
    if (dir) onSwipe(dir);
  };
  const onTouchCancel = () => {
    start.current = null;
    setOffset(0);
  };
  return {
    offset,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
  };
}
