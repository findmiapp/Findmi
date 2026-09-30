"use client";

import { useState } from "react";

/** Collapsed-by-default long text with a "Read more" toggle — used by the
 * Event page's "About This Event" section so a long description doesn't
 * dominate the top of the page. Collapsed state clamps to 4 lines (CSS
 * line-clamp, no truncation logic of its own); expanding just removes the
 * clamp — no height animation, no measuring. A static class name (not
 * interpolated) so Tailwind's build-time scan actually finds it. */
export default function ReadMoreText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <p className={`whitespace-pre-line text-sm leading-relaxed text-ink/70 ${expanded ? "" : "line-clamp-4"}`}>
        {text}
      </p>
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-xs font-semibold text-findmi-700"
        >
          Read more
        </button>
      )}
    </div>
  );
}
