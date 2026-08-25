"use client";

import { useEffect, useState } from "react";
import { isEventSaved, toggleEventSaved } from "@/lib/saved";

export default function EventSaveButton({ slug }: { slug: string }) {
  const [saved, setSaved] = useState(false);

  // Read after mount only — localStorage isn't available during SSR, and
  // reading it during render would mismatch the server-rendered markup.
  useEffect(() => {
    setSaved(isEventSaved(slug));
  }, [slug]);

  // Final refinement pass, item 6 — matches the exact pill treatment
  // (border, height, text size) every other Tier B utility action already
  // uses (Directions/Follow/Contact Organizer/Event Details), instead of a
  // fixed-size icon-only square that visually didn't match its siblings in
  // the same row. Same save/unsaved behavior and localStorage-backed
  // state, unchanged — only the visual treatment and an added text label.
  return (
    <button
      type="button"
      onClick={() => setSaved(toggleEventSaved(slug))}
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
