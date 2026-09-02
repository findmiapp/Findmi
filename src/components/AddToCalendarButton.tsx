"use client";

import { useRef, useState } from "react";

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
    "PRODID:-//FindMi//Event//EN",
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
}: {
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  /** Falls back to a 2-hour block when the event has no real end time —
   * calendar apps require SOME end, so this is the least presumptuous
   * default rather than fabricating a specific one. */
  endAt?: string | null;
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
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const resolvedEnd = endAt ?? new Date(new Date(startAt).getTime() + 2 * 60 * 60 * 1000).toISOString();

  const gcalParams = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${toIcsDate(startAt)}/${toIcsDate(resolvedEnd)}`,
    ...(location ? { location } : {}),
    ...(description ? { details: description } : {}),
  });
  const gcalUrl = `https://calendar.google.com/calendar/render?${gcalParams.toString()}`;

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

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!open && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setCoords({ top: rect.bottom + 6, left: rect.left });
          }
          setOpen((o) => !o);
        }}
        className="flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
      >
        <CalendarPlusGlyph className="h-3.5 w-3.5" />
        Add to Calendar
      </button>
      {open && coords && (
        <div
          className="fixed z-20 w-48 overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-lg"
          style={{ top: coords.top, left: coords.left }}
        >
          <a
            href={gcalUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="block px-3.5 py-2.5 text-left text-sm text-ink hover:bg-black/[0.03]"
          >
            Google Calendar
          </a>
          <button
            type="button"
            onClick={downloadIcs}
            className="block w-full px-3.5 py-2.5 text-left text-sm text-ink hover:bg-black/[0.03]"
          >
            Apple / Outlook (.ics)
          </button>
        </div>
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
