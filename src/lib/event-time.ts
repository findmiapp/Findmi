/** Event date/time precision — ONE definition of the three truthful states
 * an Event date (event_occurrences) or a parent Event (events) can be in:
 *
 *   "timed"      date + start + end      → "Fri, Oct 16 · 11:00 AM – 7:00 PM"
 *   "start_only" date + start, no end    → "Fri, Oct 16 · 11:00 AM"
 *   "date_only"  date, no published time → "Friday, October 16"
 *
 * The calendar DATE is always real, required data (occurrence_date /
 * start_date). Time is optional precision on it. Nothing here ever invents
 * a time: "end of day" is only ever computed for a comparison, never
 * stored or shown. Pure — no server or client imports beyond format. */

import { APP_TIMEZONE, dateKeyInZone, formatAppearanceDateRange, formatDateShortInZone, formatTimeInZone, getTemporalLabel } from "./format";

export type TimePrecision = "timed" | "start_only" | "date_only";

/** Anything with optional times and a calendar date: an occurrence
 * (occurrence_date + its own timezone) or a parent Event (start_date). */
export interface DatedTimes {
  start_at: string | null;
  end_at: string | null;
  occurrence_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  timezone?: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const TIME_NOT_LISTED = "Time Not Listed";

export function timePrecision(r: Pick<DatedTimes, "start_at" | "end_at">): TimePrecision {
  if (!r.start_at) return "date_only";
  return r.end_at ? "timed" : "start_only";
}

export function zoneOf(r: Pick<DatedTimes, "timezone">): string {
  return r.timezone || APP_TIMEZONE;
}

/** The real calendar date (YYYY-MM-DD). Prefers the stored date; falls back
 * to the known start's local date (rows read before the migration). */
export function calendarDate(r: DatedTimes): string | null {
  const stored = r.occurrence_date ?? r.start_date ?? null;
  if (stored && DATE.test(stored)) return stored;
  return r.start_at ? dateKeyInZone(new Date(r.start_at), zoneOf(r)) : null;
}

/** The calendar end date: a known end's local date, else the stored end
 * date, else the start date (a single-date Event). */
export function calendarEndDate(r: DatedTimes): string | null {
  if (r.end_at) return dateKeyInZone(new Date(r.end_at), zoneOf(r));
  if (r.end_date && DATE.test(r.end_date)) return r.end_date;
  return calendarDate(r);
}

/** Today's calendar date in a timezone. */
export function todayIn(timezone: string = APP_TIMEZONE, now: Date = new Date()): string {
  return dateKeyInZone(now, timezone);
}

// ── formatting ─────────────────────────────────────────────────────────

/** A bare calendar date, formatted without any time and without a timezone
 * shift ("2026-10-16" is Oct 16 everywhere). */
export function formatCalendarDate(date: string, style: "long" | "short" = "long"): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-US", style === "long" ? { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" } : { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** Month abbreviation / day number for a date tile, from a calendar date. */
export function calendarMonthAbbrev(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" });
}
export function calendarDayOfMonth(date: string): string {
  return String(Number(date.slice(8, 10)));
}

/** Time only: "11:00 AM – 7:00 PM" / "11:00 AM" / "" (public, date only)
 * or "Time Not Listed" (Admin / Review). A multi-day timed span shows its
 * date range, same as the existing formatters. */
export function formatWhenTime(r: DatedTimes, opts: { admin?: boolean } = {}): string {
  const tz = zoneOf(r);
  if (!r.start_at) return opts.admin ? TIME_NOT_LISTED : "";
  const start = formatTimeInZone(r.start_at, tz);
  if (!r.end_at) return start;
  const sameDay = dateKeyInZone(new Date(r.start_at), tz) === dateKeyInZone(new Date(r.end_at), tz);
  if (sameDay) return `${start} – ${formatTimeInZone(r.end_at, tz)}`;
  return `${formatDateShortInZone(r.start_at, tz)} – ${formatDateShortInZone(r.end_at, tz)}`;
}

/** Date + time line: "Fri, Oct 16 · 11:00 AM – 7:00 PM", "Fri, Oct 16 ·
 * 11:00 AM", "Friday, October 16" (public) or "Fri, Oct 16 · Time Not
 * Listed" (Admin). Never implies a time the record doesn't have. */
export function formatWhen(r: DatedTimes, opts: { admin?: boolean } = {}): string {
  const date = calendarDate(r);
  if (!r.start_at) {
    if (!date) return opts.admin ? TIME_NOT_LISTED : "";
    return opts.admin ? `${formatCalendarDate(date, "short")} · ${TIME_NOT_LISTED}` : formatCalendarDate(date, "long");
  }
  const tz = zoneOf(r);
  const startDate = formatDateShortInZone(r.start_at, tz);
  const start = formatTimeInZone(r.start_at, tz);
  if (!r.end_at) return `${startDate} · ${start}`;
  const sameDay = dateKeyInZone(new Date(r.start_at), tz) === dateKeyInZone(new Date(r.end_at), tz);
  if (sameDay) return `${startDate} · ${start} – ${formatTimeInZone(r.end_at, tz)}`;
  return `${startDate} – ${formatDateShortInZone(r.end_at, tz)}`;
}

/** A parent Event's calendar range: "Fri, Oct 16 · 11:00 AM – 7:00 PM"
 * when timed; "Oct 16 – Oct 18" (dates only) when its times aren't all
 * known. */
export function formatEventRange(e: DatedTimes, opts: { admin?: boolean } = {}): string {
  const start = calendarDate(e);
  const end = calendarEndDate(e);
  if (e.start_at && (e.end_at || !end || end === start)) return formatWhen(e, opts);
  if (!start) return "";
  if (!end || end === start) return formatWhen({ ...e, start_at: null, end_at: null }, opts);
  return `${formatCalendarDate(start, "short")} – ${formatCalendarDate(end, "short")}`;
}

// ── status / discovery ─────────────────────────────────────────────────

/** Happening Now — only when a REAL interval contains `now`: both start and
 * end known. A date-only or start-only date is never "now" (an unknown end
 * can't establish that it's still going). */
export function isHappeningNow(r: Pick<DatedTimes, "start_at" | "end_at">, now: Date = new Date()): boolean {
  if (!r.start_at || !r.end_at) return false;
  const t = now.getTime();
  return Date.parse(r.start_at) <= t && t < Date.parse(r.end_at);
}

/** Over: a timed date once its real end passes; a date with no known end
 * once its calendar date has passed (it stays Upcoming through its date). */
export function hasEnded(r: DatedTimes, now: Date = new Date()): boolean {
  if (r.end_at) return Date.parse(r.end_at) <= now.getTime();
  const date = calendarEndDate(r);
  return date ? date < todayIn(zoneOf(r), now) : false;
}

/** On a calendar day (YYYY-MM-DD): a timed date overlapping that local day,
 * or a date with no known end whose calendar date is that day. */
export function occursOnDate(r: DatedTimes, day: string): boolean {
  return occursWithinDates(r, day, day);
}

/** Within an inclusive calendar range [from, to]. */
export function occursWithinDates(r: DatedTimes, from: string, to: string): boolean {
  const start = calendarDate(r);
  if (!start) return false;
  // A timed end exactly at local midnight belongs to the previous day.
  const end = r.end_at ? dateKeyInZone(new Date(Date.parse(r.end_at) - 1), zoneOf(r)) : (calendarEndDate(r) ?? start);
  return start <= to && end >= from;
}

/** Deterministic chronological order without fake times: calendar date,
 * then known start (timed / start-only before date-only on the same date),
 * then id. */
export function compareChronological(a: DatedTimes & { id?: string }, b: DatedTimes & { id?: string }): number {
  const da = calendarDate(a) ?? "";
  const db = calendarDate(b) ?? "";
  if (da !== db) return da < db ? -1 : 1;
  if (a.start_at && b.start_at && a.start_at !== b.start_at) return Date.parse(a.start_at) - Date.parse(b.start_at);
  if (a.start_at && !b.start_at) return -1;
  if (!a.start_at && b.start_at) return 1;
  return (a.id ?? "").localeCompare(b.id ?? "");
}

// ── PostgREST filters (event_occurrences) ──────────────────────────────

/** `.or(...)` filter: occurrences in an instant window [startIso, endIso)
 * whose local calendar dates are [fromDate, toDate]. Timed rows keep the
 * existing overlap rule; rows with no known end match by occurrence_date. */
export function occurrenceWindowOr(startIso: string, endIso: string, fromDate: string, toDate: string, prefix = ""): string {
  return `and(${prefix}start_at.lt.${endIso},${prefix}end_at.gt.${startIso}),and(${prefix}end_at.is.null,${prefix}occurrence_date.gte.${fromDate},${prefix}occurrence_date.lte.${toDate})`;
}

/** `.or(...)` filter: not over yet — a timed row until its end, a row with
 * no known end through its calendar date. */
export function occurrenceUpcomingOr(nowIso: string, today: string, prefix = ""): string {
  return `${prefix}end_at.gte.${nowIso},and(${prefix}end_at.is.null,${prefix}occurrence_date.gte.${today})`;
}

/** `.or(...)` filter: already over (the complement of occurrenceUpcomingOr). */
export function occurrencePastOr(nowIso: string, today: string, prefix = ""): string {
  return `${prefix}end_at.lt.${nowIso},and(${prefix}end_at.is.null,${prefix}occurrence_date.lt.${today})`;
}

// ── calendar export ────────────────────────────────────────────────────

/** iCalendar DTSTART/DTEND lines: all-day for a date-only date; DTSTART
 * only for a start-only date (no Findmi-made end); both when timed. */
export function icsTimeLines(r: DatedTimes): string[] {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  if (!r.start_at) {
    const date = calendarDate(r);
    if (!date) return [];
    const end = calendarEndDate(r) ?? date;
    const next = new Date(`${end}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return [`DTSTART;VALUE=DATE:${date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`];
  }
  return r.end_at ? [`DTSTART:${stamp(r.start_at)}`, `DTEND:${stamp(r.end_at)}`] : [`DTSTART:${stamp(r.start_at)}`];
}

/** An instant window → its inclusive local calendar dates (app timezone);
 * a window ending exactly at midnight doesn't include the next day. */
export function windowDates(bounds: { start: Date; end: Date }, timezone: string = APP_TIMEZONE): { from: string; to: string } {
  return { from: dateKeyInZone(bounds.start, timezone), to: dateKeyInZone(new Date(bounds.end.getTime() - 1), timezone) };
}

// ── PostgREST filters (events — the parent's own range) ─────────────────

/** `.or(...)` filter for a parent Event in a window: timed (start + end)
 * by overlap, as before; otherwise by its calendar range
 * [start_date, end_date ?? start_date]. */
export function eventWindowOr(startIso: string, endIso: string, fromDate: string, toDate: string): string {
  return `and(start_at.lt.${endIso},end_at.gt.${startIso}),and(end_at.is.null,start_date.lte.${toDate},or(end_date.gte.${fromDate},and(end_date.is.null,start_date.gte.${fromDate})))`;
}

/** `.or(...)` filter: a parent Event that isn't over — timed until its
 * end; otherwise through its calendar end date. */
export function eventUpcomingOr(nowIso: string, today: string): string {
  return `end_at.gt.${nowIso},and(end_at.is.null,or(end_date.gte.${today},and(end_date.is.null,start_date.gte.${today})))`;
}

/** The "when" label (HERE NOW / TODAY / TOMORROW / SAT · OCT 17 / OCT 24)
 * for any date state. HERE NOW only for a real interval containing now; a
 * date with no published start is labelled by its calendar date alone. */
export function temporalLabelFor(r: DatedTimes, now: Date = new Date()): { label: string; live: boolean } {
  if (r.start_at) return getTemporalLabel(r.start_at, r.end_at);
  const date = calendarDate(r);
  if (!date) return { label: "", live: false };
  const today = todayIn(APP_TIMEZONE, now);
  if (date === today) return { label: "TODAY", live: false };
  const tomorrow = todayIn(APP_TIMEZONE, new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (date === tomorrow) return { label: "TOMORROW", live: false };
  const d = new Date(`${date}T12:00:00Z`);
  const monthDay = d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).toUpperCase();
  const daysOut = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (daysOut >= 0 && daysOut <= 6) return { label: `${d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" }).toUpperCase()} · ${monthDay}`, live: false };
  return { label: monthDay, live: false };
}

// ── Location "happening" items (an Event date or an Appearance) ─────────

type HappeningLike = { start_at: string | null; end_at: string | null; date: string; timezone?: string | null };

/** HERE NOW / TODAY / … label for a happening item, never live without a
 * real interval. */
export function happeningTemporal(item: HappeningLike): { label: string; live: boolean } {
  return temporalLabelFor({ start_at: item.start_at, end_at: item.end_at, occurrence_date: item.date, timezone: item.timezone ?? null });
}

/** The item's date line: the existing Appearance-aware format when it has a
 * start, else just its real calendar date (no time is implied). */
export function happeningDateLine(item: HappeningLike, description: string | null): string {
  return item.start_at ? formatAppearanceDateRange(item.start_at, item.end_at, description) : formatCalendarDate(item.date, "long");
}

/** A date tile's month / day for a happening item, from its calendar date. */
export function happeningMonth(item: HappeningLike): string {
  return calendarMonthAbbrev(item.date);
}
export function happeningDay(item: HappeningLike): string {
  return calendarDayOfMonth(item.date);
}

// ── compact card lines (parent Events after their nearest date's override) ──

/** "Fri, Oct 16 · 11:00 AM" (a known start) or "Fri, Oct 16" (no
 * published time) — a compact card's start line, never implying an end. */
export function formatStartLine(r: DatedTimes): string {
  if (r.start_at) return `${formatDateShortInZone(r.start_at, zoneOf(r))} · ${formatTimeInZone(r.start_at, zoneOf(r))}`;
  const date = calendarDate(r);
  return date ? formatCalendarDate(date, "short") : "";
}

/** Card date range: the existing compact format when a start is known;
 * otherwise the calendar dates alone ("Oct 16" / "Oct 16–18"). */
export function formatCardWhen(r: DatedTimes, timed: (startIso: string, endIso: string | null) => string): string {
  if (r.start_at) return timed(r.start_at, r.end_at);
  const start = calendarDate(r);
  if (!start) return "";
  const end = calendarEndDate(r) ?? start;
  const md = (d: string) => `${calendarMonthAbbrev(d)} ${calendarDayOfMonth(d)}`;
  if (end === start) return md(start);
  return calendarMonthAbbrev(start) === calendarMonthAbbrev(end) ? `${md(start)}–${calendarDayOfMonth(end)}` : `${md(start)} – ${md(end)}`;
}
