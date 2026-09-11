"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// Final refinement pass, items 4/8 — shared Bulletin/Announcement pattern
// for both Business Profile and Event Detail. Deliberately restrained:
// light aqua tint, thin border — reads as a real, timely notice ("Booking
// fall events now", "Rain or shine"), never as an advertisement or a
// giant CTA block. Renders nothing when there's no real body text —
// callers should only mount this when bulletin_enabled &&
// bulletin_body?.trim() are both true, but the empty check lives here too
// as a backstop against ever rendering an empty box.
//
// Business Profile polish pass — extended (not replaced/duplicated) with
// two new OPTIONAL props: `label` (founder-editable, e.g. "Flash Sale" —
// still defaults to "Bulletin" when omitted entirely, exactly like
// before, so Event Detail's existing call site is byte-identical in
// behavior) and `url` (an already-validated safe destination — the
// caller is responsible for validation, same convention as this page's
// other pre-filtered props like socialLinks; this component just decides
// how to render a link vs. a static block). Passing a bad/unsafe string
// as `url` is a caller bug, not something this component re-checks.
//
// Appearance UX Cleanup pass, item 3 — a long announcement body could
// make this card tall enough to dominate the page. Presentation only:
// the stored body text is never truncated/changed, just visually clamped
// (existing `line-clamp-3` utility, already used elsewhere for card
// titles/excerpts — see globals.css) with a client-side View more/Show
// less toggle. This promoted the component from a Server Component to a
// Client Component (needed for the expand/collapse state); every prop
// stays the same plain, serializable string/null shape, so both call
// sites (Business Profile, Event Detail) are unaffected. Whether a real
// overflow exists is measured against the actual rendered height
// (scrollHeight vs clientHeight) rather than guessed from character
// count, so a short announcement never shows a toggle it doesn't need.
export default function Bulletin({
  label,
  heading,
  body,
  url,
}: {
  label?: string | null;
  heading?: string | null;
  body?: string | null;
  url?: string | null;
}) {
  const text = body?.trim();
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  useEffect(() => {
    // Measured while still collapsed (expanded starts false on every
    // mount/text change above) — scrollHeight is the true full-content
    // height regardless of the line-clamp; clientHeight is bounded to the
    // clamped 3 lines. Intentionally NOT re-run when `expanded` toggles:
    // once known, whether the collapsed state truncates doesn't change.
    const el = bodyRef.current;
    if (!el) return;
    setIsClamped(el.scrollHeight > el.clientHeight + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  if (!text) return null;

  const displayLabel = label?.trim() || "Bulletin";
  const external = url ? /^https:\/\//i.test(url) : false;

  const mainContent = (
    <>
      <MegaphoneGlyph className="h-6 w-6 shrink-0 text-findmi-700" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-findmi-700">{displayLabel}</p>
        {heading?.trim() && <p className="mt-0.5 text-sm font-bold text-ink">{heading.trim()}</p>}
        <p
          ref={bodyRef}
          className={`mt-0.5 whitespace-pre-line text-sm text-ink/75 ${expanded ? "" : "line-clamp-3"}`}
        >
          {text}
        </p>
      </div>
      {url && <ChevronGlyph className="h-4 w-4 shrink-0 self-center text-findmi-700/60" />}
    </>
  );

  // The toggle is always a sibling of (never nested inside) the optional
  // url Link/anchor below — nesting a <button> inside an <a> is invalid
  // HTML and would also trigger navigation on click instead of expanding.
  // Rendered outside the box's padding-consistent row so it reads as part
  // of the same card without being part of the click target.
  const toggle = isClamped && (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="mt-1.5 text-xs font-bold text-findmi-700 hover:underline"
    >
      {expanded ? "Show less" : "View more"}
    </button>
  );

  const rowClass = "flex items-center gap-3";
  // Item 5 — the row (not a small link buried inside it) is the clickable
  // target when a url is present, with the chevron above as the visual
  // affordance that it goes somewhere. Hover styling stays on the outer
  // box below (not just the inner anchor) — :hover on a nested child
  // naturally also matches its ancestor's own :hover, so this still
  // highlights the whole card on hover exactly as before.
  const boxClass = `rounded-2xl border border-findmi/25 bg-findmi-50/70 px-4 py-3.5 ${
    url ? "transition hover:border-findmi/40 hover:bg-findmi-50" : ""
  }`;

  if (url) {
    if (external) {
      return (
        <div className={boxClass}>
          <a href={url} target="_blank" rel="noreferrer" className={rowClass}>
            {mainContent}
          </a>
          {toggle}
        </div>
      );
    }
    return (
      <div className={boxClass}>
        <Link href={url} className={rowClass}>
          {mainContent}
        </Link>
        {toggle}
      </div>
    );
  }

  return (
    <div className={boxClass}>
      <div className={rowClass}>{mainContent}</div>
      {toggle}
    </div>
  );
}

function MegaphoneGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M3 10v4a1 1 0 001 1h2l4.2 3.3a1 1 0 001.6-.8V6.5a1 1 0 00-1.6-.8L6 9H4a1 1 0 00-1 1z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M15.5 9c1 .9 1 4.1 0 5M18 6.5c2 1.8 2 9.2 0 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
