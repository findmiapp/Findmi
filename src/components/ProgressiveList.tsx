"use client";

import { useState } from "react";

export const PROGRESSIVE_STEP = 3;

/** Field QA UX Pass 2 — one shared progressive-disclosure rule for long
 * vertical LIST views (dates, Appearances): 3 up front, "Show 3 More"
 * adds exactly 3, and a separate View All reveals everything. Cards /
 * carousel views keep their own bounded behavior and don't use this. */
export function useProgressiveReveal(total: number, step = PROGRESSIVE_STEP) {
  const [count, setCount] = useState(step);
  const visible = Math.min(count, total);
  return {
    visible,
    hasMore: visible < total,
    showMore: () => setCount((c) => c + step),
    showAll: () => setCount(total),
  };
}

/** The matching footer: "Show 3 More" (or "Show 1 More"/"Show 2 More" for
 * a shorter remainder) plus "View All N …". Renders nothing once
 * everything is visible or when there are 3 or fewer items. */
export function ProgressiveListFooter({
  visible,
  total,
  onMore,
  onAll,
  noun,
  step = PROGRESSIVE_STEP,
}: {
  visible: number;
  total: number;
  onMore: () => void;
  onAll: () => void;
  /** Plural Title Case noun for the View All label, e.g. "Dates". */
  noun: string;
  step?: number;
}) {
  if (visible >= total) return null;
  const next = Math.min(step, total - visible);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onMore}
        className="flex h-10 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:border-ink/30"
      >
        Show {next} More
      </button>
      <button type="button" onClick={onAll} className="flex h-10 items-center px-2 text-sm font-semibold text-findmi-700 transition hover:text-findmi-800">
        View All {total} {noun}
      </button>
    </div>
  );
}
