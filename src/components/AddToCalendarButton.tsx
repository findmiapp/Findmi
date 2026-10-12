"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildCalendarPayload } from "@/lib/calendar";

// Approximate open-menu height (two h-10 options + padding/border) — used
// only to decide whether the menu fits below the trigger or opens above it.
const MENU_HEIGHT = 96;

export default function AddToCalendarButton({
  title,
  description,
  location,
  url,
  startAt,
  endAt,
  layout = "pill",
}: {
  title: string;
  description?: string | null;
  location?: string | null;
  /** Public canonical Findmi URL for this Event/Appearance — appended to
   * the calendar entry's description (and the .ics URL field). Omit when
   * there's no public destination. */
  url?: string | null;
  startAt: string;
  /** Falls back to a 2-hour block when the event has no real end time —
   * calendar apps require SOME end, so this is the least presumptuous
   * default rather than fabricating a specific one. */
  endAt?: string | null;
  /** Event Detail Action Bar Correction pass — "pill" (default, unchanged)
   * is the existing Tier B rounded-full pill. "grid" is an icon-over-label
   * control that fills its parent grid cell (label shortened to
   * "Calendar" to avoid wrapping), used only by the Event page's Tier B
   * utility row (see EventUtilityActions). Home Event Card Reconstruction
   * pass — "glass" is a compact icon-only translucent/blurred circle for
   * overlaying directly on photography (HomeEventCard's bottom action
   * dock). Public Experience Consolidation pass — "row" is a full-width,
   * fixed-height (h-11) icon+label control matching Directions/Share's own
   * geometry exactly, for a 3-across `grid grid-cols-3` action row (see
   * AppearanceQuickView) where "pill"'s intrinsic width previously made
   * Add to Calendar the odd, undersized middle button. The dropdown menu
   * itself is identical across all four — only the trigger markup
   * changes. */
  layout?: "pill" | "grid" | "glass" | "row" | "icon";
}) {
  const [open, setOpen] = useState(false);
  // Bug fix (action-row UX pass): this button sits inside the event page's
  // horizontally-scrollable Tier B action row (overflow-x-auto — see
  // commit 5d9c4f9). Per the CSS overflow spec, setting overflow-x to
  // anything but "visible" while overflow-y is left unset forces the used
  // overflow-y to "auto" too, so that row silently clips ANY normal
  // position:absolute child that extends below its own (pill-height) box
  // — exactly what this dropdown did, making both calendar options
  // invisible/unreachable. position:fixed escapes that ancestor's overflow
  // clipping (its containing block is the viewport, not the scroll row),
  // so the panel's coordinates are computed from the trigger's own
  // bounding rect on open instead of relying on CSS-relative offset.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  // Calendar Functional Repair pass — this dropdown is portaled to
  // document.body rather than rendered as a normal DOM descendant of its
  // caller. On the homepage, HomeEventCard's own card wrapper has
  // `active:scale-[0.98]` + `overflow-hidden`; CSS `:active` applies to
  // every ancestor of whatever element is pressed, so tapping an option
  // here also engages that ancestor's `:active` transform for the
  // duration of the press. A `transform` on an ancestor makes IT the
  // containing block for any `position: fixed` descendant (instead of
  // the viewport), which would otherwise shift/clip this panel's
  // viewport-relative `coords` mid-tap. Portaling — the same escape-the-
  // ancestor technique LocationFollowButton's own modal already uses —
  // removes this panel from any such ancestor's DOM subtree entirely, so
  // its containing block is always the viewport. `mounted` avoids an SSR
  // document-undefined crash, matching LocationFollowButton's pattern.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Calendar Functional Repair pass, round 2 — the previous fix (delaying
  // the close on blur) was still fragile: it assumed blur always fires
  // before click on real Android Chrome, which isn't reliably true, so a
  // tap on Google Calendar/the .ics button could still land on a panel
  // that had already started closing. Replaced with the standard, robust
  // "click outside" pattern instead of any focus/blur timing: a real
  // pointerdown listener on the document only closes the panel when the
  // event's target is genuinely outside both the trigger and the panel —
  // a tap ON either option is never treated as "outside," so it can never
  // race the option's own click. No timers, nothing timing-dependent.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // Built at tap time (never during render) from this button's own props —
  // i.e. the exact occurrence/appearance the caller rendered it for.
  const payload = () => buildCalendarPayload({ title, description, location, url, startAt, endAt });

  function openGoogleCalendar() {
    window.location.assign(payload().gcalUrl);
    setOpen(false);
  }

  function downloadIcs() {
    const blob = new Blob([payload().ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "event"}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  const triggerClass =
    layout === "grid"
      ? "flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl border border-black/10 text-ink/70 transition hover:border-ink/30 hover:text-ink"
      : layout === "icon"
        ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11 border border-black/10 bg-white text-ink/70 transition hover:border-ink/30 hover:text-ink active:scale-95"
        : layout === "glass"
        ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-black/40 text-white backdrop-blur-md transition active:scale-95"
        : layout === "row"
          ? "flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-black/10 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30"
          : "flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink";

  return (
    <div className={layout === "grid" || layout === "row" ? "relative h-full w-full" : "relative"}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={layout === "glass" || layout === "icon" ? "Add to Calendar" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        title={layout === "icon" ? "Add to Calendar" : undefined}
        onClick={() => {
          if (!open && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            // Keep the menu inside the viewport: the icon layout sits at the
            // right edge of the Event action row, and the w-48 menu would
            // otherwise overhang a narrow phone's right edge from the
            // quick-view sheets' Calendar button too.
            const left = Math.max(8, Math.min(rect.left, window.innerWidth - (layout === "icon" ? 232 : 200)));
            // Open above the trigger when the menu wouldn't fit below it
            // (e.g. the Calendar button near the bottom of a mobile sheet).
            const fitsBelow = rect.bottom + 6 + MENU_HEIGHT <= window.innerHeight;
            setCoords({ top: fitsBelow ? rect.bottom + 6 : Math.max(8, rect.top - 6 - MENU_HEIGHT), left });
          }
          setOpen((o) => !o);
        }}
        className={triggerClass}
      >
        {layout === "grid" ? (
          <>
            <CalendarPlusGlyph className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Calendar</span>
          </>
        ) : layout === "glass" || layout === "icon" ? (
          <CalendarPlusGlyph className={layout === "icon" ? "h-[18px] w-[18px]" : "h-4 w-4"} />
        ) : layout === "row" ? (
          <>
            <CalendarPlusGlyph className="h-3.5 w-3.5" />
            Calendar
          </>
        ) : (
          <>
            <CalendarPlusGlyph className="h-3.5 w-3.5" />
            Add to Calendar
          </>
        )}
      </button>
      {mounted &&
        open &&
        coords &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label="Add to Calendar"
            // Above every page layer (z-[80]), incl. the z-50 quick-view dialogs
            // this button sits inside — the menu is portaled to <body>, so
            // at z-20 it opened BEHIND an open dialog (an invisible menu:
            // tapping Calendar appeared to do nothing).
            className="fixed z-[80] w-48 overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-lg"
            style={{ top: coords.top, left: coords.left }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={openGoogleCalendar}
              className="block w-full px-3.5 py-2.5 text-left text-sm text-ink hover:bg-black/[0.03]"
            >
              Google Calendar
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={downloadIcs}
              className="block w-full px-3.5 py-2.5 text-left text-sm text-ink hover:bg-black/[0.03]"
            >
              Apple / Outlook (.ics)
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}

function CalendarPlusGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5M12 12.5v5M9.5 15h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
