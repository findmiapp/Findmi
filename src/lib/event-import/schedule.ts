// Event Import V1B — schedule lines read from a page's visible text (pure,
// bounded, deterministic). Many event pages (tours, residencies, pop-up
// series) publish their schedule as human-readable lines rather than
// structured data:
//
//   9/26, 12–6pm – Astoria Park (19th St & 23rd Ave)
//   9/25–10/31, 6pm–12am — MSG
//   Wednesdays, Fridays and Saturdays only
//
// Each line is read as ONE grouped entry — its date(s), its time and its
// place stay together; they are never collected into separate lists. A
// date range becomes dates only with a stated weekday rule ("Wednesdays,
// Fridays and Saturdays", "weekends", "daily") on the same or an adjacent
// line — a bare range is never read as "every day". Anything outside this
// small grammar is left for the Business (or the AI step, whose output is
// re-read through this same parser) rather than guessed.
import { localDateTimeToIso } from "../admin/form-helpers";
import { cleanText } from "../brand-website-extract";
import { APP_TIMEZONE, dateKeyInZone } from "../format";
import { EMPTY_VENUE, venueKey, type ImportedOccurrence, type ImportedVenue } from "./types";

export const SCHEDULE_MAX_OCCURRENCES = 60;
const MAX_RANGE_DAYS = 120;
const MAX_LINE_CHARS = 200;
const MAX_LINES = 800;

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const WD_PREFIX = String.raw`(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\.?,?\s+)?`;
const MONTH_WORD = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const MONTH_FIRST = String.raw`(?:(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d\/])|${MONTH_WORD}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?!\d|:\d))`;
const DATE_TOKEN = new RegExp(`${WD_PREFIX}${MONTH_FIRST}`, "gi");
// Owner flyer / pasted text only (ScheduleContext.upcomingYear): day-first
// "29th November (2026)" too — common on flyers. It needs a real word
// boundary on both sides, so "5 marvelous" or "Top 2 Mayors" never read as
// dates. Link imports keep DATE_TOKEN unchanged.
const DATE_TOKEN_DAY_FIRST = new RegExp(
  String.raw`${WD_PREFIX}(?:${MONTH_FIRST.slice(3, -1)}|(?<![\d\/:])(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH_WORD}(?![a-z])(?:,?\s+(\d{4}))?(?!\d|:\d))`,
  "gi"
);
const tokenRegex = (ctx?: ScheduleContext) => (ctx?.upcomingYear ? DATE_TOKEN_DAY_FIRST : DATE_TOKEN);
const RANGE_JOIN = /^\s*(?:–|—|-|to|through|thru|until|till)\s*$/i;
const DAY_ONLY_RANGE = /^\s*(?:–|—|-|to|through|thru)\s*(\d{1,2})(?:st|nd|rd|th)?\b/i;
const WEEKDAY_WORD = /\b(mon(?:day)?s?|tue(?:s(?:day)?)?s?|wed(?:nesday)?s?|thu(?:r(?:s(?:day)?)?)?s?|fri(?:day)?s?|sat(?:urday)?s?|sun(?:day)?s?)\b\.?/gi;
const WEEKDAY_RANGE = new RegExp(String.raw`${WEEKDAY_WORD.source}\s*(?:–|—|-|to|through|thru)\s*${WEEKDAY_WORD.source}`, "i");
const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?`;
const TIME_RANGE = new RegExp(
  String.raw`(?<![\d\/])(?:${TIME}|(noon|midnight))\s*(?:–|—|-|to|until|till)\s*(?:(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?|(\d{1,2}):(\d{2})|(noon|midnight))`,
  "i"
);
const SINGLE_TIME = /(?<![\d\/:])(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?(?![a-z])|\bnoon\b/i;

interface DateToken {
  index: number;
  end: number;
  month: number;
  day: number;
  year: number | null;
}

export interface ScheduleContext {
  now: number;
  /** The single year the page mentions, if exactly one. */
  yearHint: number | null;
  /** Owner flyer / pasted-text imports: a month/day with no stated year is
   * the NEXT occurrence of that day that hasn't passed (in Findmi's Eastern
   * calendar). Link imports keep the closest-to-today rule. */
  upcomingYear?: boolean;
}

export interface ScheduleResult {
  occurrences: ImportedOccurrence[];
  /** Date ranges the page gives without a weekday rule we can apply. */
  unresolvedRanges: number;
  /** More dates than SCHEDULE_MAX_OCCURRENCES; the earliest are kept. */
  truncated: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
function validDay(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
export function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function dateTokens(line: string, ctx?: ScheduleContext): DateToken[] {
  const out: DateToken[] = [];
  const re = tokenRegex(ctx);
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) && out.length < 40) {
    const month = m[1] ? Number(m[1]) : MONTHS[(m[4] ?? m[8] ?? "").slice(0, 3).toLowerCase()];
    const day = Number(m[1] ? m[2] : m[4] ? m[5] : m[7]);
    const rawYear = m[3] ?? m[6] ?? m[9] ?? null;
    const year = rawYear ? (rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)) : null;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) out.push({ index: m.index, end: m.index + m[0].length, month, day, year });
  }
  return out;
}

/** Calendar year for a month/day without one: the page's own year when it
 * states exactly one; for owner flyer / pasted-text imports the next
 * occurrence that hasn't passed (this year if still ahead or today, else
 * next year); otherwise the occurrence of that day closest to today. */
export function resolveYear(month: number, day: number, ctx: ScheduleContext): number {
  if (ctx.yearHint) return ctx.yearHint;
  if (ctx.upcomingYear) {
    const today = dateKeyInZone(new Date(ctx.now), APP_TIMEZONE);
    const year = Number(today.slice(0, 4));
    return ymd(year, month, day) >= today ? year : year + 1;
  }
  const nowYear = new Date(ctx.now).getUTCFullYear();
  let best = nowYear;
  let bestDist = Infinity;
  for (const y of [nowYear - 1, nowYear, nowYear + 1]) {
    const dist = Math.abs(Date.UTC(y, month - 1, day) - ctx.now);
    if (dist < bestDist) {
      best = y;
      bestDist = dist;
    }
  }
  return best;
}

const LONE_MONTH = new RegExp(String.raw`^${WD_PREFIX}${MONTH_WORD},?$`, "i");
const LONE_DAY = /^(\d{1,2})\s*(st|nd|rd|th)?[.,]?$/i;
const LONE_SUFFIX = /^(st|nd|rd|th)\.?$/i;
const LONE_YEAR = /^(20\d{2})$/;

/** Flyers often stack a date over several visual lines ("NOVEMBER" / "29TH",
 * "NOVEMBER" / "29" / "TH", "29TH" / "NOVEMBER"). Rejoins exactly those
 * fragments (a lone month word, a lone day number, a lone ordinal suffix, a
 * lone year) into one date line. Nothing else is touched, so nothing that
 * isn't written as a date can become one. Blank lines are preserved. */
export function joinSplitDateLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  const nextIdx = (i: number) => {
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    return j;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const month = LONE_MONTH.test(line);
    const day = LONE_DAY.exec(line);
    if (!month && !day) {
      out.push(lines[i]);
      continue;
    }
    let j = nextIdx(i);
    const second = j < lines.length ? lines[j].trim() : "";
    const secondDay = month ? LONE_DAY.exec(second) : null;
    const secondMonth = day && LONE_MONTH.test(second);
    if (!secondDay && !secondMonth) {
      out.push(lines[i]);
      continue;
    }
    // month-first or day-first pair
    let joined = month ? `${line} ${secondDay![1]}${secondDay![2] ?? ""}` : `${day![1]}${day![2] ?? ""} ${second}`;
    let hasSuffix = Boolean(month ? secondDay![2] : day![2]);
    let k = nextIdx(j);
    if (!hasSuffix && k < lines.length && LONE_SUFFIX.test(lines[k].trim())) {
      joined += lines[k].trim().replace(/\.$/, "");
      hasSuffix = true;
      j = k;
      k = nextIdx(j);
    }
    if (k < lines.length && LONE_YEAR.test(lines[k].trim())) {
      joined += ` ${lines[k].trim()}`;
      j = k;
    }
    out.push(joined);
    i = j;
  }
  return out;
}

/** Weekday rule stated in text, e.g. "Wednesdays, Fridays and Saturdays",
 * "Thu–Sun", "weekends", "daily". Null when none is stated. */
export function parseWeekdayRule(text: string): Set<number> | null {
  const t = text.toLowerCase();
  if (/\b(daily|every\s*day|everyday)\b/.test(t)) return new Set([0, 1, 2, 3, 4, 5, 6]);
  const days = new Set<number>();
  if (/\bweekends?\b/.test(t)) [0, 6].forEach((d) => days.add(d));
  if (/\bweekdays\b/.test(t)) [1, 2, 3, 4, 5].forEach((d) => days.add(d));
  const range = WEEKDAY_RANGE.exec(t);
  if (range) {
    const from = WEEKDAYS[range[1].slice(0, 3)];
    const to = WEEKDAYS[range[2].slice(0, 3)];
    for (let d = from, i = 0; i < 7; d = (d + 1) % 7, i++) {
      days.add(d);
      if (d === to) break;
    }
  } else {
    for (const m of t.matchAll(WEEKDAY_WORD)) days.add(WEEKDAYS[m[1].slice(0, 3)]);
  }
  return days.size > 0 ? days : null;
}

function stripWeekdayRule(text: string): string {
  return text
    .replace(/\b(daily|every\s*day|everyday|weekends?|weekdays|only|every|each|open|on)\b/gi, " ")
    .replace(WEEKDAY_WORD, " ")
    .replace(/\b(and)\b|&|\/|,/gi, " ");
}

const toMinutes = (h: number, m: number, mer: "a" | "p") => (h % 12) * 60 + m + (mer === "p" ? 720 : 0);
/** Start without am/pm before a known end: the half of the day giving the
 * shorter forward span ("12–6pm" → noon, "6–12am" → 6 PM). */
function pickStart(end: number, h: number, m: number): number {
  const span = (s: number) => ((end - s + 1440) % 1440) || 1440;
  const am = toMinutes(h, m, "a");
  const pm = toMinutes(h, m, "p");
  return span(am) <= span(pm) ? am : pm;
}
const hhmm = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

/** A stated time range on the line, or a single start time. The start of
 * "12–6pm" / "6–12am" takes whichever half of the day gives the shorter,
 * forward span. An end at or before the start means it ends after
 * midnight. */
export function parseTimes(text: string): { startTime: string; endTime: string | null; overnight: boolean; span: [number, number] } | null {
  const r = TIME_RANGE.exec(text);
  if (r) {
    const [, sh, sm, smer, sWord, eh, em, emer, e24h, e24m, eWord] = r;
    const forward = (from: number, to: number) => ((to - from + 1440) % 1440) || 1440;
    const nearest = (from: number, h: number, m: number) => {
      const am = toMinutes(h, m, "a");
      const pm = toMinutes(h, m, "p");
      return forward(from, am) <= forward(from, pm) ? am : pm;
    };
    const word = (w: string) => (w.toLowerCase() === "noon" ? 720 : 0);
    let start: number | null = null;
    if (sWord) start = word(sWord);
    else if (smer) {
      if (Number(sh) < 1 || Number(sh) > 12 || Number(sm ?? 0) > 59) return null;
      start = toMinutes(Number(sh), Number(sm ?? 0), smer.toLowerCase() as "a" | "p");
    }
    let end: number;
    if (eWord) end = word(eWord);
    else if (emer) {
      if (Number(eh) < 1 || Number(eh) > 12 || Number(em ?? 0) > 59) return null;
      end = toMinutes(Number(eh), Number(em ?? 0), emer.toLowerCase() as "a" | "p");
    } else {
      // "HH:MM" end without am/pm: 24-hour when it can only be, else the
      // half of the day that follows a known start.
      const h = Number(e24h);
      const m = Number(e24m);
      if (h > 23 || m > 59) return null;
      end = h > 12 || h === 0 || start === null ? h * 60 + m : nearest(start, h, m);
    }
    if (start === null) {
      const h = Number(sh);
      const m = Number(sm ?? 0);
      if (h > 23 || m > 59) return null;
      start = h > 12 || h === 0 || (e24h !== undefined && !emer) ? h * 60 + m : pickStart(end, h, m);
    }
    if (start === end || forward(start, end) > 16 * 60) return null;
    return { startTime: hhmm(start), endTime: hhmm(end), overnight: end < start, span: [r.index, r.index + r[0].length] };
  }
  const s = SINGLE_TIME.exec(text);
  if (s) {
    if (/noon/i.test(s[0])) return { startTime: "12:00", endTime: null, overnight: false, span: [s.index, s.index + s[0].length] };
    const h = Number(s[1]);
    const m = Number(s[2] ?? 0);
    if (h < 1 || h > 12 || m > 59) return null;
    return { startTime: hhmm(toMinutes(h, m, s[3].toLowerCase() as "a" | "p")), endTime: null, overnight: false, span: [s.index, s.index + s[0].length] };
  }
  return null;
}

/** "Astoria Park (19th St & 23rd Ave)" → name + address context. Text that
 * reads like a sentence rather than a place is not used. */
export function placeFrom(rest: string): ImportedVenue | null {
  let text = rest.replace(/\s+/g, " ");
  let address: string | null = null;
  const paren = /\(([^()]{2,100})\)/.exec(text);
  if (paren) {
    address = cleanText(paren[1], 200);
    text = text.replace(paren[0], " ");
  }
  text = text
    .replace(/^[\s,;:–—\-|@·•]+|[\s,;:–—\-|@·•]+$/g, "")
    .replace(/^(?:at|from|in|location)\b[:\s]*/i, "")
    .replace(/[\s,;:–—\-|·•]+$/g, "")
    .trim();
  if (!address) {
    const comma = /^([^,]{2,80}),\s*(\d[^,]{2,120})$/.exec(text);
    if (comma) {
      text = comma[1].trim();
      address = cleanText(comma[2], 200);
    }
  }
  if (!/[a-z]/i.test(text) || /^(tba|tbd|tbc)$/i.test(text)) text = "";
  const words = text.split(" ").filter(Boolean);
  if (words.length > 10 || text.length > 100) return null;
  const name = cleanText(text, 160);
  if (!name && !address) return null;
  return { ...EMPTY_VENUE, name, address };
}

export function occurrenceFor(date: string, times: ReturnType<typeof parseTimes>, venue: ImportedVenue | null, evidence: string): ImportedOccurrence | null {
  const place = venue ?? { ...EMPTY_VENUE };
  if (!times) return { start: date, end: null, hasTime: false, venue: place, evidence };
  const start = localDateTimeToIso(`${date}T${times.startTime}`);
  if (!start) return null;
  const end = times.endTime ? localDateTimeToIso(`${times.overnight ? addDays(date, 1) : date}T${times.endTime}`) : null;
  return { start, end: end && Date.parse(end) > Date.parse(start) ? end : null, hasTime: true, venue: place, evidence };
}

/** Bounded, page-wide schedule read. Lines must START with a date (after a
 * bullet/weekday), which is what schedule lists look like and what prose
 * ("posted 9/12 by …") does not. */
export function parseScheduleLines(lines: string[], ctx: ScheduleContext): ScheduleResult {
  const out: ImportedOccurrence[] = [];
  let unresolvedRanges = 0;
  const clean = lines.slice(0, MAX_LINES).map((l) => l.replace(/ /g, " ").replace(/^[\s•*·▪◦>|–—-]+/, "").trim());

  const constraintLine = (i: number): { days: Set<number>; times: ReturnType<typeof parseTimes>; text: string } | null => {
    const line = clean[i];
    if (!line || line.length > MAX_LINE_CHARS || dateTokens(line, ctx).length > 0) return null;
    const days = parseWeekdayRule(line);
    if (!days) return null;
    const times = parseTimes(line);
    const rest = stripWeekdayRule(times ? line.slice(0, times.span[0]) + " " + line.slice(times.span[1]) : line);
    const leftover = rest.replace(/[^a-z]+/gi, " ").trim().split(" ").filter(Boolean);
    return leftover.length <= 3 ? { days, times, text: line } : null;
  };

  for (let i = 0; i < clean.length && out.length < SCHEDULE_MAX_OCCURRENCES * 2; i++) {
    const line = clean[i];
    if (!line || line.length > MAX_LINE_CHARS) continue;
    const tokens = dateTokens(line, ctx);
    if (tokens.length === 0 || tokens[0].index > 4) continue;

    // Range: "9/25–10/31", "Sep 25 – Oct 31", "Sep 25–30".
    let range: { from: DateToken; to: { month: number; day: number; year: number | null }; end: number } | null = null;
    if (tokens.length >= 2 && RANGE_JOIN.test(line.slice(tokens[0].end, tokens[1].index))) {
      range = { from: tokens[0], to: tokens[1], end: tokens[1].end };
    } else {
      const dayOnly = DAY_ONLY_RANGE.exec(line.slice(tokens[0].end));
      if (dayOnly && !/\d\s*[ap]\.?m/i.test(line.slice(tokens[0].end, tokens[0].end + dayOnly[0].length + 4))) {
        range = { from: tokens[0], to: { month: tokens[0].month, day: Number(dayOnly[1]), year: tokens[0].year }, end: tokens[0].end + dayOnly[0].length };
      }
    }

    // Everything that isn't a date is the line's time + place.
    let rest = range ? line.slice(range.end) : line;
    if (!range) for (const t of [...tokens].reverse()) rest = rest.slice(0, t.index) + " " + rest.slice(t.end);
    else rest = rest.replace(tokenRegex(ctx), " ");
    let times = parseTimes(rest);
    if (times) rest = rest.slice(0, times.span[0]) + " " + rest.slice(times.span[1]);

    if (range) {
      let days = parseWeekdayRule(rest);
      let evidence = line;
      if (days) rest = stripWeekdayRule(rest);
      else {
        const near = constraintLine(i + 1) ?? constraintLine(i - 1);
        if (near) {
          days = near.days;
          times = times ?? near.times;
          evidence = clean[i + 1] === near.text ? `${line}\n${near.text}` : `${near.text}\n${line}`;
        }
      }
      const fromYear = range.from.year ?? resolveYear(range.from.month, range.from.day, ctx);
      let toYear = range.to.year ?? fromYear;
      if (!range.to.year && (range.to.month < range.from.month || (range.to.month === range.from.month && range.to.day < range.from.day))) toYear += 1;
      if (!days || !validDay(fromYear, range.from.month, range.from.day) || !validDay(toYear, range.to.month, range.to.day)) {
        unresolvedRanges += 1;
        continue;
      }
      const first = ymd(fromYear, range.from.month, range.from.day);
      const last = ymd(toYear, range.to.month, range.to.day);
      const span = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000;
      if (span < 0 || span > MAX_RANGE_DAYS) {
        unresolvedRanges += 1;
        continue;
      }
      const venue = placeFrom(rest);
      for (let d = first; d <= last; d = addDays(d, 1)) {
        if (!days.has(new Date(`${d}T00:00:00Z`).getUTCDay())) continue;
        const occ = occurrenceFor(d, times, venue, evidence);
        if (occ) out.push(occ);
      }
      continue;
    }

    // One or more explicit dates sharing this line's time + place.
    const venue = placeFrom(rest);
    if (!times && !venue) continue; // a bare date (byline, "updated 9/12") is not a schedule entry
    for (const t of tokens) {
      const year = t.year ?? resolveYear(t.month, t.day, ctx);
      if (!validDay(year, t.month, t.day)) continue;
      const occ = occurrenceFor(ymd(year, t.month, t.day), times, venue, line);
      if (occ) out.push(occ);
    }
  }
  const unique = dedupeOccurrences(out);
  return { occurrences: unique.slice(0, SCHEDULE_MAX_OCCURRENCES), unresolvedRanges, truncated: unique.length > SCHEDULE_MAX_OCCURRENCES };
}

/** Same start at the same place = one occurrence; chronological. */
export function dedupeOccurrences(list: ImportedOccurrence[]): ImportedOccurrence[] {
  const seen = new Set<string>();
  return list
    .filter((o) => {
      const key = `${o.start}#${venueKey(o.venue)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start.localeCompare(b.start) || venueKey(a.venue).localeCompare(venueKey(b.venue)));
}

/** Admin structured paste only — an explicit date FIELD ("Dates: October
 * 15–18, 2026", "Oct 15, Oct 17", "2026-10-15", "10/15/2026–10/18/2026")
 * → every date it names, chronological. Unlike free text, a range here is
 * every day in it: the field itself states the dates. Null when any part
 * can't be read (left for Review — never guessed), or a range is longer
 * than `maxRangeDays`. */
export function explicitDateList(text: string, ctx: ScheduleContext, maxRangeDays = 31): string[] | null {
  const t = text
    .replace(/\u00A0/g, " ")
    .replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/g, (_, y: string, m: string, d: string) => `${Number(m)}/${Number(d)}/${y}`)
    .trim();
  const tokens = dateTokens(t, ctx);
  if (tokens.length === 0 || t.length > MAX_LINE_CHARS) return null;
  const stated = /\b(20\d{2})\b/.exec(t);
  const yearOf = (tk: DateToken) => tk.year ?? (stated ? Number(stated[1]) : resolveYear(tk.month, tk.day, ctx));
  const dayOf = (tk: DateToken) => (validDay(yearOf(tk), tk.month, tk.day) ? ymd(yearOf(tk), tk.month, tk.day) : null);
  const out = new Set<string>();
  let leftover = t;
  const span = (from: string, to: string) => {
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
    if (days < 0 || days > maxRangeDays) return false;
    for (let i = 0; i <= days; i++) out.add(addDays(from, i));
    return true;
  };
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    const start = dayOf(tk);
    if (!start) return null;
    leftover = leftover.replace(t.slice(tk.index, tk.end), " ");
    const next = tokens[i + 1];
    const gap = next ? t.slice(tk.end, next.index) : "";
    if (next && RANGE_JOIN.test(gap.replace(/,\s*(20\d{2})\s*/, " "))) {
      const end = dayOf(next);
      if (!end || !span(start, end)) return null;
      leftover = leftover.replace(t.slice(next.index, next.end), " ");
      i++;
      continue;
    }
    const dayRange = DAY_ONLY_RANGE.exec(t.slice(tk.end));
    if (dayRange && !(next && next.index === tk.end)) {
      const endTok = { ...tk, day: Number(dayRange[1]) };
      const end = dayOf(endTok);
      if (!end || !span(start, end)) return null;
      leftover = leftover.replace(dayRange[0], " ");
      continue;
    }
    out.add(start);
  }
  // Nothing else may be written there (separators, years, weekdays only).
  const rest = leftover
    .replace(/\b20\d{2}\b/g, " ")
    .replace(WEEKDAY_WORD, " ")
    .replace(/\b(?:and|to|through|thru)\b/gi, " ")
    .replace(/[\s,;&/–—\-.]+/g, "");
  if (rest) return null;
  return [...out].sort();
}

/** Every calendar date written in `text`, in order, with where it sits —
 * the partial-date reader (./temporal.ts) decides what each one MEANS
 * ("through …" = an end bound, "opening …" = a start bound). A day that
 * doesn't exist is skipped, never guessed. */
export function datesInText(text: string, ctx: ScheduleContext): { date: string; index: number; end: number; yearStated: boolean }[] {
  const t = text.replace(/\u00A0/g, " ");
  const stated = /\b(20\d{2})\b/.exec(t);
  const out: { date: string; index: number; end: number; yearStated: boolean }[] = [];
  for (const tk of dateTokens(t, ctx)) {
    const year = tk.year ?? (stated ? Number(stated[1]) : resolveYear(tk.month, tk.day, ctx));
    if (validDay(year, tk.month, tk.day)) out.push({ date: ymd(year, tk.month, tk.day), index: tk.index, end: tk.end, yearStated: tk.year !== null });
  }
  return out;
}

/** The one year a page's text mentions (2000–2099), if exactly one. */
export function yearHintFrom(lines: string[]): number | null {
  const years = new Set<number>();
  for (const l of lines.slice(0, MAX_LINES)) for (const m of l.matchAll(/\b(20\d{2})\b/g)) years.add(Number(m[1]));
  return years.size === 1 ? [...years][0] : null;
}

/** Paste Details / Upload — a line that is ONLY one date ("OCT 15",
 * "Thursday, October 15, 2026", "10/15") → YYYY-MM-DD, else null. Flyers and
 * captions often put the date on its own line, which the schedule grammar
 * above (date + time/place on one line) deliberately skips on web pages. */
export function bareDate(line: string, ctx: ScheduleContext): string | null {
  const clean = line.replace(/\u00A0/g, " ").replace(/^[\s•*·▪◦>|–—-]+/, "").trim();
  if (!clean || clean.length > 60) return null;
  const tokens = dateTokens(clean, ctx);
  if (tokens.length !== 1 || tokens[0].index > 4) return null;
  const rest = (clean.slice(0, tokens[0].index) + clean.slice(tokens[0].end)).replace(/[\s,.;:–—\-|·•]+/g, "");
  if (rest) return null;
  const t = tokens[0];
  const year = t.year ?? resolveYear(t.month, t.day, ctx);
  return validDay(year, t.month, t.day) ? ymd(year, t.month, t.day) : null;
}
