import type { SupabaseClient } from "@supabase/supabase-js";
import type { SelectedLocationDetail } from "@/components/account/EventLocationField";

/** Admin Event Location Relationship UX pass — extracted out of
 * account/location/actions.ts (Inline Event Location Creation pass) so
 * BOTH the member-facing createInlineLocation and an admin-authorized
 * counterpart (admin/locations/actions.ts's createInlineAdminLocation) can
 * share the exact same non-fuzzy duplicate check and result shape, without
 * admin code importing from a public/member route module (a layering
 * direction nothing else in this codebase does) or admin duplicating this
 * logic a second time. Pure/read-only: takes whichever already-authorized
 * SupabaseClient its caller holds (member's own admin-role client, or
 * admin's own requireAdminSupabase() client — the same underlying
 * service-role client shape either way) and never performs its own
 * authorization. */

export type CreateInlineLocationResult =
  | { status: "created"; location: SelectedLocationDetail }
  | { status: "duplicates"; duplicates: SelectedLocationDetail[] }
  | { status: "error"; error: string };

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Find-or-Create V1 — conservative street-address normalization so common
// formatting differences ("200 Fifth Avenue, Suite 3" vs "200 5th Ave")
// compare equal. Unit/suite/floor designators and what follows them are
// dropped: several distinct places can share one street address (malls,
// hotels, food halls), so an address match is only ever offered as a
// CANDIDATE for the user to confirm — never treated as identity.
const ADDRESS_TOKENS: Record<string, string> = {
  street: "st", avenue: "ave", av: "ave", road: "rd", boulevard: "blvd", drive: "dr", place: "pl",
  lane: "ln", court: "ct", parkway: "pkwy", highway: "hwy", square: "sq", terrace: "ter",
  north: "n", south: "s", east: "e", west: "w",
  first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th", sixth: "6th",
  seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th",
};
const UNIT_MARKERS = new Set(["suite", "ste", "unit", "apt", "fl", "floor", "rm", "room"]);

export function normalizeStreetAddress(value: string): string {
  const tokens = value.toLowerCase().replace(/#/g, " suite ").replace(/[^a-z0-9]+/g, " ").trim().split(" ");
  const out: string[] = [];
  for (const t of tokens) {
    if (!t) continue;
    if (UNIT_MARKERS.has(t)) break;
    out.push(ADDRESS_TOKENS[t] ?? t);
  }
  return out.join(" ");
}

function normalizePostal(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/[^0-9]/g, "").slice(0, 5);
  return digits.length === 5 ? digits : null;
}

/** Find-or-Create V1 duplicate safety — a conservative precursor to the
 * future Place Resolver. Offers up to 3 candidates for "Is this the place?";
 * it never decides on the user's behalf.
 *
 *   same street address — normalized street line equal, and the locality
 *     agrees (same 5-digit postal code, or city/state equal where both
 *     sides have them);
 *   same name — normalized name equal, and city/state agree wherever both
 *     sides have them.
 *
 * Only linkable places are candidates (archived/trashed excluded). Reads a
 * bounded, targeted set of rows (name / street-number / postal matches)
 * instead of the whole table. */
export async function findLikelyDuplicateLocations(
  admin: SupabaseClient,
  input: { name: string; address: string | null; city: string | null; state: string | null; postal_code?: string | null }
): Promise<SelectedLocationDetail[]> {
  const name = input.name.trim();
  const inputStreet = input.address ? normalizeStreetAddress(input.address) : "";
  const inputPostal = normalizePostal(input.postal_code);
  const streetNumber = inputStreet.split(" ")[0];
  // Same unquoted `col.ilike.%term%` or() convention as /api/account/search.
  // Characters PostgREST reserves inside or() (, . : ( ) " \) and LIKE's own
  // wildcards become "_" (match any one character), so "St. Marks" still
  // matches itself without breaking the filter.
  const safe = (v: string) => v.replace(/[,.:()"\\%*]/g, "_").trim();

  const filters: string[] = [];
  if (safe(name)) filters.push(`name.ilike.%${safe(name)}%`);
  if (streetNumber && /\d/.test(streetNumber)) filters.push(`address.ilike.${safe(streetNumber)}%`);
  if (inputPostal) filters.push(`postal_code.ilike.${inputPostal}%`);
  if (filters.length === 0) return [];

  const { data } = await admin
    .from("locations")
    .select("id, slug, name, address, city, state, postal_code, is_demo, category:categories(name)")
    .is("archived_at", null)
    .is("trashed_at", null)
    .or(filters.join(","))
    .limit(200);
  const rows = (data ?? []) as {
    id: string;
    slug: string;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    is_demo: boolean | null;
    category: { name: string } | { name: string }[] | null;
  }[];

  const sameText = (a: string | null | undefined, b: string | null | undefined) =>
    !a || !b || normalizeForMatch(a) === normalizeForMatch(b);
  const localityAgrees = (row: (typeof rows)[number]) => {
    const rowPostal = normalizePostal(row.postal_code);
    if (inputPostal && rowPostal) return inputPostal === rowPostal;
    return sameText(input.city, row.city) && sameText(input.state, row.state);
  };

  const toCandidate = (row: (typeof rows)[number]): SelectedLocationDetail => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    address: row.address,
    city: row.city,
    state: row.state,
    postal_code: row.postal_code,
    category: (Array.isArray(row.category) ? row.category[0] : row.category)?.name ?? null,
    is_public: !row.is_demo,
  });

  const matches: SelectedLocationDetail[] = [];
  const seen = new Set<string>();
  const addMatch = (row: (typeof rows)[number]) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    matches.push(toCandidate(row));
  };

  if (inputStreet) {
    for (const row of rows) {
      if (row.address && normalizeStreetAddress(row.address) === inputStreet && localityAgrees(row)) addMatch(row);
    }
  }

  const normalizedName = normalizeForMatch(name);
  for (const row of rows) {
    if (normalizeForMatch(row.name) !== normalizedName) continue;
    if (sameText(input.city, row.city) && sameText(input.state, row.state)) addMatch(row);
  }

  return matches.slice(0, 3);
}
