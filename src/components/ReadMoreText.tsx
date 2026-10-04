"use client";

import { useEffect, useRef, useState } from "react";

/** Collapsed-by-default long text with a "Read more" toggle — used by the
 * Event page's "What's happening" preview (and Location/Journal pages) so
 * a long description doesn't dominate the top of the page. Collapsed state
 * clamps with CSS line-clamp; expanding just removes the clamp.
 *
 * Public Event V2.1 — "Read more" only appears when the text is actually
 * clamped: a cheap length/line heuristic decides the first render (no
 * layout shift for the common cases), then one measurement after mount
 * (scrollHeight vs clientHeight of the clamped paragraph) corrects it. */
export default function ReadMoreText({
  text,
  clampClassName = "line-clamp-4",
  className = "text-sm leading-relaxed text-ink/70",
}: {
  text: string;
  /** Static Tailwind class (so the build-time scan finds it). */
  clampClassName?: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(() => text.length > 200 || text.split("\n").length > 3);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [expanded, text]);

  return (
    <div>
      <p ref={ref} className={`whitespace-pre-line ${className} ${expanded ? "" : clampClassName}`}>
        {text}
      </p>
      {!expanded && overflowing && (
        <button type="button" onClick={() => setExpanded(true)} className="mt-1 text-xs font-semibold text-findmi-700">
          Read more
        </button>
      )}
    </div>
  );
}
