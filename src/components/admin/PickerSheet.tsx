"use client";

import { useEffect, useState, type ReactNode } from "react";

/** The compact selector shell shared by Category and Format: a closed,
 * one-line summary button (the selected values stay visible), which opens
 * a bottom sheet (centered dialog on wider screens) with an optional
 * search box over the canonical options. Selection logic and the form
 * contract stay with the field that renders it. Esc / backdrop close. */
export default function PickerSheet({
  label,
  summary,
  placeholder,
  title,
  searchPlaceholder,
  query,
  onQuery,
  open,
  onOpenChange,
  children,
  footer,
}: {
  label: string;
  summary: string | null;
  placeholder: string;
  title: string;
  searchPlaceholder?: string;
  query: string;
  onQuery: (q: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(true)}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-3.5 py-2 text-left transition hover:border-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
      >
        <span className="min-w-0">
          <span className="sr-only">{label}: </span>
          <span className={`block truncate text-sm ${summary ? "font-medium text-ink" : "text-ink/45"}`}>{summary ?? placeholder}</span>
        </span>
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 shrink-0 text-ink/40">
          <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" role="presentation">
          <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label={title} className="relative flex max-h-[80vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl">
            <div className="px-5 pb-2 pt-4">
              <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-10 rounded-full bg-black/10 sm:hidden" />
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-base font-bold tracking-tight text-ink">{title}</h2>
                <button type="button" onClick={() => onOpenChange(false)} className="text-sm font-semibold text-findmi-700 hover:underline">
                  Done
                </button>
              </div>
              {searchPlaceholder && (
                <input
                  type="search"
                  autoCapitalize="none"
                  value={query}
                  onChange={(e) => onQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="mt-3 w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                />
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
            {footer}
          </div>
        </div>
      )}
    </>
  );
}

/** Case-insensitive "contains" over a name. */
export const matchesQuery = (name: string, q: string) => !q.trim() || name.toLowerCase().includes(q.trim().toLowerCase());
