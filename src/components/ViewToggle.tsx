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
  return (
    <div role="group" aria-label={label} className="flex shrink-0 items-center gap-0.5 rounded-full border border-black/[0.08] p-0.5">
      <ViewToggleButton label="Cards" active={view === "cards"} onClick={() => onChange("cards")}>
        <GridGlyph className="h-4 w-4" />
      </ViewToggleButton>
      <ViewToggleButton label="List" active={view === "list"} onClick={() => onChange("list")}>
        <ListGlyph className="h-4 w-4" />
      </ViewToggleButton>
    </div>
  );
}

function ViewToggleButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`flex h-8 w-9 items-center justify-center rounded-full transition ${
        active ? "bg-findmi-50 text-findmi-700" : "text-ink/45 hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

/** Clean 2x2 tiles: 5.5-unit squares on a 9.5-unit pitch, so even after
 * the 1.7 stroke there's a clear gap between tiles at 16px. */
function GridGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="4.5" y="4.5" width="5.5" height="5.5" rx="1.4" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14" y="4.5" width="5.5" height="5.5" rx="1.4" stroke="currentColor" strokeWidth="1.7" />
      <rect x="4.5" y="14" width="5.5" height="5.5" rx="1.4" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14" y="14" width="5.5" height="5.5" rx="1.4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ListGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="5.25" cy="6.5" r="1.15" fill="currentColor" />
      <circle cx="5.25" cy="12" r="1.15" fill="currentColor" />
      <circle cx="5.25" cy="17.5" r="1.15" fill="currentColor" />
    </svg>
  );
}
