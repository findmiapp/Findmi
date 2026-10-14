// Event Import V1 — the optional AI step. Runs ONLY when deterministic
// extraction (./extract.ts) left the title, date or place missing, and
// only ever fills fields that are still empty. V1B: the schedule comes back
// as grouped entries quoting their page lines, so a date can't be paired
// with another line's time or place. Every value it returns is
// checked against the page text it was given: a title or venue the page
// doesn't contain, or a date in an impossible shape, is dropped. Missing
// stays missing — the Business completes it in Review.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { cleanText, usStateCode } from "../brand-website-extract";
import { localDateTimeToIso } from "../admin/form-helpers";
import { EVENT_TITLE_MAX } from "./extract";
import { addDays, dedupeOccurrences, parseScheduleLines, SCHEDULE_MAX_OCCURRENCES, type ScheduleContext } from "./schedule";
import { EMPTY_VENUE, venueKey, type EventCandidate, type ImportedOccurrence, type ImportedVenue } from "./types";

export const EVENT_AI_TIMEOUT_MS = 15_000;
const DEFAULT_MODEL = "claude-opus-5-5";
/** ANTHROPIC_EVENT_IMPORT_MODEL is an optional server-only override. */
function getModel(): string {
  return process.env.ANTHROPIC_EVENT_IMPORT_MODEL?.trim() || DEFAULT_MODEL;
}

export const EVENT_AI_SYSTEM_PROMPT = `You read the text of one public event web page and report the event's facts so a business owner can review them before anything is saved.

Report only what the page text states. If a fact is not stated, return null for it — never estimate, infer or fill in a likely value. If the page is not about a single event, return null for every field and an empty schedule.

Schedule: return one entry per schedule line on the page, keeping each date together with the time and place written with it — never pair a date with a time or place from a different line. For each entry, copy the exact line(s) it comes from into "evidence". For a single date, give "date" as YYYY-MM-DD and times as 24-hour HH:MM. For a recurring schedule (a date range limited to certain weekdays, e.g. "9/25–10/31, 6pm–12am — MSG" followed by "Wednesdays, Fridays and Saturdays only"), return ONE entry whose evidence contains those lines exactly as written and leave "date" null; do not list the individual dates.

Organizer: only a person or organization the page explicitly calls the organizer, host or presenter ("organized by", "hosted by", "presented by", "produced by"). A brand that is featured, sampled or sponsoring is not the organizer unless the page says so. Copy the phrase that says so into "organizer_evidence".`;

const ScheduleEntrySchema = z.object({
  evidence: z.string(),
  date: z.string().nullable(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  venue_name: z.string().nullable(),
  street_address: z.string().nullable(),
});
export const EventAiSchema = z.object({
  title: z.string().nullable(),
  schedule: z.array(ScheduleEntrySchema),
  venue_name: z.string().nullable(),
  street_address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postal_code: z.string().nullable(),
  organizer: z.string().nullable(),
  organizer_evidence: z.string().nullable(),
});
export type EventAiOutput = z.infer<typeof EventAiSchema>;

// ── Paste Details / Upload ─────────────────────────────────────────────
// The same grounded extraction, for text a Business pasted or an image it
// uploaded. Same schema (plus a multiple-Events flag, and for an image the
// visible text it was read from); same sanitizer — every value must be
// evidenced by the text (for an image: by the text visible in it), or it is
// dropped. How people get in and whether the address is public are never
// read here: those stay evidence-only (the deterministic reader) on the text.
export const EVENT_AI_EVIDENCE_PROMPT = `You read details about ONE event that a business owner pasted (a social post caption, an email, a newsletter, a press release, copied website text, a text message) or uploaded as an image (a flyer, an invitation, a screenshot), and report the event's facts so they can review them before anything is saved.

Report only what the material states. If a fact is not stated, return null for it — never estimate, infer or fill in a likely value. Do not invent an organizer, host, address, link or date.

Schedule: return one entry per schedule line, keeping each date together with the time and place written with it — never pair a date with a time or place from a different line. For each entry, copy the exact line(s) it comes from into "evidence". For a single date, give "date" as YYYY-MM-DD and times as 24-hour HH:MM. For a recurring schedule, return ONE entry whose evidence contains those lines exactly as written and leave "date" null.

Organizer: only a person or organization the material explicitly calls the organizer, host or presenter ("organized by", "hosted by", "presented by", "produced by"). A brand that is featured, named in the title, sampled or sponsoring is not the organizer unless the material says so. Copy the phrase that says so into "organizer_evidence".

Multiple events: set "multiple_events" to true only when the material describes two or more SEPARATE events (different event names). One event with several dates or stops is one event.`;

export const EVENT_AI_IMAGE_INSTRUCTIONS = `This is an image. First copy every piece of event-related text visible in it into "visible_text", one line per visual line, exactly as written (keep its spelling and capitalization). Every other value you return must be supported by that visible text — the evidence lines must be copied from it.`;

export const EventAiTextSchema = EventAiSchema.extend({ multiple_events: z.boolean() });
export const EventAiImageSchema = EventAiTextSchema.extend({ visible_text: z.string() });
export type EventAiTextOutput = z.infer<typeof EventAiTextSchema>;
export type EventAiImageOutput = z.infer<typeof EventAiImageSchema>;
export const EVENT_AI_IMAGE_TIMEOUT_MS = 30_000;
const VISIBLE_TEXT_MAX = 12_000;

export type EventImportImageMediaType = "image/jpeg" | "image/png" | "image/webp";

/** The narrow client surface used here (injectable for tests). */
export interface EventAiClient {
  messages: { parse: Anthropic["messages"]["parse"] };
}

let cachedClient: Anthropic | null = null;
export function defaultEventAiClient(): EventAiClient | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^a-z0-9]+/g, " ").trim();

/** True when most of `value`'s words appear in the page text. */
function evidenced(value: string, pageText: string): boolean {
  const words = norm(value).split(" ").filter((w) => w.length > 2);
  if (words.length === 0) return false;
  const page = ` ${norm(pageText)} `;
  const hits = words.filter((w) => page.includes(` ${w} `)).length;
  return hits / words.length >= 0.75;
}

/** The page itself names `name` as organizer / host / presenter. A brand
 * that is merely prominent (in the title, sampled, sponsoring) is not. */
export function organizerEvidenced(name: string, pageText: string): boolean {
  const who = norm(name);
  if (!who) return false;
  const esc = who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const page = ` ${norm(pageText)} `;
  return new RegExp(
    ` (?:(?:organized|organised|hosted|presented|produced|curated|thrown|put on|brought to you) by|(?:organizer|organiser|host|hosts|presenter)(?: is)?) (?:the )?${esc} `
  ).test(page);
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** The evidence line really mentions this calendar date. */
function mentionsDate(evidence: string, date: string): boolean {
  const [, m, d] = date.split("-").map(Number);
  const t = evidence.toLowerCase();
  return new RegExp(`(^|[^\\d])${m}/0?${d}([^\\d]|$)|${MONTH_NAMES[m - 1]}[a-z]*\\.?\\s+0?${d}([^\\d]|$)`).test(t);
}
/** The evidence line states this HH:MM time (as "6pm", "6:30", "18:00", "noon" …). */
function mentionsTime(evidence: string, hhmm: string): boolean {
  const [h, m] = hhmm.split(":").map(Number);
  const t = evidence.toLowerCase();
  if (h === 12 && m === 0 && /noon/.test(t)) return true;
  if (h === 0 && m === 0 && /midnight/.test(t)) return true;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(m).padStart(2, "0");
  return new RegExp(`(^|[^\\d])(${h12}|${String(h).padStart(2, "0")}|${h})${m ? `:${mm}` : "(:00)?"}([^\\d]|$)`).test(t);
}

export interface SanitizedAi {
  title: string | null;
  occurrences: ImportedOccurrence[];
  venue: ImportedVenue;
  organizer: string | null;
}

/** Validates AI output against the page text; returns only safe values.
 * Schedule entries must quote real page lines; those lines are re-read by
 * the deterministic schedule parser (so a recurrence is expanded by Findmi,
 * not by the model), and a single-date entry is kept only when its quoted
 * line states that date — and its time only when the line states it. */
export function sanitizeEventAiOutput(raw: EventAiOutput | null | undefined, pageText: string, ctx: ScheduleContext = { now: Date.now(), yearHint: null }): SanitizedAi {
  const empty: SanitizedAi = { title: null, occurrences: [], venue: { ...EMPTY_VENUE }, organizer: null };
  if (!raw) return empty;
  const keep = (v: string | null, max: number, against = pageText) => {
    const c = cleanText(v, max);
    return c && evidenced(c, against) ? c : null;
  };
  const page = ` ${norm(pageText)} `;
  const occurrences: ImportedOccurrence[] = [];
  for (const entry of (raw.schedule ?? []).slice(0, 80)) {
    const lines = (entry.evidence ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 4);
    if (lines.length === 0 || !lines.every((l) => norm(l) && page.includes(` ${norm(l)} `))) continue;
    const evidence = lines.join("\n");
    const aiVenue = { ...EMPTY_VENUE, name: keep(entry.venue_name, 160, evidence), address: keep(entry.street_address, 200, evidence) };
    const parsed = parseScheduleLines(lines, ctx).occurrences;
    if (parsed.length > 0) {
      for (const o of parsed) occurrences.push(venueKey(o.venue) ? o : { ...o, venue: aiVenue });
      continue;
    }
    if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !mentionsDate(evidence, entry.date)) continue;
    const start = entry.start_time && /^\d{2}:\d{2}$/.test(entry.start_time) && mentionsTime(evidence, entry.start_time) ? entry.start_time : null;
    const end = start && entry.end_time && /^\d{2}:\d{2}$/.test(entry.end_time) && mentionsTime(evidence, entry.end_time) ? entry.end_time : null;
    const startIso = start ? localDateTimeToIso(`${entry.date}T${start}`) : null;
    if (start && !startIso) continue;
    let endIso: string | null = null;
    if (startIso && end) {
      endIso = localDateTimeToIso(`${start && end < start ? addDays(entry.date, 1) : entry.date}T${end}`);
    }
    occurrences.push(
      startIso
        ? { start: startIso, end: endIso, hasTime: true, venue: aiVenue, evidence }
        : { start: entry.date, end: null, hasTime: false, venue: aiVenue, evidence }
    );
  }
  const postal = cleanText(raw.postal_code, 12);
  const organizer = keep(raw.organizer, 160);
  return {
    title: keep(raw.title, EVENT_TITLE_MAX),
    occurrences: dedupeOccurrences(occurrences).slice(0, SCHEDULE_MAX_OCCURRENCES),
    venue: {
      name: keep(raw.venue_name, 160),
      address: keep(raw.street_address, 200),
      city: keep(raw.city, 80),
      state: usStateCode(raw.state) ?? keep(raw.state, 40),
      postalCode: postal && /^[A-Za-z0-9 -]{3,12}$/.test(postal) && pageText.includes(postal) ? postal : null,
    },
    organizer: organizer && organizerEvidenced(organizer, pageText) ? organizer : null,
  };
}

/** Fills ONLY the candidate's missing fields from one structured call.
 * Never throws; returns the candidate unchanged when AI is unavailable or
 * fails. */
export async function assistWithAi(
  candidate: EventCandidate,
  excerpt: string,
  client: EventAiClient | null = defaultEventAiClient(),
  ctx: ScheduleContext = { now: Date.now(), yearHint: null }
): Promise<{ candidate: EventCandidate; called: boolean }> {
  if (!client || !excerpt.trim()) return { candidate, called: false };
  try {
    const response = await client.messages.parse(
      {
        model: getModel(),
        max_tokens: 4000,
        system: EVENT_AI_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `<page_url>${candidate.sourceUrl}</page_url>\n<page_text>\n${excerpt}\n</page_text>` }],
        output_config: { effort: "low", format: zodOutputFormat(EventAiSchema) },
      },
      { timeout: EVENT_AI_TIMEOUT_MS, maxRetries: 0 }
    );
    if (response.stop_reason === "refusal" || !response.parsed_output) return { candidate, called: true };
    const ai = sanitizeEventAiOutput(response.parsed_output, excerpt, ctx);
    const next: EventCandidate = { ...candidate, occurrences: [...candidate.occurrences], sources: { ...candidate.sources } };
    if (!next.title && ai.title) {
      next.title = ai.title;
      next.sources.title = "ai";
    }
    if (next.occurrences.length === 0 && ai.occurrences.length > 0) {
      next.occurrences = ai.occurrences;
      next.sources.dates = "ai";
    }
    // An event-wide place fills only occurrences that have none.
    const aiPlace = ai.venue.name || ai.venue.address || ai.venue.city ? ai.venue : null;
    if (aiPlace && next.occurrences.some((o) => !venueKey(o.venue) && !o.venue.city)) {
      next.occurrences = next.occurrences.map((o) => (venueKey(o.venue) || o.venue.city ? o : { ...o, venue: aiPlace }));
      next.sources.venue = "ai";
    } else if (!next.sources.venue && next.occurrences.some((o) => venueKey(o.venue)) && next.sources.dates === "ai") {
      next.sources.venue = "ai";
    }
    if (!next.organizer && ai.organizer) {
      next.organizer = ai.organizer;
      next.sources.organizer = "ai";
    }
    return { candidate: next, called: true };
  } catch {
    return { candidate, called: true };
  }
}

/** Paste Details — reads pasted text. Null when AI is unavailable or the
 * call fails (the deterministic reading still stands). Never throws. */
export async function readEventTextWithAi(text: string, client: EventAiClient | null = defaultEventAiClient()): Promise<EventAiTextOutput | null> {
  if (!client || !text.trim()) return null;
  try {
    const response = await client.messages.parse(
      {
        model: getModel(),
        max_tokens: 4000,
        system: EVENT_AI_EVIDENCE_PROMPT,
        messages: [{ role: "user", content: `<pasted_text>\n${text}\n</pasted_text>` }],
        output_config: { effort: "low", format: zodOutputFormat(EventAiTextSchema) },
      },
      { timeout: EVENT_AI_TIMEOUT_MS, maxRetries: 0 }
    );
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    return response.parsed_output as EventAiTextOutput;
  } catch {
    return null;
  }
}

/** Upload — reads an uploaded image (multimodal). Returns the text visible
 * in it (what every other value is checked against) plus the reading, or
 * null when AI is unavailable / fails / the image shows no text. The image
 * is sent for this one reading only — never stored. Never throws. */
export async function readEventImageWithAi(
  image: { mediaType: EventImportImageMediaType; base64: string },
  client: EventAiClient | null = defaultEventAiClient()
): Promise<{ visibleText: string; output: EventAiImageOutput } | null> {
  if (!client || !image.base64) return null;
  try {
    const response = await client.messages.parse(
      {
        model: getModel(),
        max_tokens: 6000,
        system: EVENT_AI_EVIDENCE_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
              { type: "text", text: EVENT_AI_IMAGE_INSTRUCTIONS },
            ],
          },
        ],
        output_config: { effort: "low", format: zodOutputFormat(EventAiImageSchema) },
      },
      { timeout: EVENT_AI_IMAGE_TIMEOUT_MS, maxRetries: 0 }
    );
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    const output = response.parsed_output as EventAiImageOutput;
    const visibleText = (output.visible_text ?? "").replace(/\r\n?/g, "\n").slice(0, VISIBLE_TEXT_MAX).trim();
    return visibleText ? { visibleText, output } : null;
  } catch {
    return null;
  }
}
