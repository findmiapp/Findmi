// Unified Event Import — the TEXT adapter (pure; no network).
//
//   Paste Details: the text a Business pasted (a caption, an email, a
//                  newsletter, a press release, copied listing text);
//   Upload:        the text visible in an uploaded flyer / screenshot (read
//                  by the multimodal AI step in ./ai.ts, then treated
//                  exactly like pasted text).
//
// Both become the SAME EventCandidate the From Link path produces, then go
// through the same attendance / privacy / matching / Review / persistence.
// Deterministic first: the first line as the name, schedule lines (with a
// date and its time on adjacent lines joined), a street address block, an
// explicit "hosted by" organizer, explicit attendance links. Nothing is
// invented — no source link, no image, no organizer, no place, no price —
// and what isn't evidenced stays empty for Review. The grounded AI reading
// (sanitized against this same text) only fills what is still missing.
import { cleanText, usStateCode } from "../brand-website-extract";
import { cleanEventDescription } from "./description";
import { bareDate, dedupeOccurrences, parseScheduleLines, parseTimes, yearHintFrom, SCHEDULE_MAX_OCCURRENCES } from "./schedule";
import { EMPTY_VENUE, venueKey, type EventCandidate, type EventImportOrigin, type ImportedOccurrence, type ImportedVenue } from "./types";
import type { PageControl } from "./attendance";
import type { SanitizedAi } from "./ai";

export const PASTE_MAX_CHARS = 60_000;
export const PASTE_MIN_CHARS = 12;
const MAX_LINES = 400;
const TITLE_MAX = 200;

export interface TextExtraction {
  candidate: EventCandidate;
  /** Non-empty lines (attendance / privacy wording evidence). */
  lines: string[];
  /** Explicit links in the text with the words written next to them. */
  controls: PageControl[];
  yearHint: number | null;
  unresolvedRanges: number;
  truncated: boolean;
  /** Two or more separately named, separately dated Events — never merged. */
  multipleEvents: boolean;
}

const LABEL = /^(date|dates|when|time|times|hours|where|location|venue|place|address)\s*[:\-–]\s*/i;
const PLACE_LABEL = /^(where|location|venue|place|address)\s*[:\-–]\s*/i;
const URL_RE = /https?:\/\/[^\s<>"'()[\]]+/gi;
const STREET = /^\d{1,6}[A-Za-z]?(?:-\d{1,6})?\s+(?:[A-Za-z0-9.'-]+\s+){0,6}?(?:st|street|ave|avenue|av|blvd|boulevard|rd|road|pl|place|dr|drive|ln|lane|way|sq|square|pkwy|parkway|ct|court|ter|terrace|hwy|highway|plaza|broadway|bowery)\b\.?/i;
const CITY_LINE = /^([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Za-z][A-Za-z .]{1,20}?)\.?(?:\s+(\d{5}(?:-\d{4})?))?$/;
const DATE_START = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?(?:\d{1,2}\/\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2})/i;
const ORGANIZER = /\b(?:[Oo]rgani[sz]ed|[Hh]osted|[Pp]resented|[Pp]roduced)\s+by\s+(?:the\s+)?([A-Z0-9@][^.,;!?\n()]{1,58})/;
const PICTO = /^[\p{Extended_Pictographic}\uFE0F\u200D\s•*·#|]+|[\p{Extended_Pictographic}\uFE0F\u200D\s|]+$/gu;

/** NFKC, one space, invisible characters removed; empty lines kept (they
 * separate blocks). */
function toLines(text: string): string[] {
  return text
    .normalize("NFKC")
    .replace(/\r\n?|\u2028|\u2029/g, "\n")
    .split("\n")
    .slice(0, MAX_LINES)
    .map((l) => l.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "").replace(/\s+/g, " ").trim());
}

const stripLabel = (l: string) => l.replace(LABEL, "");
const hasDate = (l: string) => DATE_START.test(stripLabel(l));
const words = (l: string) => l.split(/\s+/).filter(Boolean);

/** "541 W 25th St, New York, NY 10001" / "541 W 25th St" → parts. */
function streetParts(line: string): { address: string; city: string | null; state: string | null; postalCode: string | null } | null {
  const l = line.replace(PLACE_LABEL, "");
  if (!STREET.test(l) || l.length > 140) return null;
  const parts = l.split(/,\s*/);
  const address = cleanText(parts[0], 200);
  if (!address) return null;
  const tail = parts.slice(1).join(", ");
  const geo = tail ? cityLine(tail) : null;
  return { address, city: geo?.city ?? null, state: geo?.state ?? null, postalCode: geo?.postalCode ?? null };
}

/** "New York, NY 10001" / "Brooklyn, New York" → city/state/postal. */
function cityLine(line: string): { city: string; state: string; postalCode: string | null } | null {
  const m = CITY_LINE.exec(line.trim());
  if (!m) return null;
  const state = usStateCode(m[2]);
  const city = cleanText(m[1], 80);
  return state && city ? { city, state, postalCode: m[3] ?? null } : null;
}

const isUrlLine = (l: string) => /https?:\/\//i.test(l);

/** A line that reads like an Event name: short, not a date / time /
 * address / link, not a sentence. */
function titleLike(line: string): boolean {
  const l = line.replace(PICTO, "").trim();
  if (!l || l.length > TITLE_MAX || words(l).length > 16 || !/[a-z]/i.test(l)) return false;
  if (hasDate(l) || parseTimes(l) || STREET.test(l) || cityLine(l) || /https?:\/\//i.test(l) || LABEL.test(l)) return false;
  if (/[.!?]$/.test(l) && words(l).length > 8) return false;
  return true;
}

/** Explicit links with the words next to them ("RSVP: https://…",
 * "Get tickets at https://…") — the same control shape a web page gives
 * the attendance reader. Only https links are kept downstream. */
function linkControls(lines: string[]): PageControl[] {
  const out: PageControl[] = [];
  for (const line of lines) {
    for (const m of line.match(URL_RE) ?? []) {
      const href = m.replace(/[.,;:!?]+$/, "");
      const text = line
        .replace(m, " ")
        .replace(/\s+/g, " ")
        .replace(/\s*(?:here|at|via|on|:|-|–|—|→|>|\|)+\s*$/i, "")
        .replace(/[:\-–—|→>]+\s*$/, "")
        .trim();
      if (text.length <= 60) out.push({ text, href });
      if (out.length >= 40) return out;
    }
  }
  return out;
}

/** Deterministic reading of pasted text (or the text visible in an image). */
export function extractTextEventCandidate(text: string, opts: { now: number; origin: Exclude<EventImportOrigin, "link"> }): TextExtraction {
  const raw = toLines(text.slice(0, PASTE_MAX_CHARS));
  const lines = raw.filter(Boolean);
  const yearHint = yearHintFrom(lines);
  const ctx = { now: opts.now, yearHint };
  const used = new Set<number>(); // indices into raw, consumed as structured facts

  // Name: the first line, when it reads like one.
  const firstIdx = raw.findIndex(Boolean);
  let title: string | null = null;
  if (firstIdx >= 0 && titleLike(raw[firstIdx])) {
    title = cleanText(raw[firstIdx].replace(PICTO, "").trim(), TITLE_MAX);
    if (title) used.add(firstIdx);
  }

  // Schedule: a date line and the time on the next line read as one entry.
  const scheduleLines: string[] = [];
  const scheduleIdx: number[][] = [];
  for (let i = 0; i < raw.length; i++) {
    const line = stripLabel(raw[i]);
    if (!line || used.has(i)) continue;
    if (!hasDate(line)) continue;
    let j = i + 1;
    while (j < raw.length && !raw[j]) j++;
    const next = j < raw.length ? stripLabel(raw[j]) : "";
    if (bareDate(line, ctx) && next && !hasDate(next) && parseTimes(next) && !STREET.test(next)) {
      scheduleLines.push(`${line} · ${next}`);
      scheduleIdx.push([i, j]);
      i = j;
    } else {
      scheduleLines.push(line);
      scheduleIdx.push([i]);
    }
  }
  const schedule = parseScheduleLines(scheduleLines, ctx);
  let occurrences: ImportedOccurrence[] = schedule.occurrences;
  // A date on its own line ("OCT 15") is still the Event's date — with no
  // time unless one is written in a form Findmi can read.
  if (occurrences.length === 0) {
    const days = new Set<string>();
    scheduleLines.forEach((l, k) => {
      const d = bareDate(l.split(" · ")[0], ctx);
      if (d) {
        days.add(d);
        scheduleIdx[k].forEach((x) => used.add(x));
      }
    });
    occurrences = [...days].sort().map((d) => ({ start: d, end: null, hasTime: false, venue: { ...EMPTY_VENUE }, evidence: null }));
  } else {
    const evidence = new Set(schedule.occurrences.flatMap((o) => (o.evidence ?? "").split("\n")));
    scheduleLines.forEach((l, k) => {
      if (evidence.has(l)) scheduleIdx[k].forEach((x) => used.add(x));
    });
  }

  // Place: a street address line (+ a "City, ST" line after it), the venue
  // name on a "Venue:/Where:" line or the short line right above the address.
  const place: ImportedVenue = { ...EMPTY_VENUE };
  for (let i = 0; i < raw.length; i++) {
    const street = raw[i] && !used.has(i) ? streetParts(raw[i]) : null;
    if (!street) continue;
    used.add(i);
    Object.assign(place, { address: street.address, city: street.city, state: street.state, postalCode: street.postalCode });
    let j = i + 1;
    while (j < raw.length && !raw[j]) j++;
    const geo = !place.city && j < raw.length ? cityLine(raw[j]) : null;
    if (geo) {
      Object.assign(place, { city: geo.city, state: geo.state, postalCode: geo.postalCode });
      used.add(j);
    }
    let k = i - 1;
    while (k >= 0 && !raw[k]) k--;
    const above = k >= 0 && !used.has(k) ? raw[k].replace(PLACE_LABEL, "").replace(PICTO, "").trim() : "";
    if (above && titleLike(above) && words(above).length <= 6 && !/[.!?:]$/.test(above)) {
      place.name = cleanText(above, 160);
      used.add(k);
    }
    break;
  }
  if (!place.name) {
    const k = raw.findIndex((l, i) => !used.has(i) && PLACE_LABEL.test(l) && !STREET.test(l.replace(PLACE_LABEL, "")));
    if (k >= 0) {
      const value = raw[k].replace(PLACE_LABEL, "").trim();
      const geo = cityLine(value);
      if (geo && !place.city) Object.assign(place, { city: geo.city, state: geo.state, postalCode: geo.postalCode });
      else if (!geo && titleLike(value)) place.name = cleanText(value, 160);
      used.add(k);
    }
  }
  const hasPlace = Boolean(venueKey(place) || place.city);
  // Dates without their own place happen at the Event's stated place.
  occurrences = dedupeOccurrences(occurrences.map((o) => (venueKey(o.venue) || o.venue.city || !hasPlace ? o : { ...o, venue: { ...place } }))).slice(0, SCHEDULE_MAX_OCCURRENCES);

  // Organizer: only when the text says so ("hosted by …").
  let organizer: string | null = null;
  for (const l of lines) {
    const m = ORGANIZER.exec(l);
    if (m) {
      const who = cleanText(m[1].replace(/\s+(?:and|&)\s*$/i, "").trim(), 160);
      if (who && words(who).length <= 6) organizer = who;
      break;
    }
  }

  // Links with attendance words are attendance evidence; their lines are
  // not description.
  const controls = linkControls(lines);
  raw.forEach((l, i) => {
    if (l && isUrlLine(l) && controls.some((c) => c.href && l.includes(c.href) && c.text.length <= 30)) used.add(i);
  });

  // Description: everything not consumed above, paragraphs kept.
  const rest = raw.map((l, i) => (used.has(i) ? null : l)).filter((l): l is string => l !== null);
  const restText = cleanEventDescription(rest.join("\n"));
  const description = restText && restText.length >= 20 ? restText : null;

  const sources: EventCandidate["sources"] = {};
  if (title) sources.title = "page";
  if (description) sources.description = "page";
  if (occurrences.length > 0) sources.dates = "page";
  if (hasPlace) sources.venue = "page";
  if (organizer) sources.organizer = "page";

  return {
    candidate: {
      title,
      description,
      imageUrl: null,
      sourceUrl: "",
      platform: null,
      origin: opts.origin,
      occurrences,
      place: occurrences.length === 0 && hasPlace ? place : undefined,
      online: false,
      organizer,
      sources,
    },
    lines,
    controls,
    yearHint,
    unresolvedRanges: schedule.unresolvedRanges,
    truncated: schedule.truncated,
    multipleEvents: detectMultipleEvents(raw, ctx),
  };
}

/** Two or more blocks that each open with their own Event name (3+ words —
 * not a tour's "NYC" / "Los Angeles" stop header) and carry their own date,
 * under different names. One Event's several dates are not multiple. */
export function detectMultipleEvents(raw: string[], ctx: { now: number; yearHint: number | null }): boolean {
  const titles = new Set<string>();
  let block: string[] = [];
  const close = () => {
    if (block.length >= 2 && titleLike(block[0]) && words(block[0]).length >= 3 && block.slice(1).some((l) => hasDate(l) || bareDate(l, ctx))) {
      titles.add(block[0].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
    }
    block = [];
  };
  for (const l of raw) {
    if (l) block.push(l);
    else close();
  }
  close();
  return titles.size >= 2;
}

/** Does the deterministic reading leave anything the grounded AI reading
 * may fill? (name, a date, a time, the place / venue name) */
export function needsTextAssist(candidate: EventCandidate, hiddenLocation: boolean): boolean {
  if (!candidate.title || candidate.occurrences.length === 0) return true;
  if (candidate.occurrences.every((o) => !o.hasTime)) return true;
  if (hiddenLocation) return false;
  const venues = candidate.occurrences.map((o) => o.venue);
  return !venues.some((v) => v.name);
}

const sameText = (a: string | null, b: string | null) => (a ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "") === (b ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Fills ONLY what the deterministic reading left empty, from an AI reading
 * already sanitized against the same text (./ai.ts sanitizeEventAiOutput). */
export function mergeTextAi(candidate: EventCandidate, ai: SanitizedAi | null): EventCandidate {
  if (!ai) return candidate;
  const next: EventCandidate = { ...candidate, occurrences: [...candidate.occurrences], sources: { ...candidate.sources } };
  if (!next.title && ai.title) {
    next.title = ai.title;
    next.sources.title = "ai";
  }
  const aiPlace = ai.venue.name || ai.venue.address || ai.venue.city ? ai.venue : null;
  if (next.occurrences.length === 0 && ai.occurrences.length > 0) {
    const fallback = next.place ?? null;
    next.occurrences = ai.occurrences.map((o) => (venueKey(o.venue) || o.venue.city || !fallback ? o : { ...o, venue: { ...fallback } }));
    next.place = undefined;
    next.sources.dates = "ai";
  } else if (next.occurrences.length > 0 && next.occurrences.every((o) => !o.hasTime)) {
    // Date-only lines ("OCT 15" / "12–8"): the AI's times are used only for
    // the SAME dates, each quoted from the text.
    const days = new Set(next.occurrences.map((o) => o.start));
    const timed = ai.occurrences.filter((o) => o.hasTime);
    const timedDays = new Set(timed.map((o) => new Date(o.start).toLocaleDateString("en-CA", { timeZone: "America/New_York" })));
    if (timed.length > 0 && [...timedDays].every((d) => days.has(d)) && [...days].every((d) => timedDays.has(d))) {
      const byDay = new Map(next.occurrences.map((o) => [o.start, o.venue] as const));
      next.occurrences = timed.map((o) => {
        const own = byDay.get(new Date(o.start).toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
        return venueKey(o.venue) || o.venue.city || !own ? o : { ...o, venue: own };
      });
      next.sources.dates = "ai";
    }
  }
  if (aiPlace) {
    const fill = (v: ImportedVenue): ImportedVenue => {
      if (!venueKey(v) && !v.city) return { ...aiPlace };
      // Same place (or the text gave no street): complete the missing parts.
      if (v.address && aiPlace.address && !sameText(v.address, aiPlace.address)) return v;
      return {
        name: v.name ?? aiPlace.name,
        address: v.address ?? aiPlace.address,
        city: v.city ?? aiPlace.city,
        state: v.state ?? aiPlace.state,
        postalCode: v.postalCode ?? aiPlace.postalCode,
      };
    };
    const before = JSON.stringify([next.occurrences.map((o) => o.venue), next.place]);
    if (next.occurrences.length > 0) next.occurrences = next.occurrences.map((o) => ({ ...o, venue: fill(o.venue) }));
    else next.place = fill(next.place ?? { ...EMPTY_VENUE });
    if (JSON.stringify([next.occurrences.map((o) => o.venue), next.place]) !== before) next.sources.venue = "ai";
  }
  if (!next.organizer && ai.organizer) {
    next.organizer = ai.organizer;
    next.sources.organizer = "ai";
  }
  return next;
}
