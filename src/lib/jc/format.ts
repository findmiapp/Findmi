// JC date labels — a thin presentation layer over Findmi's shared date/
// time domain (event-time.ts, format.ts). Every date uses its own stored
// timezone (zoneOf), time precision comes from timePrecision, and a date
// with no published time never gets one. JC only adds relative day words
// ("Today", "Tomorrow", weekday) and a compact time style ("4 PM").

import { formatTimeInZone } from "../format";
import { formatCalendarDate, formatWhenTime, isHappeningNow, timePrecision, todayIn, zoneOf, type DatedTimes } from "../event-time";

export interface JcDated {
  startAt: string | null;
  endAt: string | null;
  /** Real calendar date (YYYY-MM-DD) in the date's own timezone. */
  date: string;
  timezone: string | null;
}

function toDated(e: JcDated): DatedTimes {
  return { start_at: e.startAt, end_at: e.endAt, occurrence_date: e.date, timezone: e.timezone };
}

/** "4:00 PM" → "4 PM" — visual compaction only. */
function compact(time: string): string {
  return time.replace(/ /g, " ").replace(/:00(?= [AP]M)/g, "");
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Relative day word for a calendar date, judged in that date's zone. */
export function dayLabel(date: string, timezone: string | null, now = new Date()): string {
  const today = todayIn(zoneOf({ timezone }), now);
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  const diff = (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000;
  const short = formatCalendarDate(date, "short"); // "Sat, Oct 24"
  return diff > 0 && diff < 7 ? short.split(",")[0] : short.split(", ").slice(1).join(", ");
}

/** Section header for a day: "Today · Tuesday, October 20". */
export function longDayLabel(date: string, timezone: string | null, now = new Date()): string {
  const rel = dayLabel(date, timezone, now);
  const full = formatCalendarDate(date, "long");
  return rel === "Today" || rel === "Tomorrow" ? `${rel} · ${full.split(", ").slice(1).join(", ")}` : full;
}

/** Time part for a schedule row — "" when the date has no published time. */
export function rowTime(e: JcDated): string {
  return compact(formatWhenTime(toDated(e)));
}

export interface WhenLabel {
  text: string;
  live: boolean;
  soon: boolean;
}

export function whenLabel(e: JcDated, now = new Date()): WhenLabel {
  const tz = zoneOf({ timezone: e.timezone });
  if (isHappeningNow({ start_at: e.startAt, end_at: e.endAt }, now)) {
    return { text: e.endAt ? `Now · until ${compact(formatTimeInZone(e.endAt, tz))}` : "Now", live: true, soon: true };
  }
  const day = dayLabel(e.date, e.timezone, now);
  const timed = timePrecision({ start_at: e.startAt, end_at: e.endAt }) !== "date_only" && e.startAt;
  return { text: timed ? `${day} · ${compact(formatTimeInZone(e.startAt!, tz))}` : day, live: false, soon: day === "Today" };
}
