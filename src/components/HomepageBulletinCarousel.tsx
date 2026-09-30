"use client";

import { useEffect, useRef, useState } from "react";
import HomepageBulletin from "./HomepageBulletin";
import type { ResolvedHomepageBulletin } from "@/lib/homepage-bulletins";

/** Homepage Bulletin Carousel pass — display interval and transition
 * speed are deliberately separate and centralized here: the carousel
 * advances once every ROTATE_INTERVAL_MS, and each swap animates over
 * TRANSITION_MS (NOT "rotates every 300ms" — that's just how long the
 * crossfade itself takes). */
const ROTATE_INTERVAL_MS = 2000;
const TRANSITION_MS = 300;

/** Wraps the exact, unchanged HomepageBulletin card design in a small
 * rotation shell — the carousel swaps which resolved Bulletin is passed
 * in as `bulletin`, it never adds a second visual shell around the card.
 * 0 published: page.tsx never renders this. Exactly 1 published: static,
 * no timer, no controls (early return below). 2+: auto-rotates with
 * manual prev/next + dot nav, pausing on hover/focus. */
export default function HomepageBulletinCarousel({ bulletins }: { bulletins: ResolvedHomepageBulletin[] }) {
  const count = bulletins.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  const [animateIn, setAnimateIn] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Auto-rotate. Depends on resetTick so a manual nav (which bumps it)
  // tears down and restarts this interval instead of stacking a second
  // one on top of it; depends on `paused` so hover/focus cleanly stops
  // and later resumes rotation with a fresh full interval.
  useEffect(() => {
    if (count < 2 || paused) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [count, paused, resetTick]);

  // Drives the per-slide crossfade: freshly false on every index change,
  // flipped true one frame later so the transition classes actually
  // animate from their "entering" state rather than skipping straight to
  // rest. motion-reduce: variants below make this an instant swap instead
  // when the visitor prefers reduced motion — no JS branch needed.
  useEffect(() => {
    setAnimateIn(false);
    const raf = requestAnimationFrame(() => setAnimateIn(true));
    return () => cancelAnimationFrame(raf);
  }, [index]);

  if (count === 0) return null;
  if (count === 1) return <HomepageBulletin bulletin={bulletins[0]} />;

  function goTo(next: number) {
    setIndex(((next % count) + count) % count);
    setResetTick((t) => t + 1);
  }

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) setPaused(false);
      }}
    >
      <div className="overflow-hidden">
        <div
          key={bulletins[index].id}
          className={`transition-[opacity,transform] ease-out motion-reduce:transition-none ${
            animateIn ? "translate-x-0 opacity-100" : "translate-x-1 opacity-0"
          }`}
          style={{ transitionDuration: `${TRANSITION_MS}ms` }}
        >
          <HomepageBulletin bulletin={bulletins[index]} />
        </div>
      </div>

      {/* Manual nav — subtle, small, touch-friendly; siblings of (never
          nested inside) the Bulletin card's own link, so tapping these can
          never also activate the destination. */}
      <div className="mt-1.5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          aria-label="Previous announcement"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-black/10 text-xs text-ink/50 transition hover:border-black/20 hover:text-ink"
        >
          ‹
        </button>
        <div className="flex items-center gap-1.5">
          {bulletins.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show announcement ${i + 1} of ${count}`}
              aria-current={i === index}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${i === index ? "bg-findmi" : "bg-ink/15"}`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => goTo(index + 1)}
          aria-label="Next announcement"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-black/10 text-xs text-ink/50 transition hover:border-black/20 hover:text-ink"
        >
          ›
        </button>
      </div>
    </div>
  );
}
