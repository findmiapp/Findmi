import "server-only";
import { getAdminSupabase } from "./supabase-admin";
import type { AppearanceDraft } from "./appearance-import";
import { localDateTimeToIso } from "./form-helpers";

// Appearance Import — deterministic, non-AI matching. Deliberately NOT
// another Claude call: "never automatically force a match" and "weak
// matches should not be silently selected" are much easier to guarantee
// (and to reason about/tune) with a plain scoring function over real,
// already-fetched rows than by trusting a second model call's judgment.
// Both functions here only ever read existing events/appearances — they
// never create, modify, or suggest fabricating either.

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Fraction of the shorter string's significant (>2 char) words that also
 * appear in the other string — a simple, explainable overlap score rather
 * than a black-box similarity library. */
function wordOverlapScore(a: string, b: string): number {
  const wa = new Set(normalize(a).split(" ").filter((w) => w.length > 2));
  const wb = new Set(normalize(b).split(" ").filter((w) => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

function isValidDraftDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00`).getTime());
}

/** Compares a draft's plain YYYY-MM-DD (intended as America/New_York) to a
 * stored timestamptz by converting the timestamp to its own NY calendar
 * date first — the same convention lib/format.ts already renders every
 * date in. */
function sameCalendarDate(draftDate: string, isoTimestamp: string): boolean {
  const other = new Date(isoTimestamp).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return draftDate === other;
}

// ---------------------------------------------------------------------
// Event matching — "may optionally link to an existing Event if FindMi
// already has a convincing matching Event." Never creates or references
// an Event that doesn't already exist.
// ---------------------------------------------------------------------

export interface EventMatchCandidate {
  id: string;
  name: string;
  venue_name: string | null;
  city: string | null;
  start_at: string;
  confidence: "strong" | "weak";
}

const STRONG_MATCH_THRESHOLD = 0.6;
const WEAK_MATCH_THRESHOLD = 0.35;

// ── Existing-Event matching (Corgi conversion quality repair) ──────────
// Same calendar day is a GATE, never points: two different Events at the
// same venue on the same day (Spooktober Movie Night vs QSBS at Corgi Cafe)
// must not look like one Event. Identity comes from the TITLE; venue and
// city only support it. A strong match therefore needs real title overlap
// on the same day, and starts more than 3 hours apart cap it at weak.
// (An exact source link is separate, stronger evidence — checked by the
// Event Import / conversion paths themselves, unchanged.)

/** Filler words that carry no Event identity. */
const TITLE_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "your", "our", "you", "this", "that", "are", "all", "into",
  "presented", "hosted", "featuring", "feat", "edition", "event", "events", "night", "day", "nyc", "new", "york",
]);
function titleWords(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((w) => w.length > 2 && !TITLE_STOPWORDS.has(w)));
}
/** Share of the shorter title's identity words found in the other title. */
export function titleOverlapScore(a: string, b: string): number {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

/** Title evidence needed before a fuzzy candidate may be strong / offered at all. */
const STRONG_TITLE_MIN = 0.6;
const WEAK_TITLE_MIN = 0.34;
/** Starts further apart than this can never be a strong match. */
const MAX_STRONG_START_GAP_MS = 3 * 60 * 60 * 1000;

export interface EventMatchInput {
  title: string;
  /** YYYY-MM-DD, America/New_York. */
  date: string;
  /** Exact start when known (ISO), for the time-separation check. */
  startIso?: string | null;
  venue_name?: string | null;
  city?: string | null;
}
type EventRow = { id: string; name: string; venue_name: string | null; city: string | null; start_at: string };

/** Pure scoring of one candidate Event (null = not even a weak match). */
export function scoreEventMatch(input: EventMatchInput, event: EventRow): { score: number; confidence: "strong" | "weak" } | null {
  if (!isValidDraftDate(input.date) || !sameCalendarDate(input.date, event.start_at)) return null;
  const title = titleOverlapScore(input.title, event.name);
  if (title < WEAK_TITLE_MIN) return null; // same day + place alone is never identity
  let score = title * 0.8;
  if (input.venue_name && event.venue_name) score += wordOverlapScore(input.venue_name, event.venue_name) * 0.1;
  if (input.city && event.city && normalize(input.city) === normalize(event.city)) score += 0.1;
  if (score < WEAK_MATCH_THRESHOLD) return null;
  let strong = title >= STRONG_TITLE_MIN && score >= STRONG_MATCH_THRESHOLD;
  const start = input.startIso ? Date.parse(input.startIso) : NaN;
  if (strong && Number.isFinite(start) && Math.abs(start - Date.parse(event.start_at)) > MAX_STRONG_START_GAP_MS) strong = false;
  return { score, confidence: strong ? "strong" : "weak" };
}

/** Best candidate among already-fetched Events (pure; exported for tests). */
export function bestEventMatch(input: EventMatchInput, events: EventRow[]): EventMatchCandidate | null {
  let best: { event: EventRow; score: number; confidence: "strong" | "weak" } | null = null;
  for (const event of events) {
    const s = scoreEventMatch(input, event);
    if (!s) continue;
    const better = !best || (s.confidence === "strong" && best.confidence !== "strong") || (s.confidence === best.confidence && s.score > best.score);
    if (better) best = { event, ...s };
  }
  if (!best) return null;
  return { id: best.event.id, name: best.event.name, venue_name: best.event.venue_name, city: best.event.city, start_at: best.event.start_at, confidence: best.confidence };
}

/** A draft's exact start (NY wall time → ISO), when it has one. */
function draftStartIso(draft: AppearanceDraft): string | null {
  const time = (draft as { start_time?: string | null }).start_time;
  if (!time || !/^\d{2}:\d{2}$/.test(time) || !isValidDraftDate(draft.date)) return null;
  return localDateTimeToIso(`${draft.date}T${time}`);
}

/** One batched query across every draft's date range (not one query per
 * draft), scored in memory by scoreEventMatch. */
export async function findEventMatches(drafts: AppearanceDraft[]): Promise<(EventMatchCandidate | null)[]> {
  const supabase = getAdminSupabase();
  const validDates = drafts.map((d) => d.date).filter(isValidDraftDate);
  if (!supabase || validDates.length === 0) return drafts.map(() => null);

  const min = validDates.reduce((a, b) => (a < b ? a : b));
  const max = validDates.reduce((a, b) => (a > b ? a : b));
  const bufferMs = 2 * 24 * 60 * 60 * 1000; // generous slack so timezone rounding never clips a real same-day event
  const rangeStartIso = new Date(new Date(`${min}T00:00:00Z`).getTime() - bufferMs).toISOString();
  const rangeEndIso = new Date(new Date(`${max}T23:59:59Z`).getTime() + bufferMs).toISOString();

  const { data: events } = await supabase
    .from("events")
    .select("id, name, venue_name, city, start_at")
    .eq("is_demo", false)
    .gte("start_at", rangeStartIso)
    .lte("start_at", rangeEndIso);

  return drafts.map((draft) =>
    events?.length
      ? bestEventMatch({ title: draft.title, date: draft.date, startIso: draftStartIso(draft), venue_name: draft.venue_name, city: draft.city }, events as EventRow[])
      : null
  );
}

// ---------------------------------------------------------------------
// Duplicate detection — scoped to the selected business's own existing
// appearances only (never cross-business). Never overwrites anything;
// callers use this purely to decide the row's default selected state and
// what to show the admin.
// ---------------------------------------------------------------------

export interface DuplicateCandidate {
  id: string;
  title: string;
  venue_name: string | null;
  start_at: string;
  confidence: "strong" | "weak";
}

export async function findDuplicateMatches(businessId: string, drafts: AppearanceDraft[]): Promise<(DuplicateCandidate | null)[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return drafts.map(() => null);

  const { data: existing } = await supabase
    .from("appearances")
    .select("id, title, venue_name, start_at")
    .eq("business_id", businessId)
    .neq("status", "canceled");

  return drafts.map((draft) => {
    if (!isValidDraftDate(draft.date) || !existing?.length) return null;
    let best: { row: (typeof existing)[number]; score: number } | null = null;
    for (const row of existing) {
      if (!sameCalendarDate(draft.date, row.start_at)) continue;
      const score = wordOverlapScore(`${draft.title} ${draft.venue_name ?? ""}`, `${row.title} ${row.venue_name ?? ""}`);
      if (!best || score > best.score) best = { row, score };
    }
    if (!best || best.score < WEAK_MATCH_THRESHOLD) return null;
    return {
      id: best.row.id,
      title: best.row.title,
      venue_name: best.row.venue_name,
      start_at: best.row.start_at,
      confidence: best.score >= STRONG_MATCH_THRESHOLD ? "strong" : "weak",
    };
  });
}
