// Discovery Engine V1 — time is first-class. One pure definition of every
// WHEN a Discovery Query can express, evaluated against REAL occurrence
// state in the occurrence's OWN timezone (event_occurrences.timezone; the
// app zone only when a row has none). Nothing here reads the clock:
// `now` is always passed in.
//
//   Happening Now  starts_at <= now < ends_at (both real; never guessed)
//   Up Next        not started yet, starts within UP_NEXT_HOURS
//   Today/Tomorrow/This Week/This Weekend/Next Week/This Month/Next Month,
//   a date, a date range, a month, a year — calendar days in the
//   occurrence's own zone
//   Time of day    a local band on each qualifying day; an occurrence with
//                  no published start never matches a time of day
//
// An occurrence stops qualifying the moment it ends; nothing is deleted —
// history and live eligibility are separate.

import { APP_TIMEZONE } from "../format";
import { hasEnded, isHappeningNow, occursWithinDates, todayIn, zoneOf, type DatedTimes } from "../event-time";
import type { DiscoveryQuery, DiscoveryWhen, TimeOfDay } from "./query";

export const UP_NEXT_HOURS = 4;

/** Local minutes since midnight [start, end); end > 1440 runs past
 * midnight into the next day. */
export const TIME_OF_DAY_BANDS: Record<TimeOfDay, [number, number]> = {
  morning: [5 * 60, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 21 * 60],
  late_night: [21 * 60, 28 * 60],
};
const TONIGHT_BAND: [number, number] = [17 * 60, 24 * 60];

export const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekday = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
};
const lastDayOfMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const nextMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** UTC offset (ms) of `tz` at instant `ms`. */
function offsetAt(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - Math.floor(ms / 1000) * 1000;
}

/** The instant of local wall time `date` + `minutes` in `tz` (DST-safe;
 * minutes may exceed 1440). */
export function zonedInstant(date: string, minutes: number, tz: string = APP_TIMEZONE): number {
  const day = addDays(date, Math.floor(minutes / 1440));
  const m = ((minutes % 1440) + 1440) % 1440;
  const [y, mo, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, Math.floor(m / 60), m % 60);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz);
  return second;
}

export type TimeWindow =
  | { kind: "live" }
  | { kind: "upnext" }
  | { kind: "upcoming"; band?: [number, number] }
  | { kind: "dates"; from: string; to: string; band?: [number, number] };

/** Calendar days for a named window, in `tz` (Findmi's locked definitions:
 * This Week runs through Sunday; This Weekend is Fri–Sun and never reaches
 * back into a Friday already past; Next Week is the following Mon–Sun). */
export function namedWindowDates(when: DiscoveryWhen, now: Date, tz: string = APP_TIMEZONE): { from: string; to: string } | null {
  const today = todayIn(tz, now);
  const dow = weekday(today);
  switch (when) {
    case "today":
    case "tonight":
    case "now":
    case "upnext":
      return { from: today, to: today };
    case "tomorrow":
      return { from: addDays(today, 1), to: addDays(today, 1) };
    case "week":
      return { from: today, to: addDays(today, (7 - dow) % 7) };
    case "weekend": {
      const already = dow === 5 || dow === 6 || dow === 0;
      const fri = already ? 0 : (5 - dow + 7) % 7;
      const sun = already ? (dow === 6 ? 1 : dow === 5 ? 2 : 0) : fri + 2;
      return { from: addDays(today, fri), to: addDays(today, sun) };
    }
    case "next_week": {
      const mon = addDays(today, ((8 - dow) % 7) || 7);
      return { from: mon, to: addDays(mon, 6) };
    }
    case "month":
      return { from: today, to: lastDayOfMonth(today.slice(0, 7)) };
    case "next_month": {
      const m = nextMonth(today.slice(0, 7));
      return { from: `${m}-01`, to: lastDayOfMonth(m) };
    }
    default:
      return null;
  }
}

/** The custom or named time-of-day band, if any. */
export function bandFor(q: Pick<DiscoveryQuery, "tod" | "tfrom" | "tto">): [number, number] | undefined {
  if (q.tfrom || q.tto) {
    const mins = (c: string) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3, 5));
    const start = q.tfrom ? mins(q.tfrom) : 0;
    let end = q.tto ? mins(q.tto) : 24 * 60;
    if (end <= start) end += 24 * 60;
    return [start, end];
  }
  return q.tod ? TIME_OF_DAY_BANDS[q.tod] : undefined;
}

const MAX_RANGE_DAYS = 400;

/** The query's time window in `tz`. Precedence: date > from/to > month >
 * year > when; none → upcoming (anything not over). */
export function windowFor(q: DiscoveryQuery, now: Date, tz: string = APP_TIMEZONE): TimeWindow {
  const band = bandFor(q);
  const today = todayIn(tz, now);
  if (q.date) return { kind: "dates", from: q.date, to: q.date, band };
  if (q.from || q.to) {
    const from = q.from ?? today;
    let to = q.to ?? addDays(from, 30);
    if (to < from) to = from;
    if (to > addDays(from, MAX_RANGE_DAYS)) to = addDays(from, MAX_RANGE_DAYS);
    return { kind: "dates", from, to, band };
  }
  if (q.month) return { kind: "dates", from: `${q.month}-01`, to: lastDayOfMonth(q.month), band };
  if (q.year) return { kind: "dates", from: `${q.year}-01-01`, to: `${q.year}-12-31`, band };
  if (q.when === "now") return { kind: "live" };
  if (q.when === "upnext") return { kind: "upnext" };
  if (q.when && q.when !== "upcoming") {
    const d = namedWindowDates(q.when, now, tz)!;
    return { kind: "dates", ...d, band: band ?? (q.when === "tonight" ? TONIGHT_BAND : undefined) };
  }
  return { kind: "upcoming", band };
}

/** Does the item's real interval overlap the local band on any day in
 * [from, to]? An item with no published start can't. */
export function overlapsBand(item: DatedTimes, from: string, to: string, band: [number, number], tz: string): boolean {
  if (!item.start_at) return false;
  const start = Date.parse(item.start_at);
  const end = item.end_at ? Date.parse(item.end_at) : start + 60_000;
  let d = from;
  for (let i = 0; i <= 62 && d <= to; i++, d = addDays(d, 1)) {
    if (start < zonedInstant(d, band[1], tz) && end > zonedInstant(d, band[0], tz)) return true;
  }
  return false;
}

/** The single temporal predicate every discovery surface uses for a dated
 * item (occurrence, Appearance). */
export function matchesTime(item: DatedTimes, q: DiscoveryQuery, now: Date): boolean {
  if (hasEnded(item, now)) return false;
  const tz = zoneOf(item);
  const w = windowFor(q, now, tz);
  switch (w.kind) {
    case "live":
      return isHappeningNow(item, now);
    case "upnext": {
      if (!item.start_at) return false;
      const s = Date.parse(item.start_at);
      return s > now.getTime() && s <= now.getTime() + UP_NEXT_HOURS * 3_600_000;
    }
    case "upcoming": {
      if (!w.band) return true;
      // Each of the item's own remaining days, from today.
      const today = todayIn(tz, now);
      const startDay = item.start_at ? todayIn(tz, new Date(item.start_at)) : today;
      const endDay = item.end_at ? todayIn(tz, new Date(Date.parse(item.end_at) - 1)) : startDay;
      return overlapsBand(item, startDay > today ? startDay : today, endDay < startDay ? startDay : endDay, w.band, tz);
    }
    case "dates":
      if (w.band) return overlapsBand(item, w.from, w.to, w.band, tz);
      return occursWithinDates(item, w.from, w.to);
  }
}

/** Instant bounds a server can pre-filter rows with before the exact,
 * per-timezone predicate runs: padded by a day on each side so no zone is
 * ever cut off. Null = "not over yet" (use the upcoming filter). */
export function prefilterBounds(q: DiscoveryQuery, now: Date): { startIso: string; endIso: string; fromDate: string; toDate: string } | null {
  const w = windowFor(q, now, APP_TIMEZONE);
  const PAD = 26 * 3_600_000;
  if (w.kind === "live") return { startIso: new Date(now.getTime() - 1).toISOString(), endIso: new Date(now.getTime() + 1).toISOString(), fromDate: addDays(todayIn(APP_TIMEZONE, now), -1), toDate: addDays(todayIn(APP_TIMEZONE, now), 1) };
  if (w.kind === "upnext") return { startIso: now.toISOString(), endIso: new Date(now.getTime() + UP_NEXT_HOURS * 3_600_000 + PAD).toISOString(), fromDate: addDays(todayIn(APP_TIMEZONE, now), -1), toDate: addDays(todayIn(APP_TIMEZONE, now), 2) };
  if (w.kind === "upcoming") return null;
  const startMs = Math.max(zonedInstant(w.from, 0) - PAD, now.getTime() - PAD);
  const endMs = zonedInstant(w.to, 24 * 60 + (w.band && w.band[1] > 1440 ? w.band[1] - 1440 : 0)) + PAD;
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString(), fromDate: addDays(w.from, -1), toDate: addDays(w.to, 1) };
}
