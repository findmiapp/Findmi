// Event matching — the ONE pure rule for "is this probably an Event already
// on Findmi?" while someone types an Event name (manual creation) or
// reviews an import. Scores already-fetched candidates using the context
// at hand: normalized name, the Business, the Location, and date
// proximity. The bounded candidate query (name trigram index, ≤ 20 rows,
// upcoming-ish window) lives with its caller; nothing here does I/O.

export interface EventMatchContext {
  name: string;
  businessId?: string | null;
  locationId?: string | null;
  /** YYYY-MM-DD the person is about to create. */
  date?: string | null;
  city?: string | null;
}

export interface EventCandidateRow {
  id: string;
  name: string;
  slug?: string | null;
  start_at?: string | null;
  start_date?: string | null;
  city?: string | null;
  venue_name?: string | null;
  host_business_id?: string | null;
  /** Locations of the Event's dates, when the caller loaded them. */
  location_ids?: string[];
  /** Businesses taking part (event_businesses), when loaded. */
  business_ids?: string[];
}

export interface RankedEvent<T> {
  row: T;
  score: number;
  /** Plain-language reasons shown next to the suggestion. */
  reasons: string[];
}

export const EVENT_NAME_MIN_CHARS = 3;
export const EVENT_MATCH_SUGGEST_THRESHOLD = 40;

const STOP = new Set(["the", "a", "an", "and", "of", "at", "in", "on", "for", "with", "by", "nyc", "event", "events", "2025", "2026", "2027"]);
export const normalizeEventName = (v: string | null | undefined) =>
  (v ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const tokens = (v: string) => normalizeEventName(v).split(" ").filter((t) => t.length >= 2 && !STOP.has(t));

function dayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
}

/** Ranked likely duplicates, best first; only those worth suggesting. */
export function rankEventCandidates<T extends EventCandidateRow>(ctx: EventMatchContext, rows: readonly T[], limit = 5): RankedEvent<T>[] {
  const q = normalizeEventName(ctx.name);
  if (q.length < EVENT_NAME_MIN_CHARS) return [];
  const qt = tokens(ctx.name);
  const out: RankedEvent<T>[] = [];
  for (const row of rows) {
    const n = normalizeEventName(row.name);
    const rt = tokens(row.name);
    const reasons: string[] = [];
    let score = 0;
    if (n === q) {
      score += 60;
      reasons.push("Same name");
    } else if (n.includes(q) || q.includes(n)) {
      score += 40;
      reasons.push("Similar name");
    } else if (qt.length > 0) {
      const shared = qt.filter((t) => rt.includes(t)).length;
      const overlap = shared / Math.max(qt.length, rt.length, 1);
      if (overlap >= 0.5) {
        score += Math.round(35 * overlap);
        reasons.push("Similar name");
      }
    }
    if (score === 0) continue; // context alone never makes a match
    if (ctx.businessId && (row.host_business_id === ctx.businessId || row.business_ids?.includes(ctx.businessId))) {
      score += 20;
      reasons.push("Your Business is on it");
    }
    if (ctx.locationId && row.location_ids?.includes(ctx.locationId)) {
      score += 15;
      reasons.push("Same Location");
    }
    const when = row.start_date ?? row.start_at ?? null;
    if (ctx.date && when) {
      const d = dayDistance(ctx.date, when);
      if (d <= 1) {
        score += 20;
        reasons.push("Same date");
      } else if (d <= 14) {
        score += 10;
        reasons.push("Close date");
      } else if (d > 120) score -= 15;
    }
    if (ctx.city && row.city && normalizeEventName(ctx.city) === normalizeEventName(row.city)) score += 5;
    if (score >= EVENT_MATCH_SUGGEST_THRESHOLD) out.push({ row, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name)).slice(0, limit);
}

/** The bounded name filter the candidate query uses (trigram-indexed
 * `ilike`), built from the most distinctive word typed. Null below the
 * minimum length — no query runs on every keystroke of a short prefix. */
export function eventNameSearchTerm(name: string): string | null {
  const t = tokens(name).sort((a, b) => b.length - a.length)[0] ?? normalizeEventName(name);
  if (!t || t.length < EVENT_NAME_MIN_CHARS) return null;
  return `%${t.replace(/[%_\\]/g, "")}%`;
}
