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

const HHMM_VALUE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** One day's USABLE state: explicitly closed, Open 24 Hours, or a real
 * open/close window. Anything else (missing, {}, times missing or
 * malformed) is NOT SET — never "Closed". */
export function dayHoursState(day: unknown): "closed" | "allDay" | "hours" | "unset" {
  if (!day || typeof day !== "object" || Array.isArray(day)) return "unset";
  const d = day as Record<string, unknown>;
  if (d.closed === true) return "closed";
  if (d.allDay === true) return "allDay";
  return typeof d.open === "string" && typeof d.close === "string" && HHMM_VALUE.test(d.open) && HHMM_VALUE.test(d.close) ? "hours" : "unset";
}

/** Whether `hours` holds at least one USABLE day — the "hide the whole
 * section" gate the public page and Location Manager both use. null,
 * undefined, {}, [], a non-object, or days without usable values are all
 * "Hours Not Set": never Open, never Closed. */
export function hasAnyHours(hours: LocationHours | null | undefined): boolean {
  if (!hours || typeof hours !== "object" || Array.isArray(hours)) return false;
  return LOCATION_WEEKDAYS.some(({ key }) => dayHoursState((hours as Record<string, unknown>)[key]) !== "unset");
}

/** Admin / editing label for a Location with no usable hours. */
export const HOURS_NOT_SET = "Hours Not Set";

/** Location Hours UX — a day explicitly marked "Open 24 Hours". Only the
 * explicit flag counts: a stored 12:00 AM – 11:59 PM window is NOT
 * reinterpreted (it stays exactly what was entered). */
export function isAllDay(day: LocationDayHours | undefined): boolean {
  return Boolean(day && !day.closed && day.allDay === true);
}

/** Every one of the seven days is Open 24 Hours. */
export function isOpen247(hours: LocationHours | null | undefined): boolean {
  return Boolean(hours) && LOCATION_WEEKDAYS.every(({ key }) => isAllDay(hours![key]));
}

/** A day entered as 12:00 AM – 11:59 PM (the only way to say "all day"
 * before the explicit option existed). Used only to OFFER the switch to
 * Open 24 Hours in the editor — never applied automatically. */
export function looksLikeAllDay(day: LocationDayHours | undefined): boolean {
  return Boolean(day && !day.closed && !day.allDay && day.open === "00:00" && (day.close === "23:59" || day.close === "24:00"));
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Server-side clean-up of the editor's whole-week JSON: known weekdays
 * only, booleans as booleans, "HH:MM" times only. An Open 24 Hours day
 * needs no times; an ordinary open day needs both. Empty → null (hide the
 * Hours section), exactly as before. */
export function normalizeLocationHours(raw: unknown): LocationHours | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: LocationHours = {};
  for (const { key } of LOCATION_WEEKDAYS) {
    const d = (raw as Record<string, unknown>)[key];
    if (!d || typeof d !== "object") continue;
    const day = d as Record<string, unknown>;
    const open = typeof day.open === "string" && HHMM.test(day.open) ? day.open : null;
    const close = typeof day.close === "string" && HHMM.test(day.close) ? day.close : null;
    if (day.closed === true) out[key] = { closed: true };
    else if (day.allDay === true) out[key] = { closed: false, allDay: true, ...(open && close ? { open, close } : {}) };
    else if (open && close) out[key] = { closed: false, open, close };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Copy one day's complete state (open/closed, 24 hours, times) onto the
 * selected days only. Each target gets its own copy, so editing a target
 * later never changes the source. */
export function copyDayHours(hours: LocationHours, source: LocationWeekday, targets: LocationWeekday[]): LocationHours {
  const from = hours[source];
  const next: LocationHours = { ...hours };
  for (const t of targets) {
    if (t === source) continue;
    if (from) next[t] = { ...from };
    else delete next[t];
  }
  return next;
}

/** "Open 24/7" convenience: every day becomes Open 24 Hours (each day can
 * still be edited afterwards — it is the same per-day model). */
export function setAllDaysOpen24(hours: LocationHours): LocationHours {
  const next: LocationHours = {};
  for (const { key } of LOCATION_WEEKDAYS) {
    const prev = hours[key];
    next[key] = { closed: false, allDay: true, ...(prev?.open && prev?.close ? { open: prev.open, close: prev.close } : {}) };
  }
  return next;
}

/** "9:00 AM" / "5:30 PM" / "12:00 PM" — always includes minutes and a
 * space before AM/PM, per the Live QA correction pass (was previously
 * "9AM"/"5:30PM", dropping :00 and the space). Never rounds or otherwise
 * alters the stored h:mm value — purely a display format. */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Field QA UX Pass 2B — compact public form for the Location status
 * pill / weekly Hours: drops ":00" only ("7 AM", "4 PM") and keeps real
 * minutes ("7:30 AM", "4:15 PM"). Display only, stored values untouched. */
export function formatClockCompact(hhmm: string): string {
  const full = formatClock(hhmm);
  return full.replace(/:00 (AM|PM)$/, " $1");
}

/** "7 AM – 4 PM" / "Closed" — compact companion to formatDayHours.
 * "Closed" only for a day explicitly marked closed; a day with no usable
 * entry is "Hours Not Set" (public lists leave such days out). */
export function formatDayHoursCompact(day: LocationDayHours | undefined): string {
  const state = dayHoursState(day);
  if (state === "allDay") return "Open 24 Hours";
  if (state === "closed") return "Closed";
  if (state === "unset") return HOURS_NOT_SET;
  return `${formatClockCompact(day!.open!)} – ${formatClockCompact(day!.close!)}`;
}

export function formatDayHours(day: LocationDayHours | undefined): string {
  const state = dayHoursState(day);
  if (state === "allDay") return "Open 24 Hours";
  if (state === "closed") return "Closed";
  if (state === "unset") return HOURS_NOT_SET;
  if (!day?.open || !day.close) return HOURS_NOT_SET;
  // Standard hyphen with surrounding spaces (not an en dash) — the exact
  // public presentation standard: "9:00 AM - 6:00 PM".
  return `${formatClock(day.open)} - ${formatClock(day.close)}`;
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
  return isOpenNowAt(hours, new Date());
}

/** Compact collapsed-accordion summary — "Open Until 6:00 PM" / "Closed
 * now" — only ever built from today's own real open/close window
 * (isOpenNow's same reliability rule), never a guess about tomorrow's
 * hours or any other day. Returns null when there's nothing reliable to
 * say (no hours entered at all), so the caller can fall back to just
 * "Hours". */
export function getHoursSummaryLabel(hours: LocationHours | null | undefined): string | null {
  const open = isOpenNow(hours);
  if (open === null) return null;
  if (!open) return "Closed now";
  const today = hours![JS_DAY_TO_KEY[new Date().getDay()]];
  if (isAllDay(today)) return isOpen247(hours) ? "Open 24/7" : "Open 24 Hours";
  return today?.close ? `Open Until ${formatClock(today.close)}` : "Open now";
}

/** Field QA UX Pass 2 — the weekday key for a given moment, in the
 * visitor's local wall-clock time (same convention as isOpenNow). */
export function weekdayKeyFor(date: Date): LocationWeekday {
  return JS_DAY_TO_KEY[date.getDay()];
}

/** Field QA UX Pass 2 — status pill copy, built only from what the stored
 * hours say for sure (same open/closed rule as isOpenNow — no overnight or
 * holiday guessing):
 *   open now            → "Open Now" + "Until 4 PM"
 *   closed, opens later → "Closed" + "Opens 7 AM"
 *   closed for today    → "Closed" + "Opens 7 AM Tomorrow" (only when
 *                         tomorrow has real hours), else no detail.
 * Returns null when there are no hours at all. */
export function getHoursStatus(hours: LocationHours | null | undefined, now: Date = new Date()): { open: boolean; detail: string | null } | null {
  const open = isOpenNowAt(hours, now);
  if (open === null) return null;
  const today = hours![weekdayKeyFor(now)];
  const valid = (d: LocationDayHours | undefined): d is LocationDayHours & { open: string; close: string } => Boolean(d && !d.closed && !d.allDay && d.open && d.close);
  if (open && isAllDay(today)) return { open: true, detail: isOpen247(hours) ? "Open 24/7" : "Open 24 Hours" };
  if (open) return { open: true, detail: valid(today) && today.close > today.open ? `Until ${formatClockCompact(today.close)}` : null };
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  if (valid(today)) {
    const [h, m] = today.open.split(":").map(Number);
    if (minutesNow < h * 60 + m) return { open: false, detail: `Opens ${formatClockCompact(today.open)}` };
  }
  const tomorrow = hours![weekdayKeyFor(new Date(now.getTime() + 24 * 60 * 60 * 1000))];
  if (isAllDay(tomorrow)) return { open: false, detail: "Opens 12 AM Tomorrow" };
  return { open: false, detail: valid(tomorrow) ? `Opens ${formatClockCompact(tomorrow.open)} Tomorrow` : null };
}

/** true = Open, false = Closed, null = UNKNOWN (no usable hours at all, or
 * none set for today) — unknown is never reported as Closed. */
function isOpenNowAt(hours: LocationHours | null | undefined, now: Date): boolean | null {
  if (!hasAnyHours(hours)) return null;
  const today = hours![weekdayKeyFor(now)];
  const state = dayHoursState(today);
  // Open 24 Hours: open at every minute of that day, midnight included.
  if (state === "allDay") return true;
  if (state === "closed") return false;
  if (state === "unset" || !today?.open || !today.close) return null;
  const [openH, openM] = today.open.split(":").map(Number);
  const [closeH, closeM] = today.close.split(":").map(Number);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return minutesNow >= openH * 60 + openM && minutesNow < closeH * 60 + closeM;
}
