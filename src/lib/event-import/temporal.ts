// Event Import — PARTIAL dates and RECURRING hours (pure; no I/O).
//
// Partial temporal information is valid information, never "no date":
//
//   "Open through November 29, 2026"        → end known, start unresolved
//   "Opening November 5"                    → start known, end unresolved
//   "Every Saturday through December 19"    → weekly rule + end bound
//   "Monday–Saturday: 10:00 AM–7:00 PM"     → weekly hours (per weekday)
//
// Nothing is ever invented: an unknown opening date is NOT today, an
// unknown end is NOT the start. Findmi keeps one date model (Primary Date
// + per-day event_occurrences — lib/event-create-schedule.ts; no stored
// recurrence rule), so a weekly rule becomes concrete dated occurrences
// ONLY when both bounds are known (expandWeeklySchedule). Until then the
// parsed rule is kept for Review, which asks for the missing bound.
import { addDays, datesInText, parseTimes, parseWeekdayRule, type ScheduleContext } from "./schedule";

/** One weekly opening-hours line: these weekdays (0 = Sunday), these hours. */
export interface WeeklyHours {
  days: number[];
  startTime: string;
  endTime: string | null;
  overnight: boolean;
  /** The source line, for Review. */
  label: string;
}

export interface TemporalReading {
  /** YYYY-MM-DD, or null when the source doesn't say. */
  startDate: string | null;
  endDate: string | null;
  /** Per-weekday hours ("Monday–Saturday: 10–7", "Sunday: 11–6"). */
  weekly: WeeklyHours[];
  /** "Every Saturday …" with no hours of its own (0 = Sunday). */
  weekdays: number[] | null;
  /** IANA zone when the source names one (Findmi schedules in Eastern). */
  timezone: string | null;
  /** The bounds Review must ask for. */
  unresolved: ("start" | "end")[];
  /** The source text this was read from. */
  evidence: string;
}

const END_CUE = /\b(?:through|thru|until|till|til|ends?|ending|closing|closes|close|last\s+day(?:\s+is)?|runs\s+through|on\s+view\s+through|open\s+through|extended\s+(?:through|until)|by)\s*$/i;
const START_CUE = /\b(?:opening|opens|open\s+on|opened|starting|starts|start|from|beginning|begins|begin|launch(?:es|ing)?|debuts?|kicks?\s+off|on\s+view\s+from|as\s+of)\s*(?:on\s*)?$/i;
const RANGE_GAP = /^\s*(?:–|—|-|to|through|thru|until|till)\s*$/i;
const EVERY = /\b(?:every|each)\s+(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*|weekend|weekday|day)/i;

/** Reads the start / end bounds a free-text date statement gives. Null
 * when it names no date at all. */
export function readPartialDates(text: string, ctx: ScheduleContext): Pick<TemporalReading, "startDate" | "endDate" | "weekdays"> | null {
  const t = text.replace(/\s+/g, " ").trim();
  const found = datesInText(t, ctx);
  if (found.length === 0) return null;
  let startDate: string | null = null;
  let endDate: string | null = null;
  for (let i = 0; i < found.length; i++) {
    const d = found[i];
    const next = found[i + 1];
    // An explicit range "Nov 5 – Nov 29".
    if (next && RANGE_GAP.test(t.slice(d.end, next.index).replace(/,\s*20\d{2}\s*/, " "))) {
      startDate ??= d.date;
      endDate ??= next.date;
      i++;
      continue;
    }
    const before = t.slice(Math.max(0, d.index - 40), d.index);
    if (END_CUE.test(before)) endDate ??= d.date;
    else if (START_CUE.test(before)) startDate ??= d.date;
    else if (found.length === 1 && !leftoverText(t, d)) {
      // A lone date with no cue — and nothing else written beside it — is
      // that single day. Anything unreadable next to it ("Oct 15–18
      // (weekend)") is left for Review, never guessed.
      startDate = d.date;
      endDate = d.date;
    }
  }
  if (!startDate && !endDate) return null;
  // A start written without a year that would fall after the stated end
  // belongs to the year before (e.g. "Opening Nov 5 … through Jan 10, 2027").
  if (startDate && endDate && startDate > endDate) {
    const prior = `${Number(startDate.slice(0, 4)) - 1}${startDate.slice(4)}`;
    if (prior <= endDate) startDate = prior;
    else return { startDate: null, endDate, weekdays: null };
  }
  const weekdays = EVERY.test(t) ? parseWeekdayRule(t) : null;
  return { startDate, endDate, weekdays: weekdays ? [...weekdays].sort() : null };
}

/** Text left beside a date once separators, weekdays and the year are gone. */
function leftoverText(t: string, d: { index: number; end: number }): string {
  return (t.slice(0, d.index) + " " + t.slice(d.end))
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?/gi, " ")
    .replace(/[\s,.;:–—\-]+/g, "");
}

const DAYS_PART = /^([^:\d]{3,40}?)\s*[:\-–—]?\s*((?:\d|noon|midnight).*)$/i;
const CLOSED = /\b(closed|by appointment)\b/i;

/** One weekly-hours line ("Monday–Saturday: 10:00 AM–7:00 PM",
 * "Sun 11am-6pm", "Daily: 10–6"), else null. */
export function readWeeklyHoursLine(line: string): WeeklyHours | null {
  const clean = line.replace(/^[\s•*·▪◦>|]+/, "").trim();
  if (!clean || clean.length > 80 || CLOSED.test(clean)) return null;
  const m = DAYS_PART.exec(clean);
  if (!m) return null;
  const days = parseWeekdayRule(m[1]);
  // The day part must be ONLY weekdays / daily / weekends words.
  if (!days || /[a-z]{3,}/i.test(m[1].replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?|\b(daily|every\s*day|everyday|weekends?|weekdays|and|to|through|thru|hours|open)\b/gi, ""))) return null;
  const times = parseTimes(m[2]);
  if (!times) return null;
  return { days: [...days].sort(), startTime: times.startTime, endTime: times.endTime, overnight: times.overnight, label: clean };
}

export function readWeeklyHours(lines: readonly string[]): WeeklyHours[] {
  const out: WeeklyHours[] = [];
  for (const l of lines.slice(0, 20)) {
    const w = readWeeklyHoursLine(l);
    if (w) out.push(w);
  }
  return out;
}

/** "Eastern" / "ET" / "EST" / "America/New_York" → the IANA zone. */
export function readTimezone(text: string | null | undefined): string | null {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return null;
  if (/\b(eastern|e[sd]?t|america\/new_york|new york)\b/.test(t)) return "America/New_York";
  if (/\b(central|c[sd]?t|america\/chicago)\b/.test(t)) return "America/Chicago";
  if (/\b(mountain|m[sd]?t|america\/denver)\b/.test(t)) return "America/Denver";
  if (/\b(pacific|p[sd]?t|america\/los_angeles)\b/.test(t)) return "America/Los_Angeles";
  return null;
}

/** The bounds Review still needs. */
export function unresolvedBounds(t: Pick<TemporalReading, "startDate" | "endDate" | "weekly" | "weekdays">): ("start" | "end")[] {
  const out: ("start" | "end")[] = [];
  const recurring = t.weekly.length > 0 || Boolean(t.weekdays?.length);
  if (!t.startDate) out.push("start");
  if (!t.endDate && (recurring || t.startDate)) out.push("end");
  return out;
}

/** Concrete dates for a weekly schedule between two KNOWN bounds — each
 * date with its own weekday's hours. Bounded; never invents a bound. */
export function expandWeeklySchedule(
  t: Pick<TemporalReading, "startDate" | "endDate" | "weekly" | "weekdays">,
  max: number
): { dates: { date: string; startTime: string | null; endTime: string | null; overnight: boolean }[]; truncated: boolean } | null {
  if (!t.startDate || !t.endDate || t.endDate < t.startDate) return null;
  const dates: { date: string; startTime: string | null; endTime: string | null; overnight: boolean }[] = [];
  const allDays = t.weekly.length === 0 && !t.weekdays?.length;
  let truncated = false;
  for (let d = t.startDate, guard = 0; d <= t.endDate && guard < 800; d = addDays(d, 1), guard++) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    const hours = t.weekly.find((w) => w.days.includes(dow));
    if (hours) dates.push({ date: d, startTime: hours.startTime, endTime: hours.endTime, overnight: hours.overnight });
    else if (t.weekly.length === 0 && (allDays || t.weekdays!.includes(dow))) dates.push({ date: d, startTime: null, endTime: null, overnight: false });
    if (dates.length > max) {
      truncated = true;
      dates.length = max;
      break;
    }
  }
  return { dates, truncated };
}

const LONG_DATE = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekday set → "Monday–Saturday", "Sunday", "Saturdays & Sundays". */
export function describeWeekdays(days: readonly number[]): string {
  const s = [...new Set(days)].sort();
  if (s.length === 7) return "Every day";
  const consecutive = s.length > 2 && s.every((d, i) => i === 0 || d === s[i - 1] + 1);
  if (consecutive) return `${WEEKDAY_NAMES[s[0]]}–${WEEKDAY_NAMES[s[s.length - 1]]}`;
  return s.map((d) => WEEKDAY_NAMES[d]).join(", ");
}

/** What Review says about a partial schedule — what was found, and the
 * exact component still needed. Null when nothing is partial. */
/** "19:00" → "7:00 PM". */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Monday–Saturday 10:00 AM–7:00 PM; Sunday 11:00 AM–6:00 PM". */
export function describeWeeklyHours(weekly: readonly WeeklyHours[]): string {
  return weekly.map((w) => `${describeWeekdays(w.days)} ${clockLabel(w.startTime)}${w.endTime ? `–${clockLabel(w.endTime)}` : ""}`).join("; ");
}

export function describeTemporal(t: TemporalReading): string | null {
  const hours = t.weekly.length > 0 ? ` Weekly hours were kept: ${describeWeeklyHours(t.weekly)}.` : "";
  if (t.endDate && !t.startDate) return `We found an end date of ${LONG_DATE(t.endDate)}, but couldn't determine the opening date. Add the opening date to create the schedule.${hours}`;
  if (t.startDate && !t.endDate && (t.weekly.length > 0 || t.weekdays?.length)) return `We found an opening date of ${LONG_DATE(t.startDate)}, but couldn't determine the closing date. Add the last date to create the schedule.${hours}`;
  if (t.startDate && !t.endDate) return `We found a start date of ${LONG_DATE(t.startDate)}. Add the end date if it runs longer.`;
  if (!t.startDate && !t.endDate && t.weekly.length > 0) return `We found weekly hours but no dates. Add the first and last dates to create the schedule.${hours}`;
  return null;
}
