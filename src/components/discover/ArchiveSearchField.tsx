"use client";

import { useRef, useState } from "react";

/**
 * Shared archive search input (Discovery/Archive V2 Part 15) — one field
 * inside the page's own <form method="get">, so pressing Enter still
 * submits natively and the query lands in the URL (`?q=...`) like every
 * other filter. Not a separate component instance per keystroke/
 * typeahead — the header's AJAX search already owns that experience
 * (HeaderSearch.tsx); this is the archive pages' own real, URL-driven
 * search field, shared as-is by /businesses and /events.
 *
 * Businesses Discovery V4 — a compact × clear control, same UX principle
 * as HeaderSearch's own (clear the text, keep focus so the mobile
 * keyboard never closes, let the visitor immediately type a fresh term),
 * but a genuinely separate, small implementation — this field is
 * uncontrolled/native-submit by design and deliberately isn't wired to
 * HeaderSearch's live-AJAX state at all. Promoting the field from
 * `defaultValue` to real `useState` here is presentation-only: the input
 * still has `name="q"` inside the surrounding <form method="get">, so a
 * real Enter/submit still produces the exact same ?q=... navigation as
 * before — no change to how a search is actually executed.
 */
export default function ArchiveSearchField({
  name = "q",
  defaultValue,
  placeholder,
}: {
  name?: string;
  defaultValue?: string;
  placeholder: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-full border border-black/10 bg-white pl-5 pr-11 text-sm text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none"
      />
      {value.length > 0 && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setValue("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink/40 transition hover:bg-black/[0.06] hover:text-ink/70"
        >
          <ClearGlyph className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function ClearGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
