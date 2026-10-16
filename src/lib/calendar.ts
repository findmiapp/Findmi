// Add to Calendar — the pure payload builders behind AddToCalendarButton
// (kept framework-free so they can be tested directly).
//
// Event Detail V2 polish pass, item 9 — real event data only (title,
// start, end, venue/address, description), no paid third-party calendar
// service. Google Calendar opens a pre-filled web page (no auth/API key
// needed); .ics is generated client-side and downloaded directly, which
// covers Apple Calendar/Outlook/every other calendar app that reads the
// standard format.
export function toIcsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** "2026-10-16" → "20261016" (an iCalendar / Google all-day date). */
function toAllDay(date: string): string {
  return date.replace(/-/g, "");
}

/** The day after a calendar date (all-day ends are exclusive). */
function nextCalendarDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Event date/time precision — the time lines for one dated thing:
 *   timed        → DTSTART + DTEND (the real instants);
 *   start only   → DTSTART only (no Findmi-made end);
 *   date only    → an all-day entry (VALUE=DATE; end exclusive). */
export function icsTimeLines({ startAt, endAt, date, endDate }: { startAt: string | null; endAt?: string | null; date?: string | null; endDate?: string | null }): string[] {
  if (!startAt) {
    if (!date) return [];
    return [`DTSTART;VALUE=DATE:${toAllDay(date)}`, `DTEND;VALUE=DATE:${toAllDay(nextCalendarDay(endDate && endDate >= date ? endDate : date))}`];
  }
  return endAt ? [`DTSTART:${toIcsDate(startAt)}`, `DTEND:${toIcsDate(endAt)}`] : [`DTSTART:${toIcsDate(startAt)}`];
}

export function buildIcs({
  title,
  description,
  location,
  url,
  startAt,
  endAt,
  date,
  endDate,
}: {
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  startAt: string | null;
  endAt?: string | null;
  date?: string | null;
  endDate?: string | null;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Findmi//Event//EN",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@findmi.app`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    ...icsTimeLines({ startAt, endAt, date, endDate }),
    `SUMMARY:${escapeIcsText(title)}`,
    ...(location ? [`LOCATION:${escapeIcsText(location)}`] : []),
    ...(description ? [`DESCRIPTION:${escapeIcsText(description)}`] : []),
    ...(url ? [`URL:${url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

/** The canonical calendar payload for one dated thing — the exact instants
 * (UTC, so the calendar app shows them in the viewer's own zone without
 * any conversion here) and the public Findmi link appended to the
 * description. Shared by the Google link and the .ics file so both always
 * describe the same date. Event date/time precision: an unknown end is
 * never invented — a start-only date is a start with no end (Google: a
 * zero-length entry at the start), and a date with no published time is
 * an all-day entry. */
export function buildCalendarPayload({
  title,
  description,
  location,
  url,
  startAt,
  endAt,
  date,
  endDate,
}: {
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  startAt: string | null;
  endAt?: string | null;
  /** The calendar date (YYYY-MM-DD) — used when there is no start time. */
  date?: string | null;
  endDate?: string | null;
}) {
  const details = [description, url].filter(Boolean).join("\n\n") || null;
  const dates = startAt
    ? `${toIcsDate(startAt)}/${toIcsDate(endAt ?? startAt)}`
    : date
    ? `${toAllDay(date)}/${toAllDay(nextCalendarDay(endDate && endDate >= date ? endDate : date))}`
    : "";
  const gcalParams = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    ...(dates ? { dates } : {}),
    ...(location ? { location } : {}),
    ...(details ? { details } : {}),
  });
  return {
    gcalUrl: `https://calendar.google.com/calendar/render?${gcalParams.toString()}`,
    ics: buildIcs({ title, description: details, location, url, startAt, endAt, date, endDate }),
  };
}
