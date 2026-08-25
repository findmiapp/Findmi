import "server-only";
import { getAdminSupabase } from "./supabase-admin";
import type { AppearanceDraft } from "./appearance-import";

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

/** One batched query across every draft's date range (not one query per
 * draft), scored in memory. Returns a match only when there's a
 * same-calendar-day event with real title/venue/city overlap — same day
 * alone is not enough (score baseline is deliberately below the weak
 * threshold on its own). */
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

  return drafts.map((draft) => {
    if (!isValidDraftDate(draft.date) || !events?.length) return null;
    let best: { event: (typeof events)[number]; score: number } | null = null;
    for (const event of events) {
      if (!sameCalendarDate(draft.date, event.start_at)) continue;
      let score = 0.5; // same calendar day
      score += wordOverlapScore(`${draft.title} ${draft.venue_name ?? ""}`, `${event.name} ${event.venue_name ?? ""}`) * 0.4;
      if (draft.city && event.city && normalize(draft.city) === normalize(event.city)) score += 0.1;
      if (!best || score > best.score) best = { event, score };
    }
    if (!best || best.score < WEAK_MATCH_THRESHOLD) return null;
    return {
      id: best.event.id,
      name: best.event.name,
      venue_name: best.event.venue_name,
      city: best.event.city,
      start_at: best.event.start_at,
      confidence: best.score >= STRONG_MATCH_THRESHOLD ? "strong" : "weak",
    };
  });
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
