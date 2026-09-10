import type { LocationDayHours, LocationHours, LocationWeekday } from "@/lib/types";

/** Location V2 — the one shared weekday order/label list for hours of
 * operation, used by both the admin/owner editor (LocationHoursField) and
 * the public renderer below, so the two never drift. */
export const LOCATION_WEEKDAYS: { key: LocationWeekday; label: string; short: string }[] = [
  { key: "mon", label: "Monday", short: "Mon" },
  { key: "tue", label: "Tuesday", short: "Tue" },
  { key: "wed", label: "Wednesday", short: "Wed" },
  { key: "thu", label: "Thursday", short: "Thu" },
  { key: "fri", label: "Friday", short: "Fri" },
  { key: "sat", label: "Saturday", short: "Sat" },
  { key: "sun", label: "Sunday", short: "Sun" },
];

/** Whether `hours` has at least one real entry — the "hide the whole
 * section" gate the public page and Location Manager preview both use. A
 * null column or an empty object are treated identically. */
export function hasAnyHours(hours: LocationHours | null | undefined): boolean {
  return Boolean(hours && Object.keys(hours).length > 0);
}

export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, "0")}${period}`;
}

export function formatDayHours(day: LocationDayHours | undefined): string {
  if (!day || day.closed || !day.open || !day.close) return "Closed";
  return `${formatClock(day.open)} – ${formatClock(day.close)}`;
}

/** JS's own Date.getDay()/toLocaleDateString weekday index (0=Sun..6=Sat)
 * mapped onto our mon-first LocationWeekday keys. */
const JS_DAY_TO_KEY: LocationWeekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "Open now" / "Closed" — only computed when today's own entry has a
 * real open/close window, using the visitor's local wall-clock time
 * (Locations have no per-row timezone of their own, unlike event
 * occurrences — see lib/format.ts's APP_TIMEZONE note). Never guessed for
 * a day with no hours entered at all. */
export function isOpenNow(hours: LocationHours | null | undefined): boolean | null {
  if (!hasAnyHours(hours)) return null;
  const now = new Date();
  const today = hours![JS_DAY_TO_KEY[now.getDay()]];
  if (!today || today.closed || !today.open || !today.close) return false;
  const [openH, openM] = today.open.split(":").map(Number);
  const [closeH, closeM] = today.close.split(":").map(Number);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return minutesNow >= openH * 60 + openM && minutesNow < closeH * 60 + closeM;
}

/** Compact collapsed-accordion summary — "Open until 6PM" / "Closed now" —
 * only ever built from today's own real open/close window (isOpenNow's
 * same reliability rule), never a guess about tomorrow's hours or any
 * other day. Returns null when there's nothing reliable to say (no hours
 * entered at all), so the caller can fall back to just "Hours". */
export function getHoursSummaryLabel(hours: LocationHours | null | undefined): string | null {
  const open = isOpenNow(hours);
  if (open === null) return null;
  if (!open) return "Closed now";
  const today = hours![JS_DAY_TO_KEY[new Date().getDay()]];
  return today?.close ? `Open until ${formatClock(today.close)}` : "Open now";
}
