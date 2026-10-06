"use client";

import { useEffect, useRef, useState } from "react";

/** Public Business profile — the short description inside the identity
 * info block: clamped to 2 lines, with an inline "Read More" sitting at
 * the end of the second line (over a short fade) only when the text is
 * actually clamped, and a "Read Less" after the full text once expanded.
 * Display only; the stored description is never altered. */
export default function BusinessShortDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
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
    <div className="relative">
      <p ref={ref} className={`whitespace-pre-line text-sm leading-relaxed text-ink/70 ${expanded ? "" : "line-clamp-2"}`}>
        {text}
        {expanded && (
          <>
            {" "}
            <button type="button" onClick={() => setExpanded(false)} aria-expanded="true" className="font-semibold text-findmi-700 hover:underline">
              Read Less
            </button>
          </>
        )}
      </p>
      {!expanded && overflowing && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded="false"
          className="absolute bottom-0 right-0 bg-gradient-to-r from-white/0 via-white via-40% to-white pl-8 text-sm font-semibold leading-relaxed text-findmi-700 hover:underline"
        >
          <span className="font-normal text-ink/70">… </span>Read More
        </button>
      )}
    </div>
  );
}
