// Schedule Authoring V4, Pass 1 — pure, isomorphic (client- and server-
// safe) calendar-date helpers backing the Event Manager's bulk date
// generation composer. No recurrence RULE is ever stored — every mode
// (one day / date range / recurring weekdays) resolves to a concrete list
// of "YYYY-MM-DD" calendar dates up front, the same "generate real,
// independent rows, never a stored rule" philosophy admin's own
// EventOccurrencesEditor "repeat weekly" control already established.
//
// Day-increment math intentionally mirrors EventOccurrencesEditor's own
// addDaysToLocalDateTime: plain Y/M/D field arithmetic on a local `Date`
// object, never raw millisecond/24-hour-interval addition, so a range that
// crosses a DST transition still lands on the correct calendar dates.
// Wall-clock-to-UTC conversion (the part that actually has to be DST-aware)
// stays entirely in lib/admin/form-helpers.ts's existing localDateTimeToIso
// — this module never touches UTC/instant math at all.

/** Adds `days` (may be negative) to a "YYYY-MM-DD" date string via plain
 * calendar-field arithmetic — never millisecond math, so this is immune to
 * DST-length-of-day differences. */
export function addDaysToDateOnly(dateStr: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const [, y, m, d] = match;
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  dt.setDate(dt.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** 0=Sun..6=Sat for a "YYYY-MM-DD" date string, computed from its own
 * calendar fields only (never affected by the runtime's own timezone,
 * since no time-of-day/instant is involved). */
export function weekdayIndexOf(dateStr: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return 0;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d)).getDay();
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Every calendar date from `startDate` to `endDate`, inclusive, optionally
 * filtered to only the given weekday indices (0=Sun..6=Sat). Returns []
 * for an invalid/reversed range. `guard` bounds the loop defensively — the
 * real ceiling enforcement (MAX_BULK_GENERATED_DATES) happens at the call
 * site, this is just a hard stop against a malformed input looping
 * forever. */
export function enumerateCalendarDates(startDate: string, endDate: string, weekdays?: number[]): string[] {
  if (!startDate || !endDate || endDate < startDate) return [];
  const allow = weekdays && weekdays.length > 0 ? new Set(weekdays) : null;
  const dates: string[] = [];
  let cursor = startDate;
  let guard = 0;
  while (cursor <= endDate && guard < 400) {
    if (!allow || allow.has(weekdayIndexOf(cursor))) dates.push(cursor);
    cursor = addDaysToDateOnly(cursor, 1);
    guard++;
  }
  return dates;
}

/** Cross-Midnight Fix — a closing time at or before the opening time on the
 * same nominal calendar date means the session actually ends on the NEXT
 * calendar date (e.g. start 11:30 AM, end 12:00 AM -> ends the following
 * day), never a validation failure and never silently clamped to the same
 * day. `startTime`/`endTime` are plain "HH:MM" (24-hour) values, the exact
 * format a native <input type="time"> posts, so lexical comparison is
 * already chronological. Equal start/end is rejected by the caller (an
 * explicit, ambiguous zero-duration case) — this function only resolves
 * which calendar date the end time belongs to. */
export function resolveEndDateForTimes(startDate: string, startTime: string, endTime: string): string {
  return endTime <= startTime ? addDaysToDateOnly(startDate, 1) : startDate;
}

/** Whether an end time crosses into the next calendar date relative to the
 * given start time — purely for UI hinting (e.g. "ends next day"), not
 * used for the actual date resolution above (resolveEndDateForTimes is the
 * single source of truth for that). */
export function crossesMidnight(startTime: string, endTime: string): boolean {
  return endTime <= startTime;
}

// Generation Limits — the audit's own recommendation: no arbitrary product
// ceiling far below what a legitimate long-running activation needs, but a
// genuine safety ceiling so one bulk action can never runs away. 1-31 is
// the common case (a festival/week/month) and needs no extra confirmation;
// 32-90 asks the organizer to confirm the count; 91+ asks more emphatically.
// 366 is a hard stop (covers a full daily year, the longest legitimate
// single-Event activation this pass anticipates) — never silently
// truncated, the generator simply refuses to produce more than this in one
// operation.
export const BULK_GENERATION_CONFIRM_THRESHOLD = 32;
export const BULK_GENERATION_STRONG_CONFIRM_THRESHOLD = 91;
export const MAX_BULK_GENERATED_DATES = 366;
