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

/** Practical, non-fuzzy duplicate check: a normalized exact-address match
 * takes priority, then a normalized-name match that also agrees on
 * city/state whenever both sides have one. Demo rows are never excluded —
 * a seeded/pending Location is still a genuine duplicate candidate, not
 * filtered by moderation state. Returns a small ranked, deduped list
 * (capped at 3) of full SelectedLocationDetail-shaped candidates, so a
 * caller can render a real "this may already exist" picker without a
 * second query. */
export async function findLikelyDuplicateLocations(
  admin: SupabaseClient,
  input: { name: string; address: string | null; city: string | null; state: string | null }
): Promise<SelectedLocationDetail[]> {
  const { data } = await admin
    .from("locations")
    .select("id, slug, name, address, city, state, postal_code, category:categories(name)");
  const rows = (data ?? []) as {
    id: string;
    slug: string;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    category: { name: string } | { name: string }[] | null;
  }[];

  const toCandidate = (row: (typeof rows)[number]): SelectedLocationDetail => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    address: row.address,
    city: row.city,
    state: row.state,
    postal_code: row.postal_code,
    category: (Array.isArray(row.category) ? row.category[0] : row.category)?.name ?? null,
  });

  const matches: SelectedLocationDetail[] = [];
  const seen = new Set<string>();
  const addMatch = (row: (typeof rows)[number]) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    matches.push(toCandidate(row));
  };

  const inputAddress = input.address ? normalizeForMatch(input.address) : null;
  if (inputAddress) {
    for (const row of rows) {
      if (row.address && normalizeForMatch(row.address) === inputAddress) addMatch(row);
    }
  }

  const normalizedName = normalizeForMatch(input.name);
  for (const row of rows) {
    if (normalizeForMatch(row.name) !== normalizedName) continue;
    const cityMatches = !input.city || !row.city || normalizeForMatch(input.city) === normalizeForMatch(row.city);
    const stateMatches = !input.state || !row.state || normalizeForMatch(input.state) === normalizeForMatch(row.state);
    if (cityMatches && stateMatches) addMatch(row);
  }

  return matches.slice(0, 3);
}
