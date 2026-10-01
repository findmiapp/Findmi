// Journal V1.1 — pure date/grouping helpers for the Journal archive
// (Day/Week/Month/Year). Deliberately native Date/Intl only, no calendar
// library: the actual surface area needed (a Monday-start month grid, a
// 7-day week strip, and prev/next navigation) is small and fully
// deterministic. Every function here is pure — no fetching, no
// server/client distinction — so the archive page can build its view
// purely from the one already-fetched entries array (see
// getJournalArchiveEntries in lib/journal.ts) with zero extra queries no
// matter how many periods a visitor pages through.
import type { JournalArchiveFilter, JournalIndexEntry } from "./journal";

export type JournalArchiveView = "day" | "week" | "month" | "year";

/** The "All experiences / Places / Brands / Products / Events" secondary
 * filter — applied in plain JS over the one already-fetched, unfiltered
 * array (see getJournalArchiveEntries), same real relationships
 * (hasBusiness/hasProduct/hasEvent/location) the old per-filter DB query
 * used, just without a second round trip per filter choice. */
export function filterByObjectType(entries: JournalIndexEntry[], filter: JournalArchiveFilter): JournalIndexEntry[] {
  if (filter === "brands") return entries.filter((e) => e.hasBusiness);
  if (filter === "products") return entries.filter((e) => e.hasProduct);
  if (filter === "events") return entries.filter((e) => e.hasEvent);
  if (filter === "places") return entries.filter((e) => e.location);
  return entries;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** A plain "YYYY-MM-DD" string (how entry_date always arrives from
 * Postgres) parsed as LOCAL midnight — the same convention the Detail
 * page and the old Index already used (`new Date(entry_date +
 * "T00:00:00")`), so a date never shifts a day depending on the server's
 * own timezone. */
export function parseYmd(ymd: string): Date {
  return new Date(ymd + "T00:00:00");
}

/** The archive's current anchor date — from a validated `?date=` param,
 * else today (local midnight, time-of-day stripped so date-only
 * comparisons/arithmetic below are never off by a few hours). */
export function parseAnchorDate(dateParam: string | undefined): Date {
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const parsed = parseYmd(dateParam);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function todayYmd(): string {
  return toYmd(new Date());
}

/** Moves the anchor by one period in the given view. Month/year navigation
 * resets the day-of-month to 1 first — otherwise e.g. anchoring on Jan 31
 * and stepping forward a month would roll into March (Feb has no 31st),
 * a classic Date-arithmetic trap. */
export function shiftAnchor(anchor: Date, view: JournalArchiveView, direction: 1 | -1): Date {
  const d = new Date(anchor);
  if (view === "day") {
    d.setDate(d.getDate() + direction);
  } else if (view === "week") {
    d.setDate(d.getDate() + direction * 7);
  } else if (view === "month") {
    d.setDate(1);
    d.setMonth(d.getMonth() + direction);
  } else {
    d.setDate(1);
    d.setMonth(0);
    d.setFullYear(d.getFullYear() + direction);
  }
  return d;
}

// ---- Week (Monday-start) ----

export function startOfWeek(anchor: Date): Date {
  const weekday = (anchor.getDay() + 6) % 7; // Mon=0 .. Sun=6
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - weekday);
  return start;
}

export function buildWeekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

// ---- Month grid (Monday-start, exactly as many rows as the month needs) ----

export interface MonthDayCell {
  date: Date;
  ymd: string;
  inMonth: boolean;
}

export function buildMonthGrid(anchor: Date): MonthDayCell[][] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0
  const rows = Math.ceil((firstWeekday + daysInMonth) / 7);
  const cursor = new Date(year, month, 1 - firstWeekday);

  const weeks: MonthDayCell[][] = [];
  for (let w = 0; w < rows; w++) {
    const week: MonthDayCell[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({ date: new Date(cursor), ymd: toYmd(cursor), inMonth: cursor.getMonth() === month });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// ---- Labels ----

export function monthYearLabel(anchor: Date): string {
  return anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function weekRangeLabel(days: Date[]): string {
  const start = days[0];
  const end = days[days.length - 1];
  const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr =
    start.getMonth() === end.getMonth()
      ? end.toLocaleDateString("en-US", { day: "numeric" })
      : end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${startStr} – ${endStr}`;
}

export function dayLabel(anchor: Date): string {
  return anchor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function dayLabelShort(anchor: Date): string {
  return anchor.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function yearLabel(anchor: Date): string {
  return String(anchor.getFullYear());
}

export function formatEntryTime(entryTime: string): string {
  // entry_time arrives as "HH:MM:SS" (Postgres `time`) — build a throwaway
  // Date purely to reuse toLocaleTimeString's real AM/PM formatting.
  const [h, m] = entryTime.split(":");
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ---- Grouping/filtering over the one already-fetched entries array ----

export function groupEntriesByDate(entries: JournalIndexEntry[]): Map<string, JournalIndexEntry[]> {
  const map = new Map<string, JournalIndexEntry[]>();
  for (const e of entries) {
    const list = map.get(e.entry_date) ?? [];
    list.push(e);
    map.set(e.entry_date, list);
  }
  return map;
}

export function entriesForMonth(entries: JournalIndexEntry[], anchor: Date): JournalIndexEntry[] {
  const prefix = `${anchor.getFullYear()}-${pad2(anchor.getMonth() + 1)}`;
  return entries.filter((e) => e.entry_date.startsWith(prefix));
}

export function entriesForWeek(entries: JournalIndexEntry[], weekDays: Date[]): JournalIndexEntry[] {
  const startYmd = toYmd(weekDays[0]);
  const endYmd = toYmd(weekDays[weekDays.length - 1]);
  // ISO "YYYY-MM-DD" strings sort lexically the same as chronologically.
  return entries.filter((e) => e.entry_date >= startYmd && e.entry_date <= endYmd);
}

export function entriesForDay(entries: JournalIndexEntry[], ymd: string): JournalIndexEntry[] {
  return entries.filter((e) => e.entry_date === ymd);
}

export function entriesForYear(entries: JournalIndexEntry[], year: number): JournalIndexEntry[] {
  const prefix = String(year);
  return entries.filter((e) => e.entry_date.startsWith(prefix));
}

/** Chronological (earliest-first) time-of-day ordering for Day view —
 * entries without a time sort after every timed entry rather than being
 * dropped or guessed at. Array.prototype.sort is spec-stable, so entries
 * sharing a time (or both untimed) keep their existing relative order. */
export function sortByTimeOfDay(entries: JournalIndexEntry[]): JournalIndexEntry[] {
  return [...entries].sort((a, b) => {
    if (a.entry_time && b.entry_time) return a.entry_time.localeCompare(b.entry_time);
    if (a.entry_time) return -1;
    if (b.entry_time) return 1;
    return 0;
  });
}

export interface JournalYearMonthSummary {
  month: number; // 0-11
  label: string;
  count: number;
  previewCoverUrls: string[];
}

/** Year view's 12-month roster — real counts and up to 3 real cover
 * thumbnails per month, sourced only from entries that already matched
 * the current object-type filter; a month with zero matches reads "No
 * entries," never a fabricated placeholder. */
export function buildYearMonthSummaries(entries: JournalIndexEntry[], year: number): JournalYearMonthSummary[] {
  const byMonth = new Map<number, JournalIndexEntry[]>();
  for (const e of entriesForYear(entries, year)) {
    const month = parseYmd(e.entry_date).getMonth();
    const list = byMonth.get(month) ?? [];
    list.push(e);
    byMonth.set(month, list);
  }
  return Array.from({ length: 12 }, (_, month) => {
    const list = byMonth.get(month) ?? [];
    return {
      month,
      label: new Date(year, month, 1).toLocaleDateString("en-US", { month: "long" }),
      count: list.length,
      previewCoverUrls: list.map((e) => e.coverUrl).filter((u): u is string => Boolean(u)).slice(0, 3),
    };
  });
}
