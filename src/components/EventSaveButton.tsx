"use client";

import { useAccountSaved } from "@/lib/useAccountSaved";

export default function EventSaveButton({
  slug,
  id,
  layout = "pill",
}: {
  slug: string;
  id?: string;
  /** Event Detail Action Bar Correction pass — "pill" (default, unchanged)
   * is the existing Tier B rounded-full pill. "grid" is an icon-over-label
   * control that fills its parent grid cell, used only by the Event
   * page's Tier B utility row (see EventUtilityActions). */
  layout?: "pill" | "grid" | "icon";
}) {
  const { saved, toggle } = useAccountSaved("event", slug, id);

  if (layout === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved}
        aria-label={saved ? "Saved" : "Save"}
        title={saved ? "Saved" : "Save"}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition active:scale-95 ${
          saved ? "border-findmi/40 bg-findmi-50 text-findmi-700" : "border-black/10 bg-white text-ink/70 hover:border-ink/30 hover:text-ink"
        }`}
      >
        <svg viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} aria-hidden="true" className="h-[18px] w-[18px]">
          <path d="M6 4h12a1 1 0 011 1v15l-7-4-7 4V5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  if (layout === "grid") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved}
        className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl border border-black/10 text-ink/70 transition hover:border-ink/30 hover:text-ink"
      >
        <svg viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} className="h-4 w-4 shrink-0">
          <path
            d="M6 4h12a1 1 0 011 1v15l-7-4-7 4V5a1 1 0 011-1z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[11px] font-semibold uppercase tracking-wide">{saved ? "Saved" : "Save"}</span>
      </button>
    );
  }

  // Final refinement pass, item 6 — matches the exact pill treatment
  // (border, height, text size) every other Tier B utility action already
  // uses (Directions/Follow/Contact Organizer/Event Details), instead of a
  // fixed-size icon-only square that visually didn't match its siblings in
  // the same row.
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      className="flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
    >
      <svg viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} className="h-3.5 w-3.5 shrink-0">
        <path
          d="M6 4h12a1 1 0 011 1v15l-7-4-7 4V5a1 1 0 011-1z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
      {saved ? "Saved" : "Save"}
    </button>
  );
}
