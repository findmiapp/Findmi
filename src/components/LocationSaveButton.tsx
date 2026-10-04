"use client";

import { useAccountSaved } from "@/lib/useAccountSaved";

export default function LocationSaveButton({
  slug,
  id,
  layout = "icon",
}: {
  slug: string;
  id?: string;
  /** Location Detail V1 — "icon" (default, unchanged) is the existing
   * compact circular icon-only button. "grid" is an icon-over-label
   * control that fills its parent grid cell, same shape/geometry as
   * EventSaveButton's own "grid" layout, for the Location page's primary
   * action grid (see LocationPublicView.tsx). */
  /** "square": the shared Event action-row utility square (same
   * geometry and saved treatment as EventSaveButton's "icon" layout). */
  layout?: "icon" | "grid" | "square";
}) {
  const { saved, toggle } = useAccountSaved("location", slug, id);

  if (layout === "square") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved}
        aria-label={saved ? "Saved" : "Save"}
        title={saved ? "Saved" : "Save"}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11 border transition active:scale-95 ${
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

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? "Remove from Saved" : "Save"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-ink transition active:scale-90"
    >
      <svg viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} className="h-4 w-4">
        <path
          d="M6 4h12a1 1 0 011 1v15l-7-4-7 4V5a1 1 0 011-1z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
