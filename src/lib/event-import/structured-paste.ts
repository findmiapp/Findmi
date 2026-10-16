// Admin Event Import — STRUCTURED field syntax (pure; no network, no AI).
//
//   Event Name: Good American NYC Pop-Up
//   Primary Business: Good American
//   Event Link: https://…
//   Dates: October 15–18, 2026
//   Start Time: 11:00 AM
//   End Time: 6:00 PM
//   Location Name: … / Street Address: … / City: … / State: … / ZIP: …
//   Category: … / Subcategory: … / Formats: …, …
//   RSVP URL: … / Ticket URL: …
//   Occurrence 1:            (optional — its own Date / Start Time / End Time / Programming)
//
// Used only by Admin Event Import, and only when a block opens its fields
// with "Event Name:". Explicit values are authoritative: labels are
// stripped, each value goes to its own field, and nothing is rediscovered
// by the AI step. A value that can't be read is left empty for Review with
// a note — never guessed. Ordinary Paste Details never comes here.
import { cleanText, usStateCode } from "../brand-website-extract";
import { cleanEventDescription } from "./description";
import { cleanOccurrenceDetails } from "./occurrence-details";
import { dedupeOccurrences, explicitDateList, occurrenceFor, parseTimes, placeFrom, yearHintFrom, SCHEDULE_MAX_OCCURRENCES } from "./schedule";
import { EMPTY_VENUE, venueKey, type EventCandidate, type ImportedOccurrence, type ImportedVenue, type StructuredEventHints } from "./types";
import type { PageControl } from "./attendance";
import type { TextExtraction } from "./text-source";

type Field =
  | "title"
  | "business"
  | "businessWebsite"
  | "featured"
  | "participating"
  | "organizer"
  | "eventLink"
  | "sourceUrl"
  | "description"
  | "location"
  | "locationName"
  | "locationWebsite"
  | "street"
  | "city"
  | "state"
  | "zip"
  | "date"
  | "start"
  | "end"
  | "time"
  | "category"
  | "subcategory"
  | "formats"
  | "rsvp"
  | "tickets"
  | "programming";

const FIELDS: Record<string, Field> = {
  "event name": "title",
  "event title": "title",
  "primary business": "business",
  business: "business",
  "business website": "businessWebsite",
  "brand website": "businessWebsite",
  "featured brand": "featured",
  "featured brands": "featured",
  "participating businesses": "participating",
  "participating business": "participating",
  organizer: "organizer",
  organiser: "organizer",
  "event link": "eventLink",
  "event url": "eventLink",
  "source url": "sourceUrl",
  "source link": "sourceUrl",
  description: "description",
  location: "location",
  "location name": "locationName",
  venue: "locationName",
  "venue name": "locationName",
  "location website": "locationWebsite",
  "venue website": "locationWebsite",
  "street address": "street",
  address: "street",
  city: "city",
  state: "state",
  zip: "zip",
  "zip code": "zip",
  "postal code": "zip",
  date: "date",
  dates: "date",
  "start time": "start",
  "end time": "end",
  time: "time",
  times: "time",
  hours: "time",
  category: "category",
  subcategory: "subcategory",
  format: "formats",
  formats: "formats",
  "rsvp url": "rsvp",
  "rsvp link": "rsvp",
  "ticket url": "tickets",
  "tickets url": "tickets",
  "ticket link": "tickets",
  programming: "programming",
  details: "programming",
};
/** Fields whose value may continue on the following unlabeled lines. */
const MULTILINE = new Set<Field>(["description", "programming"]);

const LABEL_LINE = /^([A-Za-z][A-Za-z ]{0,24}?)\s*:\s*(.*)$/;
const OCCURRENCE_LINE = /^occurrence\s*#?\s*(\d{1,2})\s*:?\s*$/i;
const STRUCTURED_START = /^\s*event\s+(?:name|title)\s*:/im;
const STREET_LIKE = /\d/;

/** Does this pasted Event use the structured field syntax? */
export function isStructuredEvent(text: string): boolean {
  return STRUCTURED_START.test(text);
}

interface Block {
  values: Partial<Record<Field, string[]>>;
}

function field(line: string): { field: Field; value: string } | null {
  const m = LABEL_LINE.exec(line);
  if (!m) return null;
  const f = FIELDS[m[1].trim().toLowerCase().replace(/\s+/g, " ")];
  return f ? { field: f, value: m[2].trim() } : null;
}

const first = (b: Block, f: Field) => (b.values[f]?.[0] ?? "").trim() || null;
const all = (b: Block, f: Field) => (b.values[f] ?? []).join("\n").trim() || null;

function httpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "knix.com" → "https://knix.com/" (a Business website may be written bare). */
function websiteOrNull(value: string | null): string | null {
  if (!value || /\s/.test(value.trim()) || !/\.[a-z]{2,}/i.test(value)) return null;
  return httpsUrl(/^https?:\/\//i.test(value.trim()) ? value.trim().replace(/^http:/i, "https:") : `https://${value.trim()}`);
}

const PLACE_FIELDS: Field[] = ["location", "locationName", "street", "city", "state", "zip"];
const blockHasPlace = (b: Block) => PLACE_FIELDS.some((f) => first(b, f));

/** An Occurrence's details (shared cleaner — ./occurrence-details.ts). */
const cleanDetails = (value: string | null) => cleanOccurrenceDetails(value);

function venueFrom(b: Block): ImportedVenue {
  const venue: ImportedVenue = { ...EMPTY_VENUE };
  const location = first(b, "location");
  // "Location:" is a place name, or "Name, 123 Street …" when it carries an address.
  if (location) {
    const parsed = STREET_LIKE.test(location) ? placeFrom(location) : null;
    venue.name = parsed?.name ?? cleanText(location, 160);
    venue.address = parsed?.address ?? null;
  }
  venue.name = cleanText(first(b, "locationName"), 160) ?? venue.name;
  venue.address = cleanText(first(b, "street"), 200) ?? venue.address;
  venue.city = cleanText(first(b, "city"), 80);
  const state = first(b, "state");
  venue.state = state ? (usStateCode(state) ?? cleanText(state, 40)) : null;
  const zip = first(b, "zip");
  venue.postalCode = zip && /^[A-Za-z0-9 -]{3,12}$/.test(zip) ? zip : null;
  const site = websiteOrNull(first(b, "locationWebsite"));
  if (site) venue.website = site;
  return venue;
}

type Times = NonNullable<ReturnType<typeof parseTimes>>;

/** A block's explicit time: "Time: 11 AM – 6 PM", or Start Time (+ End Time). */
function timesFrom(b: Block, notes: string[], label: string): Times | null | "unreadable" {
  const combined = first(b, "time");
  if (combined) {
    const t = parseTimes(combined);
    if (!t) notes.push(`${label}time “${combined}” couldn't be read. Add it in Review.`);
    return t ?? "unreadable";
  }
  const startText = first(b, "start");
  const endText = first(b, "end");
  if (!startText && !endText) return null;
  const s = startText ? parseTimes(startText) : null;
  const e = endText ? parseTimes(endText) : null;
  if (!s || (endText && !e)) {
    notes.push(`${label}start or end time couldn't be read. Add it in Review.`);
    return "unreadable";
  }
  const endTime = e ? (e.endTime ?? e.startTime) : (s.endTime ?? null);
  return { startTime: s.startTime, endTime, overnight: Boolean(endTime && endTime < s.startTime), span: [0, 0] };
}

/** Structured block → the same TextExtraction the free-text reader gives
 * (so attendance, privacy, matching and Review are unchanged), with the
 * structured-only hints on the candidate. Null when not structured. */
export function extractStructuredEvent(text: string, opts: { now: number }): (TextExtraction & { candidate: EventCandidate & { structured: StructuredEventHints } }) | null {
  if (!isStructuredEvent(text)) return null;
  const lines = text
    .normalize("NFKC")
    .replace(/\r\n?|\u2028|\u2029/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "").replace(/[ \t]+/g, " ").trim());

  const event: Block = { values: {} };
  const occurrenceBlocks: { number: number; block: Block }[] = [];
  const unknown = new Set<string>();
  let current: Block = event;
  let open: Field | null = null;
  for (const line of lines) {
    if (!line) {
      if (open && MULTILINE.has(open)) (current.values[open] ??= []).push("");
      continue;
    }
    const occ = OCCURRENCE_LINE.exec(line);
    if (occ) {
      current = { values: {} };
      occurrenceBlocks.push({ number: Number(occ[1]), block: current });
      open = null;
      continue;
    }
    const f = field(line);
    if (f) {
      (current.values[f.field] ??= []).push(f.value);
      open = f.field;
      continue;
    }
    if (open && MULTILINE.has(open)) {
      current.values[open]!.push(line);
      continue;
    }
    const label = LABEL_LINE.exec(line)?.[1];
    unknown.add(label ? `“${label.trim()}”` : `“${line.slice(0, 40)}”`);
  }

  const notes: string[] = [];
  const yearHint = yearHintFrom(lines.filter(Boolean));
  const ctx = { now: opts.now, yearHint };
  const venue = venueFrom(event);
  const hasPlace = Boolean(venueKey(venue) || venue.city);

  // Dates: each Occurrence block on its own; event-level Dates add any day
  // the blocks don't cover. Times: the block's own, else the Event's.
  const eventTimes = timesFrom(event, notes, "");
  const occurrences: ImportedOccurrence[] = [];
  const add = (dates: string[], times: Times | null | "unreadable", evidence: string, place: ImportedVenue = venue, details: string | null = null) => {
    for (const d of dates) {
      const o = occurrenceFor(d, times && times !== "unreadable" ? times : null, { ...place }, evidence);
      if (o) occurrences.push(details ? { ...o, details } : o);
    }
  };
  const covered = new Set<string>();
  for (const { number, block } of occurrenceBlocks) {
    const label = `Occurrence ${number}: `;
    const dateText = first(block, "date");
    const dates = dateText ? explicitDateList(dateText, ctx) : null;
    if (!dateText) notes.push(`Occurrence ${number} has no date. Add it in Review.`);
    else if (!dates) notes.push(`Occurrence ${number} date “${dateText}” couldn't be read. Add it in Review.`);
    if (!dates) continue;
    const own = timesFrom(block, notes, label);
    // Place precedence: this Occurrence's own explicit place, else the
    // Event-level place. A block that names its place never takes the
    // Event's (only a missing city / state is completed from it).
    const ownPlace = blockHasPlace(block) ? venueFrom(block) : null;
    // Location Website: an Occurrence's own wins for it; the Event-level one
    // applies only to Occurrences at the Event-level place.
    const ownSite = websiteOrNull(first(block, "locationWebsite"));
    const place = ownPlace ? (!ownPlace.city && !ownPlace.state ? { ...ownPlace, city: venue.city, state: venue.state } : ownPlace) : ownSite ? { ...venue, website: ownSite } : venue;
    add(dates, own ?? eventTimes, dateText!, place, cleanDetails(all(block, "programming")));
    dates.forEach((d) => covered.add(d));
  }
  const eventDateText = first(event, "date");
  if (eventDateText) {
    const dates = explicitDateList(eventDateText, ctx);
    if (!dates) notes.push(`The date “${eventDateText}” couldn't be read. Add the dates in Review.`);
    else add(dates.filter((d) => !covered.has(d)), eventTimes, eventDateText);
  }
  const finalOccurrences = dedupeOccurrences(occurrences).slice(0, SCHEDULE_MAX_OCCURRENCES);

  // Links: Event Link and Source URL are the same Event column
  // (events.external_url, Review's "Event Link"); RSVP / Ticket URLs are
  // attendance evidence for the existing reader.
  const eventLink = httpsUrl(first(event, "eventLink"));
  const sourceLink = httpsUrl(first(event, "sourceUrl"));
  for (const [f, value] of [["eventLink", first(event, "eventLink")], ["sourceUrl", first(event, "sourceUrl")], ["rsvp", first(event, "rsvp")], ["tickets", first(event, "tickets")]] as const) {
    if (value && !httpsUrl(value)) notes.push(`${f === "rsvp" ? "RSVP URL" : f === "tickets" ? "Ticket URL" : f === "eventLink" ? "Event Link" : "Source URL"} isn't a full https link, so it wasn't used.`);
  }
  if (eventLink && sourceLink && eventLink !== sourceLink) notes.push("Findmi keeps one link per Event: the Event Link is used and the different Source URL isn't saved.");
  const controls: PageControl[] = [];
  const rsvp = httpsUrl(first(event, "rsvp"));
  const tickets = httpsUrl(first(event, "tickets"));
  if (tickets) controls.push({ text: "Get Tickets", href: tickets });
  if (rsvp) controls.push({ text: "RSVP", href: rsvp });

  // Programming: an Occurrence block's own Programming / Details is THAT
  // date's details (event_occurrences.details, above). Event-level
  // programming belongs to no single date, so it is kept as Review evidence
  // only ("Not Currently Saved To Findmi"). Neither ever feeds a date,
  // time, place, organizer or name.
  const programmingEvidence: StructuredEventHints["programming"] = [];
  const eventProgramming = all(event, "programming");
  if (eventProgramming) programmingEvidence.push({ label: "Event", text: eventProgramming });
  const programming = [eventProgramming, ...occurrenceBlocks.map((o) => all(o.block, "programming"))].filter((t): t is string => Boolean(t));
  if (eventProgramming) notes.push("Event-level Programming isn't saved — put it under each Occurrence (saved with that date), or in the Description.");
  if (unknown.size > 0) notes.push(`Not read: ${[...unknown].slice(0, 5).join(", ")}.`);

  const title = cleanText(first(event, "title"), 200);
  const description = cleanEventDescription(all(event, "description"));
  const organizer = cleanText(first(event, "organizer"), 160);
  const formats = (event.values.formats ?? [])
    .flatMap((v) => v.split(/[,;|]/))
    .map((v) => v.trim())
    .filter(Boolean);

  const sources: EventCandidate["sources"] = {};
  if (title) sources.title = "page";
  if (description) sources.description = "page";
  if (finalOccurrences.length > 0) sources.dates = "page";
  if (hasPlace) sources.venue = "page";
  if (organizer) sources.organizer = "page";

  return {
    candidate: {
      title,
      description,
      imageUrl: null,
      sourceUrl: eventLink ?? sourceLink ?? "",
      platform: null,
      origin: "text",
      occurrences: finalOccurrences,
      place: finalOccurrences.length === 0 && hasPlace ? venue : undefined,
      online: false,
      organizer,
      sources,
      structured: {
        business: cleanText(first(event, "business"), 160),
        businessWebsite: httpsUrl(first(event, "businessWebsite")) ?? websiteOrNull(first(event, "businessWebsite")),
        otherBusinesses: [...(event.values.featured ?? []), ...(event.values.participating ?? [])]
          .flatMap((v) => v.split(/[,;|]/))
          .map((v) => cleanText(v.trim(), 160))
          .filter((v): v is string => Boolean(v))
          .slice(0, 12),
        programming: programmingEvidence,
        category: cleanText(first(event, "category"), 80),
        subcategory: cleanText(first(event, "subcategory"), 80),
        formats,
        notes,
      },
    },
    // Attendance / privacy wording: the Event's own descriptive text.
    lines: [description ?? "", ...programming.map(String)].flatMap((t) => t.split("\n")).filter(Boolean),
    controls,
    yearHint,
    unresolvedRanges: 0,
    truncated: occurrences.length > SCHEDULE_MAX_OCCURRENCES,
    multipleEvents: false,
  };
}
