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
// The ONE structured reader for every Event Import entry point (Admin
// single + bulk, Business Manager hosting + participating — Findmi
// Consolidation pass): any paste whose fields are LABELED ("Event name:",
// "Dates:", "Venue:", "Brand:" …, case-insensitive, many variants) is read
// here deterministically. Explicit values are authoritative: labels are
// stripped, each value goes to its own field, and nothing is rediscovered
// by the AI step. A value that can't be read is left empty for Review with
// a note — never guessed. Partial dates ("Open through Nov 29, 2026") and
// weekly hours ("Monday–Saturday: 10–7") are kept as a TemporalReading
// (./temporal.ts) rather than dropped. Unlabeled prose never comes here.
import { cleanText, usStateCode } from "../brand-website-extract";
import { cleanEventDescription } from "./description";
import { cleanOccurrenceDetails } from "./occurrence-details";
import { dedupeOccurrences, explicitDateList, occurrenceFor, parseTimes, placeFrom, yearHintFrom, SCHEDULE_MAX_OCCURRENCES } from "./schedule";
import { expandWeeklySchedule, readPartialDates, readTimezone, readWeeklyHours, unresolvedBounds, type TemporalReading } from "./temporal";
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
  | "register"
  | "tickets"
  | "programming"
  | "image"
  | "instagram"
  | "eventType"
  | "admission"
  | "timezone"
  | "street2";

const FIELDS: Record<string, Field> = {
  "event name": "title",
  "event title": "title",
  name: "title",
  title: "title",
  "primary business": "business",
  business: "business",
  "business name": "business",
  brand: "business",
  "brand name": "business",
  brands: "business",
  host: "business",
  "hosted by": "business",
  "host business": "business",
  "presented by": "business",
  website: "businessWebsite",
  "brand site": "businessWebsite",
  "business site": "businessWebsite",
  "official website": "businessWebsite",
  instagram: "instagram",
  "instagram url": "instagram",
  "instagram handle": "instagram",
  ig: "instagram",
  "event type": "eventType",
  type: "eventType",
  "type of event": "eventType",
  "event category": "eventType",
  admission: "admission",
  "admission/rsvp": "admission",
  "admission/tickets": "admission",
  "admission/registration": "admission",
  cost: "admission",
  price: "admission",
  pricing: "admission",
  "time zone": "timezone",
  timezone: "timezone",
  tz: "timezone",
  source: "sourceUrl",
  "source article": "sourceUrl",
  article: "sourceUrl",
  "event details": "eventLink",
  "event details link": "eventLink",
  "more info": "eventLink",
  "more information": "eventLink",
  "info link": "eventLink",
  when: "date",
  "event date": "date",
  "event dates": "date",
  where: "location",
  "venue address": "street",
  "location address": "street",
  "address line 1": "street",
  "address 1": "street",
  "address line 2": "street2",
  "address 2": "street2",
  suite: "street2",
  "suite/unit": "street2",
  unit: "street2",
  "business website": "businessWebsite",
  "brand website": "businessWebsite",
  "featured brand": "featured",
  "featured brands": "featured",
  "participating businesses": "participating",
  "participating business": "participating",
  organizer: "organizer",
  organiser: "organizer",
  // The Event's own creative (flyer / hero) — an explicit, https-only URL.
  // Never a Business logo or a venue photo: the operator supplies it.
  "event image": "image",
  "event image url": "image",
  "event flyer": "image",
  "flyer": "image",
  "flyer url": "image",
  "hero image": "image",
  "event link": "eventLink",
  "event url": "eventLink",
  "event page": "eventLink",
  "event website": "eventLink",
  "event site": "eventLink",
  link: "eventLink",
  url: "eventLink",
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
  "event hours": "time",
  "opening hours": "time",
  category: "category",
  subcategory: "subcategory",
  format: "formats",
  formats: "formats",
  // Attendance links. The label decides the button's wording: RSVP vs
  // Register (registration / sign-up / reservation) vs Get Tickets.
  rsvp: "rsvp",
  "rsvp url": "rsvp",
  "rsvp link": "rsvp",
  "rsvp page": "rsvp",
  register: "register",
  "register url": "register",
  "register link": "register",
  registration: "register",
  "registration url": "register",
  "registration link": "register",
  "registration page": "register",
  "sign up": "register",
  signup: "register",
  "sign up link": "register",
  "sign up url": "register",
  reservation: "register",
  reservations: "register",
  "reservation link": "register",
  "reservation url": "register",
  reserve: "register",
  tickets: "tickets",
  ticket: "tickets",
  "ticket url": "tickets",
  "tickets url": "tickets",
  "ticket link": "tickets",
  "tickets link": "tickets",
  "ticket page": "tickets",
  "get tickets": "tickets",
  "buy tickets": "tickets",
  programming: "programming",
  details: "programming",
};
/** Fields whose value may continue on the following unlabeled lines. */
const MULTILINE = new Set<Field>(["description", "programming", "time", "date"]);

// A label: words plus the separators people actually type ("Admission /
// RSVP", "Suite/Unit", "Brand's Website").
const LABEL_LINE = /^([A-Za-z][A-Za-z0-9 /&'’.-]{0,30}?)\s*:\s*(.*)$/;
const OCCURRENCE_LINE = /^occurrence\s*#?\s*(\d{1,2})\s*:?\s*$/i;
const STRUCTURED_START = /^\s*event\s+(?:name|title)\s*:/im;
const STREET_LIKE = /\d/;
const TITLE_FIELDS = new Set<Field>(["title"]);

const labelKey = (raw: string) => raw.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").replace(/\.$/, "");

/** Does this pasted Event use LABELED fields? "Event Name:" anywhere, or a
 * title label ("Name:", "Title:") plus at least two other recognized
 * labels — so a plain sentence containing a colon never qualifies. */
export function isStructuredEvent(text: string): boolean {
  if (STRUCTURED_START.test(text)) return true;
  let title = false;
  let labeled = 0;
  for (const line of text.split(/\r?\n/).slice(0, 200)) {
    const m = LABEL_LINE.exec(line.trim());
    const f = m ? FIELDS[labelKey(m[1])] : undefined;
    if (!f) continue;
    labeled++;
    if (TITLE_FIELDS.has(f) && m![2].trim()) title = true;
  }
  return title && labeled >= 3;
}

/** "DUA by AB, Dua Lipa's skincare brand developed with …" → "DUA by AB":
 * a Brand / Host field often carries a description after its name. */
export function businessNameFromEvidence(value: string | null): string | null {
  if (!value) return null;
  const head = value.split(/\s*(?:,|\s[–—-]\s|\(|;|\|)\s*/)[0]?.trim() ?? "";
  return cleanText(head.length >= 2 ? head : value, 160);
}

interface Block {
  values: Partial<Record<Field, string[]>>;
}

function field(line: string): { field: Field; value: string } | null {
  const m = LABEL_LINE.exec(line);
  if (!m) return null;
  const f = FIELDS[labelKey(m[1])];
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

/** "410 West 13th Street, New York, NY 10014" → its parts, or null when it
 * isn't written that way (left whole — never guessed). */
export function splitUsAddress(value: string | null): { street: string; city: string; state: string; postalCode: string | null } | null {
  if (!value) return null;
  const m = /^(.+?\d.+?),\s*([A-Za-z .'-]{2,40}),\s*([A-Za-z .]{2,20}?)\s*(\d{5}(?:-\d{4})?)?\s*(?:,\s*(?:USA|US|United States))?$/i.exec(value.trim());
  if (!m) return null;
  const state = usStateCode(m[3].trim());
  if (!state) return null;
  return { street: cleanText(m[1], 200)!, city: cleanText(m[2], 80)!, state, postalCode: m[4] ?? null };
}

/** "@duabyab" / "instagram.com/duabyab" / a full link → the profile URL. */
function instagramUrl(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  const handle = /^@?([A-Za-z0-9._]{1,30})$/.exec(v)?.[1] ?? /instagram\.com\/([A-Za-z0-9._]{1,30})/i.exec(v)?.[1];
  return handle ? `https://www.instagram.com/${handle}/` : null;
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
  // A one-line US address ("410 West 13th Street, New York, NY 10014") is
  // split into its parts so Location matching sees street / city / state /
  // ZIP — explicit City / State / ZIP fields still win.
  const oneLine = splitUsAddress(first(b, "street"));
  venue.address = oneLine?.street ?? cleanText(first(b, "street"), 200) ?? venue.address;
  venue.city = cleanText(first(b, "city"), 80) ?? oneLine?.city ?? null;
  const state = first(b, "state");
  venue.state = state ? (usStateCode(state) ?? cleanText(state, 40)) : (oneLine?.state ?? null);
  const zip = first(b, "zip");
  venue.postalCode = zip && /^[A-Za-z0-9 -]{3,12}$/.test(zip) ? zip : (oneLine?.postalCode ?? null);
  const line2 = cleanText(first(b, "street2"), 120);
  if (line2) venue.addressLine2 = line2;
  const site = websiteOrNull(first(b, "locationWebsite"));
  if (site) venue.website = site;
  return venue;
}

type Times = NonNullable<ReturnType<typeof parseTimes>>;

/** The non-empty lines of a block's Time / Hours field (it may span lines). */
const timeLines = (b: Block) => (b.values.time ?? []).map((l) => l.trim()).filter(Boolean);

/** A block's explicit time: "Time: 11 AM – 6 PM", or Start Time (+ End
 * Time). Weekly hours ("Monday–Saturday: 10–7") are read separately
 * (readWeeklyHours) and never squeezed into one time. */
function timesFrom(b: Block, notes: string[], label: string): Times | null | "unreadable" {
  const lines = timeLines(b);
  if (readWeeklyHours(lines).length > 0) return null;
  const combined = lines[0] ?? null;
  if (combined) {
    const t = parseTimes(combined);
    if (!t) notes.push(`${label}time “${combined}” couldn't be read. Add it in Review.`);
    return t ?? "unreadable";
  }
  const startText = first(b, "start");
  const endText = first(b, "end");
  if (!startText && !endText) return null;
  if (!startText) {
    // An end with no start is never turned into a guessed start.
    notes.push(`${label}an end time was given without a start time, so no time was used. Add the start in Review.`);
    return null;
  }
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
  // Weekly hours (each weekday its own hours) and the stated time zone.
  const weekly = readWeeklyHours(timeLines(event));
  const timezoneText = first(event, "timezone");
  const timezone = readTimezone(timezoneText);
  if (timezoneText && timezone !== "America/New_York") notes.push(`Time zone “${timezoneText}”: Findmi shows times in Eastern Time. Check the times in Review.`);
  const weeklyTimes = (date: string): Times | null => {
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const w = weekly.find((h) => h.days.includes(dow));
    return w ? { startTime: w.startTime, endTime: w.endTime, overnight: w.overnight, span: [0, 0] } : null;
  };
  const addDated = (dates: string[], evidence: string) => {
    for (const d of dates) {
      if (covered.has(d)) continue;
      if (weekly.length > 0) {
        // A day with no hours line is closed — never given invented hours.
        const t = weeklyTimes(d);
        if (t) add([d], t, evidence);
      } else add([d], eventTimes, evidence);
    }
  };

  // Dates: an explicit list / range first; else PARTIAL dates (one known
  // bound — "Open through Nov 29, 2026") kept as a TemporalReading, never
  // reduced to "no date" and never completed with an invented bound.
  const eventDateText = (event.values.date ?? []).map((l) => l.trim()).filter(Boolean).join(" ") || null;
  let temporal: TemporalReading | null = null;
  let truncatedSchedule = false;
  if (eventDateText) {
    const dates = explicitDateList(eventDateText, ctx);
    if (dates) addDated(dates, eventDateText);
    else {
      const partial = readPartialDates(eventDateText, { ...ctx, upcomingYear: true });
      if (!partial) notes.push(`The date “${eventDateText}” couldn't be read. Add the dates in Review.`);
      else {
        temporal = { ...partial, weekly, timezone, unresolved: [], evidence: eventDateText };
        const expanded = expandWeeklySchedule(temporal, SCHEDULE_MAX_OCCURRENCES);
        // Both bounds known → concrete dates now (each weekday with its own
        // hours). One bound only → nothing is invented: the reading (and its
        // weekly hours) waits in Review for the missing bound.
        if (expanded) {
          truncatedSchedule = expanded.truncated;
          addDated(expanded.dates.map((d) => d.date), eventDateText);
        }
        temporal.unresolved = unresolvedBounds(temporal);
      }
    }
  } else if (weekly.length > 0) {
    temporal = { startDate: null, endDate: null, weekly, weekdays: null, timezone, unresolved: ["start", "end"], evidence: timeLines(event).join("; ") };
  }
  if (truncatedSchedule) notes.push(`This schedule has more than ${SCHEDULE_MAX_OCCURRENCES} dates. The first ${SCHEDULE_MAX_OCCURRENCES} were added; add the rest in Event Manager.`);
  const finalOccurrences = dedupeOccurrences(occurrences).slice(0, SCHEDULE_MAX_OCCURRENCES);

  // Links: Event Link and Source URL are the same Event column
  // (events.external_url, Review's "Event Link"); RSVP / Ticket URLs are
  // attendance evidence for the existing reader.
  // "Event details: …" written as prose (not a link) is programming text.
  const eventLinkText = first(event, "eventLink");
  if (eventLinkText && !/^https?:\/\//i.test(eventLinkText) && !/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(eventLinkText)) {
    (event.values.programming ??= []).push(eventLinkText);
    event.values.eventLink = [];
  }
  const eventLink = httpsUrl(first(event, "eventLink") ?? null) ?? websiteOrNull(first(event, "eventLink"));
  const sourceLink = httpsUrl(first(event, "sourceUrl"));
  for (const [f, value] of [["eventLink", first(event, "eventLink")], ["sourceUrl", first(event, "sourceUrl")], ["rsvp", first(event, "rsvp")], ["register", first(event, "register")], ["tickets", first(event, "tickets")]] as const) {
    if (value && !httpsUrl(value)) notes.push(`${f === "rsvp" ? "RSVP URL" : f === "register" ? "Registration URL" : f === "tickets" ? "Ticket URL" : f === "eventLink" ? "Event Link" : "Source URL"} isn't a full https link, so it wasn't used.`);
  }
  if (eventLink && sourceLink && eventLink !== sourceLink) notes.push("Findmi keeps one link per Event: the Event Link is used and the different Source URL isn't saved.");
  const controls: PageControl[] = [];
  const rsvp = httpsUrl(first(event, "rsvp"));
  const register = httpsUrl(first(event, "register"));
  const tickets = httpsUrl(first(event, "tickets"));
  if (tickets) controls.push({ text: "Get Tickets", href: tickets });
  if (rsvp) controls.push({ text: "RSVP", href: rsvp });
  else if (register) controls.push({ text: "Register", href: register });
  // The pasted links themselves, kept apart (an RSVP and a Ticket link are
  // different actions; neither is ever taken from the Event Link).
  const links = { rsvp: rsvp ? { cta: "rsvp" as const, url: rsvp } : register ? { cta: "register" as const, url: register } : null, tickets: tickets ?? null };

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
  if (finalOccurrences.length > 0 || temporal) sources.dates = "page";
  if (hasPlace) sources.venue = "page";
  if (organizer) sources.organizer = "page";
  const eventImageText = first(event, "image");
  const eventImage = httpsUrl(eventImageText);
  if (eventImageText && !eventImage) notes.push("Event Image isn't a full https link, so it wasn't used.");
  if (eventImage) sources.image = "page";

  return {
    candidate: {
      title,
      description,
      imageUrl: eventImage,
      sourceUrl: eventLink ?? sourceLink ?? "",
      platform: null,
      origin: "text",
      occurrences: finalOccurrences,
      place: finalOccurrences.length === 0 && hasPlace ? venue : undefined,
      // Partial dates / weekly hours that couldn't (yet) become dates.
      ...(temporal && temporal.unresolved.length > 0 ? { temporal } : {}),
      online: false,
      organizer,
      sources,
      structured: {
        ...(links.rsvp || links.tickets ? { links } : {}),
        // "Brand: DUA by AB, Dua Lipa's skincare brand …" → "DUA by AB"; the
        // full statement stays as evidence.
        business: businessNameFromEvidence(first(event, "business")),
        ...(first(event, "business") && businessNameFromEvidence(first(event, "business")) !== cleanText(first(event, "business"), 160) ? { businessEvidence: cleanText(first(event, "business"), 300) } : {}),
        businessWebsite: httpsUrl(first(event, "businessWebsite")) ?? websiteOrNull(first(event, "businessWebsite")),
        ...(instagramUrl(first(event, "instagram")) ? { instagram: instagramUrl(first(event, "instagram")) } : {}),
        ...(first(event, "eventType") ? { eventType: cleanText(first(event, "eventType"), 200) } : {}),
        // Admission / RSVP prose is evidence only — never read as "free".
        ...(first(event, "admission") && !httpsUrl(first(event, "admission")) ? { admission: cleanText(all(event, "admission"), 300) } : {}),
        ...(timezone ? { timezone } : {}),
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
