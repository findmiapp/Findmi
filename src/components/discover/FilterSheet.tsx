"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Small, generic filter trigger + panel — Discovery/Archive V2's shared
 * foundation (Part 15: "a small reusable foundation," not one giant
 * overabstracted filtering framework). This component only owns
 * open/close UI state and where the panel renders (bottom sheet on
 * mobile, a plain dropdown panel on desktop); it knows nothing about
 * what a business or event filter actually is. The real filter fields
 * are passed in as `children` — plain server-rendered <form method="get">
 * content with real `defaultValue`s from the current URL — so the
 * filters themselves stay fully URL-driven (shareable, back/forward-safe,
 * survives a refresh) rather than becoming client-only state that
 * disappears on reload. `activeCount` just changes the trigger's own
 * label/badge; it doesn't gate anything.
 */
export default function FilterSheet({
  activeCount,
  children,
}: {
  activeCount: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // Body scroll lock while the mobile sheet is open — small, standard,
  // and reverted on close/unmount.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className={`flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition ${
          activeCount > 0
            ? "border-findmi bg-findmi-50 text-findmi-700"
            : "border-black/10 text-ink/70 hover:border-black/20"
        }`}
      >
        <FilterGlyph className="h-4 w-4" />
        Filters
        {activeCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-findmi px-1 text-[11px] font-bold text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          {/* Bottom sheet on mobile (slides up, safe-area aware), a
              compact anchored panel from sm: up — one component, two
              CSS presentations, no separate desktop implementation. */}
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:inset-x-auto sm:left-1/2 sm:top-20 sm:bottom-auto sm:w-96 sm:-translate-x-1/2 sm:rounded-3xl sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold tracking-tight text-ink">Filters</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close filters"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink/60 transition hover:bg-black/5"
              >
                <CloseGlyph className="h-4 w-4" />
              </button>
            </div>
            {children}
          </div>
        </div>
      )}
    </>
  );
}

function FilterGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 6h16M7 12h10M10 18h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
