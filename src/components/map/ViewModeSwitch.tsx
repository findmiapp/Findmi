"use client";

import type { ViewMode } from "@/lib/geo-results";

// Map Everywhere — the ONE presentation control every archive uses:
// List | Map, plus Split on desktop. Same white / Aqua segmented style
// everywhere; the selected mode is unmistakable (filled Aqua + pressed).

export const VIEW_MODE_ICONS: Record<ViewMode, string> = {
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14",
  split: "M4 5h16v14H4zM11 5v14",
};
const LABELS: Record<ViewMode, string> = { list: "List", map: "Map", split: "Split" };

export default function ViewModeSwitch({ value, onChange, allowSplit = true, className = "" }: { value: ViewMode; onChange: (v: ViewMode) => void; allowSplit?: boolean; className?: string }) {
  const modes: ViewMode[] = allowSplit ? ["list", "map", "split"] : ["list", "map"];
  return (
    <div role="group" aria-label="View" className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border border-black/[0.08] bg-white p-0.5 shadow-sm ${className}`}>
      {modes.map((m) => {
        const on = value === m;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(m)}
            className={`${m === "split" ? "hidden lg:inline-flex" : "inline-flex"} min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition ${on ? "bg-findmi text-white" : "text-ink/70 hover:text-ink"}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
              <path d={VIEW_MODE_ICONS[m]} />
            </svg>
            {LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}
