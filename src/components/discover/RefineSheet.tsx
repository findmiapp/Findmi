"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Refine — the ONE filter entry point an archive shows (Archive Discovery
 * UX pass). A compact trigger ("Refine", with the active-filter count) and
 * a modular sheet: the archive passes only the modules it supports as
 * children (<RefineSection>s), built from its EXISTING filter controls —
 * native fields inside the page's own <form method="get">, so Apply is the
 * same URL-driven submit as before (shareable, back/forward-safe). Where /
 * Sort pickers keep their own immediate behavior.
 *
 * Sheet behavior: bottom sheet on phones, centered panel from sm:; focus
 * moves in and is trapped, Escape / backdrop / × close it, the phone's
 * Back closes it (one same-URL history entry while open — the archive
 * URL itself is never changed by opening or closing), and focus returns
 * to the trigger.
 */
export default function RefineSheet({
  noun,
  activeCount,
  resetHref,
  submitLabel,
  className = "",
  children,
}: {
  /** "Events" → "Refine Events", "Show Events". */
  noun: string;
  activeCount: number;
  /** The archive with every Refine filter removed (search / view kept). */
  resetHref: string;
  submitLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pushed = useRef(false);
  const titleId = useId();

  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back(); // the popstate below closes the sheet
      return;
    }
    setOpen(false);
  }, []);

  const show = () => {
    setOpen(true);
    try {
      window.history.pushState({ ...(window.history.state ?? {}), findmiSheet: "refine" }, "");
      pushed.current = true;
    } catch {
      pushed.current = false;
    }
  };

  useEffect(() => {
    if (!open) return;
    const onPop = () => {
      pushed.current = false;
      setOpen(false);
    };
    window.addEventListener("popstate", onPop);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus], button, select, input, a[href]");
    first?.focus();
    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = prev;
      trigger.current?.focus();
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>("button, select, input, a[href], [tabindex]:not([tabindex='-1'])")].filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
    if (!items.length) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={activeCount > 0 ? `Refine, ${activeCount} active` : "Refine"}
        className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi ${
          activeCount > 0 ? "border-findmi bg-findmi-50 text-findmi-700" : "border-black/10 bg-white text-ink/75 hover:border-black/20"
        } ${className}`}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4">
          <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Refine
        {activeCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-findmi px-1 text-[11px] font-bold text-white">{activeCount}</span>}
      </button>

      {/* Always mounted (hidden when closed) so the module fields stay part
          of the surrounding <form> — Enter in the search field still
          submits the current Refine choices, exactly as before. */}
      <div className={open ? "fixed inset-0 z-50" : "hidden"} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <div className="absolute inset-0 bg-black/40" onClick={close} />
        <div
          ref={panel}
          className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-3xl bg-white shadow-xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-20 sm:max-h-[80vh] sm:w-[26rem] sm:-translate-x-1/2 sm:rounded-3xl"
        >
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <h2 id={titleId} className="font-display text-lg font-bold tracking-tight text-ink">
              Refine {noun}
            </h2>
            <button type="button" onClick={close} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-ink/60 transition hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
          <div className="flex items-center justify-between gap-3 border-t border-black/5 px-5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3.5">
            <Link href={resetHref} className="flex h-11 items-center rounded-full px-2 text-sm font-semibold text-ink/65 underline-offset-2 hover:underline">
              Reset
            </Link>
            <button type="submit" className="flex h-11 flex-1 items-center justify-center rounded-full bg-findmi px-5 text-sm font-bold text-white transition hover:bg-findmi-600 sm:flex-none">
              {submitLabel ?? `Show ${noun}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** One Refine module ("Where", "When", "Category", "Sort"…). */
export function RefineSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-ink/50">{title}</h3>
      {children}
    </section>
  );
}
