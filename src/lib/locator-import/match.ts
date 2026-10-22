import { classifyLocationMatches, locationIdentityIssue, similarLocationNames } from "@/lib/location-import/resolve";
import type { ExistingLocation, LocationEvidence } from "@/lib/location-import/types";
import { normalizeStreetAddress } from "@/lib/locationCreation";
import type { ImportRowData } from "./fields";

/** Locator Import — MATCH BEFORE CREATE for staged rows. Pure: the server
 * hands in what it found (a repeat-import identity, candidate Locations) and
 * this decides the bucket. It reuses the one Location matcher
 * (`classifyLocationMatches`) so a CSV row is judged exactly as an Event
 * Import place or an Admin Location Import is. */

/** The review buckets. `duplicate` = the same place appears earlier in the file. */
export type MatchStatus = "pending" | "existing" | "possible" | "new" | "invalid" | "duplicate";

export interface RowMatch {
  status: Exclude<MatchStatus, "pending">;
  matchedLocationId: string | null;
  candidateLocationIds: string[];
  problem: string | null;
  /** The row's source id was imported before — the import UPDATES that entry. */
  repeat: boolean;
}

export interface KnownSourceEntry {
  availabilityId: string;
  locationId: string;
}

export const evidenceFor = (row: ImportRowData, rowNumber: number): LocationEvidence => ({
  key: `row-${rowNumber}`,
  labels: [`Row ${rowNumber}`],
  name: row.name,
  address: row.address,
  city: row.city,
  state: row.state,
  postalCode: row.postalCode,
  website: row.website,
  phone: row.phone,
  category: null,
  description: null,
  warnings: [],
});

/** The key that says two rows are the same place WITHIN a file. */
export function rowIdentityKey(row: ImportRowData): string | null {
  if (row.externalId) return `id:${row.externalId.toLowerCase()}`;
  if (!row.name || !row.address) return null;
  const zip = (row.postalCode ?? "").replace(/\D/g, "").slice(0, 5);
  return `addr:${normalizeStreetAddress(row.address)}|${(row.city ?? "").toLowerCase()}|${(row.state ?? "").toLowerCase()}|${zip}`;
}

/** Rows that repeat an earlier row of the same file → row number of the first. */
export function findFileDuplicates(rows: readonly ImportRowData[]): Map<number, number> {
  const first = new Map<string, number>();
  const dupes = new Map<number, number>();
  rows.forEach((row, i) => {
    const key = rowIdentityKey(row);
    if (!key) return;
    const earlier = first.get(key);
    if (earlier === undefined) first.set(key, i + 1);
    else dupes.set(i + 1, earlier);
  });
  return dupes;
}

/** Decides one row's bucket.
 *  - A source id this Business already imported → `existing`, repeat: true
 *    (the entry is updated in place; addresses are not even consulted).
 *  - One clearly-same Location on Findmi → `existing`.
 *  - Several/uncertain → `possible` (the Business chooses; never guessed).
 *  - Specific enough and not on Findmi → `new`.
 *  - Vague/missing → `invalid` with the reason. */
export const SOURCE_CHANGED_PROBLEM = "Details changed since the last import. Keep the current Location, or choose a different one.";

/** Does this row describe a different place than the Location its source id
 * is tied to? (Both a differing street and a clearly different name count; a
 * missing side never does — absence is not a change.) */
export function sourceDetailsChanged(row: Pick<ImportRowData, "name" | "address">, current: { name: string | null; address: string | null } | null): boolean {
  if (!current) return false;
  if (row.address && current.address && normalizeStreetAddress(row.address) !== normalizeStreetAddress(current.address)) return true;
  if (row.name && current.name && !similarLocationNames(row.name, current.name)) return true;
  return false;
}

export function classifyImportRow(
  row: ImportRowData,
  rowNumber: number,
  ctx: { known: KnownSourceEntry | null; candidates: readonly ExistingLocation[]; knownLocation?: { name: string | null; address: string | null } | null }
): RowMatch {
  if (ctx.known) {
    if (sourceDetailsChanged(row, ctx.knownLocation ?? null)) {
      // The source id is tied to a Location, but the file now describes a
      // different place (a move, a rename, a re-used id). Never decided silently:
      // the Business keeps the current Location (default) or picks another.
      const others = ctx.candidates.map((c) => c.id).filter((id) => id !== ctx.known?.locationId);
      return { status: "possible", matchedLocationId: ctx.known.locationId, candidateLocationIds: [ctx.known.locationId, ...others].slice(0, 8), problem: SOURCE_CHANGED_PROBLEM, repeat: true };
    }
    return { status: "existing", matchedLocationId: ctx.known.locationId, candidateLocationIds: [], problem: null, repeat: true };
  }
  const evidence = evidenceFor(row, rowNumber);
  const resolution = classifyLocationMatches(evidence, ctx.candidates);
  switch (resolution.kind) {
    case "existing":
      return { status: "existing", matchedLocationId: resolution.location.id, candidateLocationIds: [], problem: null, repeat: false };
    case "ambiguous":
      return { status: "possible", matchedLocationId: null, candidateLocationIds: resolution.candidates.map((c) => c.id).slice(0, 8), problem: null, repeat: false };
    case "new":
      return { status: "new", matchedLocationId: null, candidateLocationIds: [], problem: null, repeat: false };
    default:
      return { status: "invalid", matchedLocationId: null, candidateLocationIds: [], problem: resolution.reason, repeat: false };
  }
}

/** Fast pre-check that needs no database: is there enough to even look for a match? */
export const preMatchProblem = (row: ImportRowData): string | null => locationIdentityIssue(row);

export type RowDecision = "use_match" | "create_new" | "skip";

/** What a row will do on import, given its bucket and the Business's decision. */
export type RowAction =
  | { kind: "link"; locationId: string }
  | { kind: "create" }
  | { kind: "skip"; reason: string }
  | { kind: "unresolved"; reason: string };

export function effectiveAction(
  row: { match_status: MatchStatus; matched_location_id: string | null; candidate_location_ids: string[]; decision: RowDecision | null; chosen_location_id: string | null; problem: string | null }
): RowAction {
  if (row.decision === "skip") return { kind: "skip", reason: "Skipped" };
  switch (row.match_status) {
    case "existing":
      return row.matched_location_id ? { kind: "link", locationId: row.matched_location_id } : { kind: "unresolved", reason: "No match" };
    case "possible":
      if (row.decision === "use_match" && row.chosen_location_id && row.candidate_location_ids.includes(row.chosen_location_id)) return { kind: "link", locationId: row.chosen_location_id };
      if (row.decision === "create_new") return { kind: "create" };
      // A changed repeat row (its source id is already tied to a Location) defaults to keeping that Location.
      if (!row.decision && row.matched_location_id && row.candidate_location_ids.includes(row.matched_location_id)) return { kind: "link", locationId: row.matched_location_id };
      return { kind: "unresolved", reason: "Choose the matching Location, create a new one, or skip" };
    case "new":
      return { kind: "create" };
    case "duplicate":
      return { kind: "skip", reason: "Repeats an earlier row" };
    case "invalid":
      return { kind: "skip", reason: row.problem ?? "Not enough detail" };
    default:
      return { kind: "unresolved", reason: "Not matched yet" };
  }
}
