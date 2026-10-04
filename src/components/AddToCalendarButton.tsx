"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Event Detail V2 polish pass, item 9 — real event data only (title,
// start, end, venue/address, description), no paid third-party calendar
// service. Google Calendar opens a pre-filled web page (no auth/API key
// needed); .ics is generated client-side and downloaded directly, which
// covers Apple Calendar/Outlook/every other calendar app that reads the
// standard format.
function toIcsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function buildIcs({
  title,
  description,
  location,
  startAt,
  endAt,
}: {
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt: string;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Findmi//Event//EN",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@findmi.app`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${toIcsDate(startAt)}`,
    `DTEND:${toIcsDate(endAt)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    ...(location ? [`LOCATION:${escapeIcsText(location)}`] : []),
    ...(description ? [`DESCRIPTION:${escapeIcsText(description)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

export default function AddToCalendarButton({
  title,
  description,
  location,
  startAt,
  endAt,
  layout = "pill",
}: {
  title: string;
  description?: string | null;
  location?: string | null;
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
  const resolvedEnd = endAt ?? new Date(new Date(startAt).getTime() + 2 * 60 * 60 * 1000).toISOString();

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

  const gcalParams = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${toIcsDate(startAt)}/${toIcsDate(resolvedEnd)}`,
    ...(location ? { location } : {}),
    ...(description ? { details: description } : {}),
  });
  const gcalUrl = `https://calendar.google.com/calendar/render?${gcalParams.toString()}`;

  function openGoogleCalendar() {
    window.location.assign(gcalUrl);
    setOpen(false);
  }

  function downloadIcs() {
    const ics = buildIcs({ title, description, location, startAt, endAt: resolvedEnd });
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
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
        ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-white text-ink/70 transition hover:border-ink/30 hover:text-ink active:scale-95"
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
        title={layout === "icon" ? "Add to Calendar" : undefined}
        onClick={() => {
          if (!open && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            // Icon layout sits at the right edge of the Event action row —
            // keep its menu inside the viewport (other layouts unchanged).
            const left = layout === "icon" ? Math.max(8, Math.min(rect.left, window.innerWidth - 232)) : rect.left;
            setCoords({ top: rect.bottom + 6, left });
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
            className="fixed z-20 w-48 overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-lg"
            style={{ top: coords.top, left: coords.left }}
          >
            <button
              type="button"
              onClick={openGoogleCalendar}
              className="block w-full px-3.5 py-2.5 text-left text-sm text-ink hover:bg-black/[0.03]"
            >
              Google Calendar
            </button>
            <button
              type="button"
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
