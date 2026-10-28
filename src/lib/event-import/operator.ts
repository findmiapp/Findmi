// Admin Event Import — the OPERATOR context of the one Event Import engine.
// Findmi Admin imports public third-party Events for discovery: there is no
// initiating Business, so every result is reviewed in the several-Events
// Review (one row per Event, each with its OWN Business), and each Event is
// saved as a participating-style source Event (no host) — see
// persistDiscoveryEvent. Pure; no I/O.
import { attendanceSlots, fromAttendanceSlots } from "./attendance-links";
import { reviewDefaults } from "./review";
import { splitPastedEvents } from "./paste-segments";
import type { EventCandidate, EventImportAnalysis, EventImportMatches, EventImportReview, ImportSource, StructuredEventHints } from "./types";

/** The slice of a canonical Category this needs (kind 'event' / 'event_format'). */
type TaxonomyRow = { id: string; name: string; slug: string; parent_id?: string | null };

/** One analysis → the several-Events shape Review uses. A single Event
 * becomes a one-row list (its warnings shown with the list); failures and
 * several-Events results pass through unchanged. */
export function asOperatorAnalysis(a: EventImportAnalysis, source: ImportSource): EventImportAnalysis {
  if (!a.ok || a.kind === "multi") return a;
  const past = a.candidate.occurrences.length > 0 && a.candidate.occurrences.every((o) => o.past);
  return {
    ok: true,
    kind: "multi",
    source,
    events: [{ key: "event-1", candidate: a.candidate, matches: a.matches, warnings: a.warnings, past, alreadyOnSchedule: null }],
    warnings: a.warnings,
  };
}

/** Initial Review values for an operator import: always a genuine Event
 * (there is no Business schedule to fall back to), never hosted. */
export function operatorReviewDefaults(
  candidate: EventCandidate,
  matches: EventImportMatches,
  taxonomy?: { categories: TaxonomyRow[]; formats: TaxonomyRow[] }
): EventImportReview {
  const base: EventImportReview = { ...reviewDefaults(candidate, matches, "participating", ""), intent: "participating", asEvent: true };
  if (!candidate.structured || !taxonomy) return base;
  const resolved = resolveStructuredTaxonomy(candidate.structured, taxonomy.categories, taxonomy.formats);
  return { ...base, categoryId: resolved.categoryId, formatIds: resolved.formatIds };
}

const norm = (v: string | null | undefined) =>
  (v ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const named = (row: TaxonomyRow, value: string) => norm(row.name) === norm(value) || norm(row.slug) === norm(value);

/** Structured "Category / Subcategory / Formats" → the EXISTING canonical
 * vocabulary (exact name or slug, ignoring case and punctuation). Nothing
 * is created; a value that isn't a Findmi Category / Format stays
 * unresolved (listed) for the operator to choose in Review. */
export function resolveStructuredTaxonomy(
  hints: Pick<StructuredEventHints, "category" | "subcategory" | "formats"> & Partial<Pick<StructuredEventHints, "eventType">>,
  categories: TaxonomyRow[],
  formats: TaxonomyRow[]
): { categoryId: string | null; formatIds: string[]; unresolved: string[] } {
  const unresolved: string[] = [];
  const parents = categories.filter((c) => !c.parent_id);
  const children = categories.filter((c) => c.parent_id);
  const parent = hints.category ? parents.find((c) => named(c, hints.category!)) ?? null : null;
  // "Category:" may itself name a subcategory.
  const categoryAsChild = hints.category && !parent ? children.find((c) => named(c, hints.category!)) ?? null : null;
  if (hints.category && !parent && !categoryAsChild) unresolved.push(`Category “${hints.category}”`);
  const scope = parent ? children.filter((c) => c.parent_id === parent.id) : categoryAsChild ? [] : children;
  const child = hints.subcategory ? scope.find((c) => named(c, hints.subcategory!)) ?? null : null;
  if (hints.subcategory && !child) unresolved.push(`Subcategory “${hints.subcategory}”`);
  const formatIds: string[] = [];
  for (const f of hints.formats) {
    const row = formats.find((r) => named(r, f));
    if (!row) unresolved.push(`Format “${f}”`);
    else if (!formatIds.includes(row.id)) formatIds.push(row.id);
  }
  // "Event type: Beauty and skincare pop-up / product discovery / …" — a
  // canonical Format or Category whose WHOLE name appears in it is
  // suggested (Review shows it, editable). Never adds unresolved noise.
  const typeText = ` ${norm(hints.eventType)} `;
  const appears = (row: TaxonomyRow) => {
    const n = norm(row.name);
    return n.length >= 3 && typeText.includes(` ${n} `);
  };
  if (hints.eventType) {
    for (const row of formats) if (appears(row) && !formatIds.includes(row.id)) formatIds.push(row.id);
  }
  let categoryId = child?.id ?? categoryAsChild?.id ?? parent?.id ?? null;
  if (!categoryId && !hints.category && hints.eventType) {
    const hits = categories.filter(appears);
    // Only an unambiguous single hit (a subcategory wins over its parent).
    const leaf = hits.filter((h) => !hits.some((o) => o.parent_id === h.id));
    if (leaf.length === 1) categoryId = leaf[0].id;
  }
  return { categoryId, formatIds, unresolved };
}

/** Same-Business identity inside one Review batch ("Good American" ≡
 * "good american"): a Business created for one Event is offered to every
 * other Event naming the same Business. */
export function businessEvidenceKey(name: string | null | undefined): string {
  return norm(name).replace(/\b(inc|llc|co|ltd|corp|the)\b/g, " ").replace(/\s+/g, " ").trim();
}

/** The Business an Event's source names (structured "Primary Business:",
 * else its organizer) — the evidence a created Business is matched to. */
export function eventBusinessEvidence(candidate: EventCandidate): string | null {
  return candidate.structured?.business ?? candidate.organizer ?? null;
}

/** The Business suggested for one Event: only the engine's confident,
 * public organizer match (exact name + place) — anything else stays
 * unresolved for the operator to choose. */
export function suggestedEventBusiness(matches: EventImportMatches): { id: string; name: string } | null {
  return matches.organizerBusiness ? { id: matches.organizerBusiness.id, name: matches.organizerBusiness.name } : null;
}

/** Which pasted text each Review row came from, by the key analysis gave
 * it: "pasted-event-n" for marked Events, "event-1" for a single Event. */
export function segmentTextByKey(pasted: string): Map<string, string> {
  const text = pasted.trim();
  const split = splitPastedEvents(text, 12);
  if (split.kind !== "segments") return new Map([["event-1", text]]);
  if (split.segments.length === 1) return new Map([["event-1", split.segments[0].text]]);
  return new Map(split.segments.map((s) => [`pasted-event-${s.number}`, s.text]));
}

/** What THIS Admin Review actually created or updated outside the batch
 * save — recorded at the moment each creation succeeded (a picked existing
 * Business / Location is never counted). */
export interface OperatorSessionStats {
  businessesCreated: number;
  locationsCreated: number;
  existingEventsUpdated: number;
}

/** Import Complete — counts only from real outcomes: the batch save's own
 * results (a new Event only when that save created it), the existing-Event
 * rows that were never sent to it, and the session's recorded creations. */
export function operatorImportSummary(
  results: { outcome: { ok: true; kind: string; newEvent?: boolean } | { ok: false; error: string } }[],
  existingRowCount: number,
  stats: OperatorSessionStats
): { newEvents: number; existingEvents: number; existingEventsUpdated: number; businessesCreated: number; locationsCreated: number; failed: number } {
  return {
    newEvents: results.filter((r) => r.outcome.ok && r.outcome.kind === "scheduled" && r.outcome.newEvent === true).length,
    existingEvents: existingRowCount + results.filter((r) => r.outcome.ok && r.outcome.kind === "already").length,
    existingEventsUpdated: stats.existingEventsUpdated,
    businessesCreated: stats.businessesCreated,
    locationsCreated: stats.locationsCreated,
    failed: results.filter((r) => !r.outcome.ok).length,
  };
}

/** Retry Event Link: what a successful re-read may add to a row the
 * operator may already have edited. ONLY gaps are filled — never an edited
 * or explicit value: an empty description / organizer / RSVP-tickets, the
 * image only when the earlier reading had none (an image the operator
 * removed stays removed), and a missing time on the SAME date. Names,
 * links, dates, places, details, Business, Category and Formats are
 * untouched. */
export function fillReviewGaps(review: EventImportReview, fresh: EventImportReview, opts: { hadImage: boolean }): EventImportReview {
  const next: EventImportReview = { ...review };
  if (!next.description?.trim() && fresh.description) next.description = fresh.description;
  if (!next.organizer?.trim() && fresh.organizer) next.organizer = fresh.organizer;
  // RSVP / Registration and Tickets each fill only their own empty slot.
  const mine = attendanceSlots(review);
  const theirs = attendanceSlots(fresh);
  const slots = { rsvp: mine.rsvp?.url ? mine.rsvp : theirs.rsvp, tickets: mine.tickets ? mine.tickets : theirs.tickets };
  Object.assign(next, fromAttendanceSlots(slots));
  if (!next.imageUrl && !opts.hadImage && fresh.imageUrl) next.imageUrl = fresh.imageUrl;
  // Only a date that is ALONE on its day (in both the edited rows and the
  // fresh reading) can take a fresh time — several Locations sharing a day
  // never inherit one guessed time.
  const count = (list: { date: string }[], date: string) => list.filter((o) => o.date === date).length;
  const freshByDate = new Map(fresh.occurrences.filter((o) => o.startTime && count(fresh.occurrences, o.date) === 1).map((o) => [o.date, o]));
  next.occurrences = review.occurrences.map((o) => {
    const f = o.date && count(review.occurrences, o.date) === 1 ? freshByDate.get(o.date) : undefined;
    return f && !o.startTime && !o.endTime ? { ...o, startTime: f.startTime, endTime: f.endTime } : o;
  });
  return next;
}
