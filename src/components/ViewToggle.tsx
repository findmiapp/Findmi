"use client";

import { useEffect, useState } from "react";

/** Public Entity System V2 — the shared Cards / List control, extracted
 * from the Event page's Upcoming Dates (clean four-tile Cards icon, List
 * icon, pale-aqua active state, accessible labels). Used by Event Upcoming
 * Dates and Business Findmi Here. */
export type EntityView = "cards" | "list";

/** Per-device view preference. SSR and first paint always use `fallback`;
 * a stored choice applies after mount, so it never blocks rendering. All
 * storage access is guarded — it can be unavailable. */
export function useStoredView(storageKey: string, fallback: EntityView = "cards") {
  const [view, setView] = useState<EntityView>(fallback);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "cards" || stored === "list") setView(stored);
    } catch {
      // Storage unavailable — keep the default.
    }
  }, [storageKey]);
  function choose(next: EntityView) {
    setView(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }
  return [view, choose] as const;
}

export default function ViewToggle({
  view,
  onChange,
  label = "Show as",
}: {
  view: EntityView;
  onChange: (next: EntityView) => void;
  label?: string;
}) {
  // Event Compact Essentials pass — visible words (CARDS | LIST), not tiny
  // unlabeled icons: a ~110px segmented control, pale-aqua selected side.
  return (
    <div role="group" aria-label={label} className="flex shrink-0 items-center rounded-lg border border-black/10 bg-white p-0.5">
      {(
        [
          { mode: "cards" as const, text: "Cards" },
          { mode: "list" as const, text: "List" },
        ]
      ).map(({ mode, text }) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          aria-pressed={view === mode}
          className={`h-8 rounded-md px-3 text-[11px] font-bold uppercase tracking-wide transition ${
            view === mode ? "bg-findmi-50 text-findmi-700" : "text-ink/50 hover:text-primary"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
