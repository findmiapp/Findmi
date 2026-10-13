// Event Import V1 — the optional AI step. Runs ONLY when deterministic
// extraction (./extract.ts) left the title, date or place missing, and
// only ever fills fields that are still empty. Every value it returns is
// checked against the page text it was given: a title or venue the page
// doesn't contain, or a date in an impossible shape, is dropped. Missing
// stays missing — the Business completes it in Review.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { cleanText, usStateCode } from "../brand-website-extract";
import { normalizeDateValue, EVENT_TITLE_MAX } from "./extract";
import type { EventCandidate, ImportedDate } from "./types";

export const EVENT_AI_TIMEOUT_MS = 15_000;
const DEFAULT_MODEL = "claude-opus-5-5";
/** ANTHROPIC_EVENT_IMPORT_MODEL is an optional server-only override. */
function getModel(): string {
  return process.env.ANTHROPIC_EVENT_IMPORT_MODEL?.trim() || DEFAULT_MODEL;
}

export const EVENT_AI_SYSTEM_PROMPT = `You read the text of one public event web page and report the event's facts so a business owner can review them before anything is saved.

Report only what the page text states. If a fact is not stated, return null for it — never estimate, infer or fill in a likely value. Dates and times must be copied from the page, written as ISO 8601: "YYYY-MM-DD" when only a date is given, "YYYY-MM-DDTHH:MM" for a local time without a stated zone, or with an offset when the page states one. If the page lists several dates for the same event, return each one. If the page is not about a single event, return null for every field.`;

const DateSchema = z.object({ start: z.string(), end: z.string().nullable() });
export const EventAiSchema = z.object({
  title: z.string().nullable(),
  dates: z.array(DateSchema),
  venue_name: z.string().nullable(),
  street_address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postal_code: z.string().nullable(),
  organizer: z.string().nullable(),
});
export type EventAiOutput = z.infer<typeof EventAiSchema>;

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

/** Validates AI output against the page text; returns only safe values. */
export function sanitizeEventAiOutput(raw: EventAiOutput | null | undefined, pageText: string): {
  title: string | null;
  dates: ImportedDate[];
  venue: { name: string | null; address: string | null; city: string | null; state: string | null; postalCode: string | null };
  organizer: string | null;
} {
  const empty = { title: null, dates: [], venue: { name: null, address: null, city: null, state: null, postalCode: null }, organizer: null };
  if (!raw) return empty;
  const keep = (v: string | null, max: number) => {
    const c = cleanText(v, max);
    return c && evidenced(c, pageText) ? c : null;
  };
  const dates: ImportedDate[] = [];
  for (const d of raw.dates.slice(0, 12)) {
    const start = normalizeDateValue(d.start);
    if (!start) continue;
    const end = d.end ? normalizeDateValue(d.end) : null;
    dates.push({ start: start.iso, end: end && end.hasTime === start.hasTime ? end.iso : null, hasTime: start.hasTime });
  }
  const postal = cleanText(raw.postal_code, 12);
  return {
    title: keep(raw.title, EVENT_TITLE_MAX),
    dates,
    venue: {
      name: keep(raw.venue_name, 160),
      address: keep(raw.street_address, 200),
      city: keep(raw.city, 80),
      state: usStateCode(raw.state) ?? keep(raw.state, 40),
      postalCode: postal && /^[A-Za-z0-9 -]{3,12}$/.test(postal) && pageText.includes(postal) ? postal : null,
    },
    organizer: keep(raw.organizer, 160),
  };
}

/** Fills ONLY the candidate's missing fields from one structured call.
 * Never throws; returns the candidate unchanged when AI is unavailable or
 * fails. */
export async function assistWithAi(
  candidate: EventCandidate,
  excerpt: string,
  client: EventAiClient | null = defaultEventAiClient()
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
    const ai = sanitizeEventAiOutput(response.parsed_output, excerpt);
    const next: EventCandidate = { ...candidate, venue: { ...candidate.venue }, sources: { ...candidate.sources } };
    if (!next.title && ai.title) {
      next.title = ai.title;
      next.sources.title = "ai";
    }
    if (next.dates.length === 0 && ai.dates.length > 0) {
      next.dates = ai.dates;
      next.sources.dates = "ai";
    }
    if (!next.venue.name && !next.venue.address && (ai.venue.name || ai.venue.address || ai.venue.city)) {
      next.venue = ai.venue;
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
