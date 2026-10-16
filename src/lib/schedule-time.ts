// Field QA UX Pass 1 — shared, pure scheduling helpers (client- and
// server-safe, no imports). Used by the shared time/date-range controls
// (components/scheduling) and by the Moment composer's "today" occurrence
// default.
//
// Quarter hours are an INPUT CONVENIENCE only: nothing here rounds a stored
// value. "HH:MM" and "YYYY-MM-DDTHH:MM" are wall-clock local values (the
// same shape <input type="datetime-local"> and isoToLocalDateTime use), so
// all arithmetic below is plain calendar math on those components — no
// timezone conversion, no Date parsing in the browser's zone.

/** "00:00", "00:15", … "23:45". */
export const QUARTER_HOUR_TIMES: string[] = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

const TIME_RE = /^(\d{2}):(\d{2})/;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** "07:07" or "07:07:30" → "07:07"; anything else → "". */
export function normalizeTime(value: string | null | undefined): string {
  const m = (value ?? "").match(TIME_RE);
  return m ? `${m[1]}:${m[2]}` : "";
}

export function isQuarterHour(time: string): boolean {
  const m = time.match(TIME_RE);
  return Boolean(m) && Number(m![2]) % 15 === 0;
}

/** "19:30" → "7:30 PM", "07:07" → "7:07 AM". */
export function formatTimeLabel(time: string): string {
  const m = time.match(TIME_RE);
  if (!m) return time;
  const h = Number(m[1]);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** "YYYY-MM-DD" + "HH:MM" → "YYYY-MM-DDTHH:MM", or "" if either is missing. */
export function joinLocalDateTime(date: string, time: string): string {
  return date && time ? `${date}T${time}` : "";
}

/** "YYYY-MM-DDTHH:MM[:SS…]" → { date, time } (time "HH:MM"); blank parts when absent. */
export function splitLocalDateTime(value: string | null | undefined): { date: string; time: string } {
  const m = (value ?? "").match(LOCAL_RE);
  return m ? { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` } : { date: "", time: "" };
}

function toMinutes(local: string): number | null {
  const m = local.match(LOCAL_RE);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;
}

function fromMinutes(total: number): string {
  const d = new Date(total * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Wall-clock add (calendar math, no DST/timezone interpretation). */
export function addMinutesLocal(local: string, minutes: number): string {
  const base = toMinutes(local);
  return base === null ? "" : fromMinutes(base + minutes);
}

/** end − start in minutes, or null when either is incomplete. */
export function diffMinutesLocal(start: string, end: string): number | null {
  const a = toMinutes(start);
  const b = toMinutes(end);
  return a === null || b === null ? null : b - a;
}

export const DEFAULT_DURATION_MINUTES = 60;

/**
 * Start → End rule shared by every Start/End date-time pair:
 *  - End is derived from Start when End hasn't been deliberately chosen,
 *    keeping the previous duration when there was a valid one;
 *  - a deliberately chosen End is kept while it's still after Start; if
 *    Start moves past it, End moves with Start, keeping the duration;
 *  - with only a Start DATE, End's date starts from it (never "today").
 * Returns the End to show; never touches a value nobody changed.
 */
export function nextEndForStart(params: {
  prevStart: { date: string; time: string };
  nextStart: { date: string; time: string };
  end: { date: string; time: string };
  endTouched: boolean;
}): { date: string; time: string } {
  const { prevStart, nextStart, end, endTouched } = params;
  const nextStartLocal = joinLocalDateTime(nextStart.date, nextStart.time);
  const endLocal = joinLocalDateTime(end.date, end.time);
  const prevStartLocal = joinLocalDateTime(prevStart.date, prevStart.time);

  if (!nextStartLocal) {
    // Only the date is known: End's date must start from Start's date.
    if (nextStart.date && (!end.date || end.date < nextStart.date)) return { date: nextStart.date, time: end.time };
    return end;
  }

  const prevDuration = prevStartLocal && endLocal ? diffMinutesLocal(prevStartLocal, endLocal) : null;
  const duration = prevDuration !== null && prevDuration > 0 ? prevDuration : DEFAULT_DURATION_MINUTES;
  const shift = () => splitLocalDateTime(addMinutesLocal(nextStartLocal, duration));

  if (!endTouched || !endLocal) return shift();
  if (endLocal <= nextStartLocal) return shift();
  return end;
}

// ---------------------------------------------------------------------------
// "Today" for Event occurrences (Moment composer)
// ---------------------------------------------------------------------------

/** Calendar date (YYYY-MM-DD) of `instant` in an IANA timezone. */
export function localDateInZone(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  }
}

export interface OccurrenceLike {
  id: string;
  /** Null when the date has no published time (Event date/time precision). */
  start_at: string | null;
  end_at: string | null;
  timezone: string;
  /** The real calendar date — required to place a date with no time. */
  occurrence_date?: string | null;
}

/** An occurrence's own local calendar date. */
function occurrenceLocalDate(o: OccurrenceLike): string {
  return o.start_at ? localDateInZone(new Date(o.start_at), o.timezone) : (o.occurrence_date ?? "");
}

/**
 * Which occurrence a Moment being made now most likely means — "today" is
 * judged in EACH occurrence's own timezone (the Event's local day), never
 * a naive UTC date:
 *   - today's occurrences: on today's local date, or happening right now
 *     (a real interval only — a date with no published time is "today"
 *     by its calendar date, never "live");
 *   - auto: exactly one today → it; several today but exactly one
 *     happening right now → it; otherwise null (never a guess);
 *   - anchor: where a date picker should open — the first of today's,
 *     else the next upcoming, else the most recent past one.
 */
export function pickTodayOccurrence<T extends OccurrenceLike>(occurrences: T[], now: Date = new Date()): { auto: T | null; todayIds: Set<string>; anchorId: string | null } {
  const nowMs = now.getTime();
  const isLive = (o: T) => Boolean(o.start_at && o.end_at && new Date(o.start_at).getTime() <= nowMs && nowMs < new Date(o.end_at).getTime());
  const sorted = [...occurrences].sort((a, b) => {
    const da = occurrenceLocalDate(a);
    const db = occurrenceLocalDate(b);
    if (da !== db) return da < db ? -1 : 1;
    if (a.start_at && b.start_at) return a.start_at.localeCompare(b.start_at);
    return a.start_at ? -1 : b.start_at ? 1 : a.id.localeCompare(b.id);
  });
  const today = sorted.filter((o) => occurrenceLocalDate(o) === localDateInZone(now, o.timezone) || isLive(o));
  const live = today.filter(isLive);
  const auto = today.length === 1 ? today[0] : live.length === 1 ? live[0] : null;

  // Not over: a timed date until its end; otherwise through its local date.
  const upcoming = sorted.find((o) => (o.end_at ? new Date(o.end_at).getTime() >= nowMs : occurrenceLocalDate(o) >= localDateInZone(now, o.timezone)));
  const anchor = today[0] ?? upcoming ?? sorted[sorted.length - 1] ?? null;
  return { auto, todayIds: new Set(today.map((o) => o.id)), anchorId: anchor?.id ?? null };
}
