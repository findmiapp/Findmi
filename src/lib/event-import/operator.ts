// Admin Event Import — the OPERATOR context of the one Event Import engine.
// Findmi Admin imports public third-party Events for discovery: there is no
// initiating Business, so every result is reviewed in the several-Events
// Review (one row per Event, each with its OWN Business), and each Event is
// saved as a participating-style source Event (no host) — see
// persistDiscoveryEvent. Pure; no I/O.
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
  hints: Pick<StructuredEventHints, "category" | "subcategory" | "formats">,
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
  return { categoryId: child?.id ?? categoryAsChild?.id ?? parent?.id ?? null, formatIds, unresolved };
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
