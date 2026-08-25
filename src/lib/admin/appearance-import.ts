import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Appearance Import (admin) — ALL Anthropic-specific code lives in this one
// file on purpose, per the approved plan: "keep the Anthropic-specific
// implementation isolated so we are not spreading provider-specific code
// throughout the application." Everything downstream of
// extractAppearancesFromSource() (the review UI, event/duplicate matching,
// the bulk-create action) works with the plain AppearanceDraft type below
// and has no Anthropic import at all.

// ---------------------------------------------------------------------
// Draft schema — the shape Claude must return, validated with Zod via
// output_config.format (client.messages.parse()) rather than free-form
// prose. This is a TEMPORARY, in-memory shape only — none of it is
// persisted; createAppearancesBulk (appearances/import/actions.ts) maps
// the fields an admin keeps onto the real `appearances` table's existing
// columns.
// ---------------------------------------------------------------------

const AppearanceDraftSchema = z.object({
  title: z
    .string()
    .describe(
      "Short appearance title as it would read on a card, e.g. 'Bread Drop Pick Up' or 'Spooktacular Fair'. Use the business's own wording from the source; do not invent a generic label."
    ),
  date: z.string().describe("The calendar date this single appearance occurs on, as YYYY-MM-DD."),
  start_time: z
    .string()
    .nullable()
    .describe("24-hour HH:MM start time, e.g. '17:00' for 5pm. Null if the source gives no time or says TBD."),
  end_time: z
    .string()
    .nullable()
    .describe("24-hour HH:MM end time. Null if the source gives no end time — never guess one."),
  time_tbd: z.boolean().describe("True if the source explicitly says the time is TBD, or states no time at all."),
  venue_name: z.string().nullable().describe("Venue/market name exactly as written in the source, or null if none is given."),
  address: z.string().nullable().describe("Street address only if the source actually states one — never inferred or guessed."),
  city: z.string().nullable(),
  state: z.string().nullable(),
  notes: z
    .string()
    .nullable()
    .describe("Any other genuinely relevant detail from the source. Never include filler like 'flyer coming soon'."),
  needs_review: z
    .boolean()
    .describe("True if anything about this row is uncertain — ambiguous spelling, unclear date/year, TBD time, or a likely typo."),
  review_reason: z
    .string()
    .nullable()
    .describe(
      "Plain-language reason for needs_review — e.g. 'Source says \"Russellville\" which may be a typo for Rossville — kept as written.' Null when needs_review is false."
    ),
  source_excerpt: z
    .string()
    .describe("The exact original text this row was extracted from, verbatim, for the reviewer to compare against."),
});

export type AppearanceDraft = z.infer<typeof AppearanceDraftSchema>;

const ExtractionSchema = z.object({
  appearances: z.array(AppearanceDraftSchema),
});

// ---------------------------------------------------------------------
// Image input validation — reuses the same concepts as
// lib/admin/upload.ts's uploadImage() (supported MIME types, ~5MB limit,
// a clear HEIC rejection message) WITHOUT writing anything to Supabase
// Storage. Images are decoded to base64, sent to Claude Vision as part of
// one request, and never persisted anywhere — this is intentionally not
// the same function as uploadImage(), which is for permanent public
// media.
// ---------------------------------------------------------------------

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_IMAGES = 6;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function validateImportImage(file: File): string | null {
  const isHeic = /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
  if (isHeic) {
    return `${file.name}: HEIC/HEIF photos aren't supported. On iPhone, Settings → Camera → Formats → "Most Compatible" saves new photos as JPG.`;
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return `${file.name}: only JPG, PNG, GIF, or WEBP images are supported.`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `${file.name}: image must be under 5MB.`;
  }
  return null;
}

export interface ImportImage {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  base64: string;
}

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!isAnthropicConfigured()) return null;
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

// ---------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------

export interface ExtractAppearancesInput {
  businessName: string;
  businessCity: string | null;
  businessState: string | null;
  text: string | null;
  images: ImportImage[];
}

export interface ExtractAppearancesResult {
  drafts: AppearanceDraft[];
  error?: string;
}

function buildSystemPrompt(businessName: string, businessCity: string | null, businessState: string | null): string {
  const todayNY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD
  const todayReadable = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const businessLocation = [businessCity, businessState].filter(Boolean).join(", ");

  return `You extract individual, real-world schedule entries ("appearances") for one business from messy source material — a pasted text message, email, Instagram caption, screenshot, event flyer, or a plain list of dates — and return them as structured data.

Context:
- Today's date is ${todayReadable} (${todayNY}, America/New_York).
- The business is "${businessName}"${businessLocation ? ` (based in ${businessLocation})` : ""}.

Rules — follow all of these exactly:
1. Identify every SEPARATE appearance. A line can contain more than one appearance (e.g. two different dates and events run together in one line) — split those into separate rows.
2. Treat recurring dates (e.g. a weekly bread drop repeated every week) as separate individual rows, one per date — never collapse them into one row or a recurrence rule.
3. Normalize dates to YYYY-MM-DD. Resolve a month/day with no year to the closest real occurrence at or after today (${todayNY}) — if that month/day has already passed this year, use next year instead. Words like "thirtieth" mean the 30th.
4. Normalize recognizable times to 24-hour HH:MM (e.g. "5-6pm" → start_time "17:00", end_time "18:00"). Only set end_time when the source clearly states an end time — otherwise leave it null. Never invent a time. If the source says "time TBD" or gives no time at all, set time_tbd true and leave start_time/end_time null.
5. Extract venue_name/address/city/state only when the source actually supports them. Never fabricate an address, city, state, or any coordinate — leave the field null instead. You may use the business's own city/state (${businessLocation || "not given"}) as a soft hint ONLY when the source is genuinely ambiguous or silent about location — never to override what the source actually says.
6. Never invent, name, or reference a FindMi Event. You are only extracting appearances; a separate step (outside your job) decides whether one might match an existing event.
7. Ignore pure noise like "flyer coming soon" — don't extract it as a field or a fake row.
8. Do NOT silently correct spelling, typos, or uncertain proper nouns (e.g. a venue or event name that looks misspelled or inconsistent with other lines). Keep the source's own wording in the relevant field, and instead set needs_review true with a review_reason explaining what looks uncertain and what it might actually be.
9. Set needs_review true whenever anything is uncertain: TBD time, ambiguous date/year, a likely typo, or missing information a reasonable reader would want confirmed. Leave needs_review false only when you're genuinely confident in every field.
10. Always fill source_excerpt with the exact original text (verbatim) that this row came from, so a human reviewer can compare.
11. If uploaded images are flyers/screenshots, read all visible schedule information from them the same way you would pasted text, following every rule above.

Return only the structured appearances array — no commentary.`;
}

export async function extractAppearancesFromSource(input: ExtractAppearancesInput): Promise<ExtractAppearancesResult> {
  const client = getClient();
  if (!client) {
    return { drafts: [], error: "Anthropic isn't configured on the server (ANTHROPIC_API_KEY is unset)." };
  }
  const hasText = Boolean(input.text?.trim());
  if (!hasText && input.images.length === 0) {
    return { drafts: [], error: "Paste some schedule text or upload at least one image first." };
  }

  const content: Array<
    | { type: "image"; source: { type: "base64"; media_type: ImportImage["mediaType"]; data: string } }
    | { type: "text"; text: string }
  > = input.images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.base64 },
  }));
  content.push({
    type: "text",
    text: hasText ? `Source text:\n\n${input.text!.trim()}` : "No pasted text was provided — read only the attached image(s).",
  });

  try {
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: buildSystemPrompt(input.businessName, input.businessCity, input.businessState),
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(ExtractionSchema) },
    });

    if (!response.parsed_output) {
      return { drafts: [], error: "Claude's response didn't match the expected structure. Try again, or simplify the input." };
    }
    // Defense in depth: Zod already validated the shape inside parse(), but a
    // date that isn't a real calendar date (model error, not a schema
    // violation) should never silently reach the review screen looking
    // trustworthy — flag it instead of dropping it, so the admin still
    // sees and can fix the row.
    const drafts = response.parsed_output.appearances.map((d) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || Number.isNaN(new Date(`${d.date}T00:00:00`).getTime())) {
        return { ...d, needs_review: true, review_reason: `Couldn't confirm this is a valid date ("${d.date}") — please check it.` };
      }
      return d;
    });
    return { drafts };
  } catch (err) {
    // client.messages.parse() throws (rather than returning a null
    // parsed_output) when the response fails schema validation — surface
    // that distinctly from a real network/API error so a retry is the
    // obvious next step either way.
    if (err instanceof Anthropic.APIError) {
      return { drafts: [], error: `Claude API error (${err.status ?? "unknown"}): ${err.message}` };
    }
    if (err instanceof Anthropic.AnthropicError) {
      return { drafts: [], error: "Claude's response didn't match the expected structure. Try again, or simplify the input." };
    }
    return { drafts: [], error: "Unexpected error analyzing the source material. Please try again." };
  }
}
