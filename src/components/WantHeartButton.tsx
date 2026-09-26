"use client";

import { useAccountSaved, type SavedEntityType } from "@/lib/useAccountSaved";

/** Consumer Experience V1 — a compact, icon-only variant of the existing
 * Save affordance (SaveButton/EventSaveButton/ProductSaveButton/
 * LocationSaveButton), for overlaying on a discovery tile/card rather than
 * sitting as a full-width pill on a detail page. Same shared hook, same
 * bookmark glyph those already use (not a new heart shape — the visual
 * grammar for "this is saved" should read identically everywhere it
 * appears), same guest-localStorage-then-account-once-signed-in behavior.
 * Always renders inside a parent `<Link>` on these tiles, so its click
 * stops propagation/prevents the parent navigation from also firing. */
export default function WantHeartButton({
  type,
  slug,
  id,
  className = "",
}: {
  type: SavedEntityType;
  slug: string;
  id?: string;
  className?: string;
}) {
  const { saved, toggle } = useAccountSaved(type, slug, id);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      aria-pressed={saved}
      aria-label={saved ? "Remove from Want" : "Want"}
      className={`flex items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition active:scale-90 ${className}`}
    >
      <svg viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} className="h-[45%] w-[45%]">
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
