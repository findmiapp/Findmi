// Location matching — the ONE set of pure rules for "is this the same
// place?" and "which existing Locations should this Business be offered?",
// shared by Add Location (search-before-create), Event creation / import
// venue resolution, and Business Manager suggestions.
//
// Boundaries: this module only compares rows it is given (no I/O). The
// bounded, index-backed candidate queries live with their callers
// (lib/locationCreation.ts findLikelyDuplicateLocations /
// findPossibleLocations, /api/account/search). Persistence and
// authorization are never decided here.
import { normalizeStreetAddress } from "./locationCreation";
import { usStateCode } from "./brand-website-extract";

export interface LocationQuery {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

export interface LocationCandidateRow {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

export type LocationMatchKind = "exact" | "strong" | "ambiguous" | "none";

export interface LocationMatchResult<T extends LocationCandidateRow> {
  /** exact   — same name AND same street address in the same locality.
   *  strong  — exactly ONE candidate agrees on name+locality or on the
   *            street address+locality: safe to pre-select (still shown).
   *  ambiguous — several plausible candidates: the person picks.
   *  none    — nothing plausible: offer Create New Location. */
  kind: LocationMatchKind;
  /** Best first; every plausible candidate (never more than `limit`). */
  matches: T[];
}

export const normalizePlaceName = (v: string | null | undefined): string =>
  (v ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const postal5 = (v: string | null | undefined) => {
  const d = (v ?? "").replace(/[^0-9]/g, "").slice(0, 5);
  return d.length === 5 ? d : null;
};
const stateKey = (v: string | null | undefined) => (v ? (usStateCode(v) ?? normalizePlaceName(v)) : "");

/** Same locality: ZIPs agree when both are known, else city + state
 * agree where both sides state them. */
export function sameLocality(q: LocationQuery, row: LocationCandidateRow): boolean {
  const a = postal5(q.postalCode);
  const b = postal5(row.postal_code);
  if (a && b) return a === b;
  const cityOk = !q.city || !row.city || normalizePlaceName(q.city) === normalizePlaceName(row.city);
  const stateOk = !q.state || !row.state || stateKey(q.state) === stateKey(row.state);
  return cityOk && stateOk;
}

/** Classify already-fetched candidates for one place. */
export function classifyLocationMatches<T extends LocationCandidateRow>(q: LocationQuery, rows: readonly T[], limit = 5): LocationMatchResult<T> {
  const qName = normalizePlaceName(q.name);
  const qStreet = q.address ? normalizeStreetAddress(q.address) : "";
  const scored: { row: T; score: number }[] = [];
  for (const row of rows) {
    if (!sameLocality(q, row)) continue;
    const rName = normalizePlaceName(row.name);
    const rStreet = row.address ? normalizeStreetAddress(row.address) : "";
    const nameEq = Boolean(qName) && rName === qName;
    const streetEq = Boolean(qStreet) && Boolean(rStreet) && rStreet === qStreet;
    // A place NAMED by its address ("410 West 13th Street") is the same
    // identity as that street address.
    const nameIsStreet = Boolean(qStreet) && normalizeStreetAddress(row.name) === qStreet;
    const nameContains = Boolean(qName) && qName.length >= 4 && (rName.includes(qName) || qName.includes(rName)) && rName.length >= 4;
    let score = 0;
    if (nameEq && streetEq) score = 100;
    else if (streetEq || nameIsStreet) score = 70;
    else if (nameEq) score = 60;
    else if (nameContains) score = 30;
    if (score > 0) scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  const matches = scored.slice(0, limit).map((s) => s.row);
  if (scored.length === 0) return { kind: "none", matches: [] };
  const top = scored[0].score;
  if (top === 100 && scored.filter((s) => s.score === 100).length === 1) return { kind: "exact", matches };
  const strongTier = scored.filter((s) => s.score >= 60);
  if (strongTier.length === 1 && strongTier[0] === scored[0]) return { kind: "strong", matches };
  return { kind: "ambiguous", matches };
}

/** Which Locations a person managing Business A should be OFFERED to
 * connect to A. A Location they manage is suggested only when there is
 * evidence it belongs with THIS Business — never merely because the same
 * account also manages Business B and its Locations (the Babylist Soho /
 * Shopify bug). Evidence: this Business already appears / hosts there, or
 * the Location is named for this Business. Everything else is reachable
 * through the search-first Add Location flow instead. */
export function scopeLocationSuggestions<T extends { id: string; name: string }>(input: {
  businessName: string;
  /** Locations the person manages (owner/manager). */
  managed: readonly T[];
  /** Location ids with activity evidence for THIS Business. */
  evidenceLocationIds: ReadonlySet<string>;
  /** Already connected — never offered again. */
  linkedIds: ReadonlySet<string>;
}): T[] {
  const bizTokens = distinctiveTokens(input.businessName);
  return input.managed.filter((l) => {
    if (input.linkedIds.has(l.id)) return false;
    if (input.evidenceLocationIds.has(l.id)) return true;
    if (bizTokens.length === 0) return false;
    const locTokens = new Set(normalizePlaceName(l.name).split(" "));
    return bizTokens.every((t) => locTokens.has(t));
  });
}

const GENERIC = new Set(["the", "a", "an", "and", "of", "co", "inc", "llc", "shop", "store", "studio", "nyc", "by"]);
function distinctiveTokens(name: string): string[] {
  return normalizePlaceName(name)
    .split(" ")
    .filter((t) => t.length >= 2 && !GENERIC.has(t));
}
