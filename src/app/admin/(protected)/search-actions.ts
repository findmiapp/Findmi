"use server";

import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { listAdminUsers } from "@/lib/admin/user-queries";
import { cityState, formatDateShort } from "@/lib/format";

/** Admin Global Search pass — ONE navigation search across Findmi's major
 * entities for the Command Center. Deliberately a plain server action
 * (called directly from the client dashboard component via useTransition,
 * same "non-redirecting action returning data" pattern already used by
 * uploadMemberLocationImage/createInlineLocation/createInlineAdminLocation
 * elsewhere in this codebase) rather than a new API route — this needs to
 * query six tables in one debounced call and hand back an already-routed,
 * already-capped result list, which doesn't fit /admin/api/search's
 * existing one-entity-per-request shape (built for RelationPicker's
 * single-relationship dropdown, not a multi-type navigation list).
 *
 * Query patterns are reused, not reinvented: the same case-insensitive
 * ilike matching /admin/api/search/route.ts already uses for businesses/
 * events/locations/products, the same q-filter shape
 * getAdminAppearances({q}) already uses for appearances (title/venue_name/
 * city), and listAdminUsers() verbatim for accounts (Supabase Auth's
 * Admin API has no server-side search, so that helper already fetches one
 * bounded page and filters in JS — see its own doc comment; reused
 * as-is here, just capped to RESULTS_PER_TYPE after).
 *
 * Admin Visibility — every query here is a plain, unfiltered select via
 * the service-role client (requireAdminSupabase()): no is_demo/
 * publication_status/live-only filter is ever applied, so draft
 * Businesses, unpublished Events, hidden Locations, and non-public
 * Products are all findable here exactly like every other Admin list
 * already shows them. This is Admin operational search, never consumer
 * discovery.
 *
 * Authorization — requireAdminSupabase() is the same chokepoint every
 * other privileged admin Server Action in this codebase uses: it verifies
 * the founder admin session (requireAdmin()) before returning the
 * service-role client, so this can never run un-authenticated even though
 * it's a plain exported action rather than a route the middleware alone
 * gates. */

export type AdminGlobalSearchEntityType = "business" | "event" | "location" | "product" | "appearance" | "account";

export interface AdminGlobalSearchResult {
  type: AdminGlobalSearchEntityType;
  id: string;
  label: string;
  subtitle: string;
  href: string;
}

const RESULTS_PER_TYPE = 5;
const MIN_QUERY_LENGTH = 2;

export async function searchAdminGlobal(query: string): Promise<AdminGlobalSearchResult[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const supabase = await requireAdminSupabase();
  const term = `%${q}%`;

  const [businessRows, eventRows, locationRows, productRows, appearanceRows, accountRows] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, city, state")
      .ilike("name", term)
      .order("name")
      .limit(RESULTS_PER_TYPE),
    supabase
      .from("events")
      .select("id, name, start_at")
      .or(`name.ilike.${term},venue_name.ilike.${term}`)
      .order("name")
      .limit(RESULTS_PER_TYPE),
    supabase
      .from("locations")
      .select("id, name, city, state")
      .ilike("name", term)
      .order("name")
      .limit(RESULTS_PER_TYPE),
    supabase
      .from("products")
      .select("id, name, business:businesses(name)")
      .ilike("name", term)
      .order("name")
      .limit(RESULTS_PER_TYPE),
    supabase
      .from("appearances")
      .select("id, title, start_at")
      .or(`title.ilike.${term},venue_name.ilike.${term},city.ilike.${term}`)
      .order("start_at", { ascending: false })
      .limit(RESULTS_PER_TYPE),
    listAdminUsers(q),
  ]);

  const results: AdminGlobalSearchResult[] = [];

  for (const b of (businessRows.data ?? []) as { id: string; name: string; city: string | null; state: string | null }[]) {
    results.push({
      type: "business",
      id: b.id,
      label: b.name,
      subtitle: cityState(b.city, b.state) || "—",
      href: `/admin/businesses/${b.id}`,
    });
  }

  for (const e of (eventRows.data ?? []) as { id: string; name: string; start_at: string }[]) {
    results.push({
      type: "event",
      id: e.id,
      label: e.name,
      subtitle: formatDateShort(e.start_at),
      href: `/admin/events/${e.id}`,
    });
  }

  for (const l of (locationRows.data ?? []) as { id: string; name: string; city: string | null; state: string | null }[]) {
    results.push({
      type: "location",
      id: l.id,
      label: l.name,
      subtitle: cityState(l.city, l.state) || "—",
      href: `/admin/locations/${l.id}`,
    });
  }

  for (const p of (productRows.data ?? []) as { id: string; name: string; business: { name: string } | { name: string }[] | null }[]) {
    const business = Array.isArray(p.business) ? p.business[0] : p.business;
    results.push({
      type: "product",
      id: p.id,
      label: p.name,
      subtitle: business?.name ?? "—",
      href: `/admin/products/${p.id}`,
    });
  }

  for (const a of (appearanceRows.data ?? []) as { id: string; title: string; start_at: string }[]) {
    results.push({
      type: "appearance",
      id: a.id,
      label: a.title,
      subtitle: formatDateShort(a.start_at),
      href: `/admin/appearances/${a.id}`,
    });
  }

  for (const u of accountRows.slice(0, RESULTS_PER_TYPE)) {
    results.push({
      type: "account",
      id: u.id,
      label: u.displayName || u.email || "No display name",
      subtitle: u.email ?? "—",
      href: `/admin/users/${u.id}`,
    });
  }

  return results;
}
