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

export function buildIcs({
  title,
  description,
  location,
  url,
  startAt,
  endAt,
}: {
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
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
    ...(url ? [`URL:${url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

/** The canonical calendar payload for one dated thing — the exact instants
 * (UTC, so the calendar app shows them in the viewer's own zone without
 * any conversion here), the 2-hour fallback when there's no end, and the
 * public Findmi link appended to the description. Shared by the Google
 * link and the .ics file so both always describe the same occurrence. */
export function buildCalendarPayload({
  title,
  description,
  location,
  url,
  startAt,
  endAt,
}: {
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  startAt: string;
  endAt?: string | null;
}) {
  const resolvedEnd = endAt ?? new Date(new Date(startAt).getTime() + 2 * 60 * 60 * 1000).toISOString();
  const details = [description, url].filter(Boolean).join("\n\n") || null;
  const gcalParams = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${toIcsDate(startAt)}/${toIcsDate(resolvedEnd)}`,
    ...(location ? { location } : {}),
    ...(details ? { details } : {}),
  });
  return {
    gcalUrl: `https://calendar.google.com/calendar/render?${gcalParams.toString()}`,
    ics: buildIcs({ title, description: details, location, url, startAt, endAt: resolvedEnd }),
  };
}
