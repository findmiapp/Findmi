"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export interface WhenOption {
  key: string;
  label: string;
}

/** Mobile Discover Composition pass — collapses the always-visible
 * Today/This Weekend/Upcoming row into a compact toolbar trigger (same
 * "button now, sheet on demand" shape as AreaPicker's own Area control),
 * so the three temporal choices stop permanently occupying vertical space
 * above the first real content row. Same ?when= URL semantics the old
 * inline tabs used (omitted entirely for the default "upcoming"), so
 * every existing link/bookmark to a specific when= value keeps working
 * unchanged — this is a presentation change only. */
export default function WhenPicker({ options, paramName = "when" }: { options: WhenOption[]; paramName?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentKey = searchParams.get(paramName) ?? options[options.length - 1]?.key ?? "";
  const currentLabel = options.find((o) => o.key === currentKey)?.label ?? options[0]?.label ?? "When";

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function select(key: string) {
    const params = new URLSearchParams(searchParams.toString());
    // Same convention buildHref already used: the default (last option,
    // "upcoming") is never written to the URL, every other value is.
    if (key === options[options.length - 1]?.key) params.delete(paramName);
    else params.set(paramName, key);
    router.push(`?${params.toString()}`, { scroll: false });
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`When: ${currentLabel}`}
        className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-black/10 px-3 text-sm text-ink/70 transition hover:border-black/20"
      >
        <CalendarGlyph className="h-3.5 w-3.5 shrink-0 text-ink/40" />
        <span className="truncate font-semibold text-ink">{currentLabel}</span>
        <ChevronDownGlyph className="h-3 w-3 shrink-0 text-ink/40" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Choose when"
          className="absolute left-0 top-full z-30 mt-2 w-48 rounded-2xl border border-black/10 bg-white p-1.5 shadow-lg"
        >
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="menuitem"
              onClick={() => select(o.key)}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                currentKey === o.key ? "bg-findmi-50 text-findmi-700" : "text-ink hover:bg-black/[0.03]"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
