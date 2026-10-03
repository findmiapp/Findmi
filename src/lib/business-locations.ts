import type { SupabaseClient } from "@supabase/supabase-js";

/** /account V2 Pass 2 — Business Locations.
 *
 * A business_locations row means "this Business has an ongoing physical
 * presence at this Location" (many-to-many, see the migration
 * 20261003020000_business_locations.sql). It is NOT physical containment
 * (locations.parent_location_id), NOT "sold here", and NOT a temporary
 * Appearance/Event presence — and it never grants management permission
 * over either side. Callers authorize first; these helpers only read/write.
 *
 * Reads take whichever client the caller is entitled to use: the anon
 * client for public surfaces (publicOnly), the service-role client for an
 * already-authorized owner/admin view (which must also see pending
 * Locations). Writes always go through the service-role client via the
 * migration's SQL functions, which keep primary changes atomic.
 *
 * Every helper fails safe if the table doesn't exist yet (code deployed
 * before the migration is applied): reads return empty, writes return an
 * error result — nothing throws. */

export const BUSINESS_LOCATIONS_PAGE_SIZE = 50;

export interface BusinessLocationItem {
  locationId: string;
  isPrimary: boolean;
  linkedAt: string;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  /** is_demo — owner-created Locations start hidden pending review. */
  isPending: boolean;
  /** archived_at / trashed_at set — hidden from the public. */
  isArchived: boolean;
}

export interface LocationOperatorItem {
  businessId: string;
  isPrimary: boolean;
  name: string;
  slug: string;
  logoUrl: string | null;
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
}

export type BusinessLocationWriteResult = { ok: true } | { ok: false; error: string };

interface PageOptions {
  limit?: number;
  offset?: number;
  /** Only published, non-archived rows on the far side — for public pages. */
  publicOnly?: boolean;
}

export function isMissingBusinessLocationsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    /business_locations|link_business_location|set_primary_business_location|unlink_business_location/.test(error.message ?? "")
  );
}

const LOCATION_FIELDS = "id, name, slug, address, city, state, logo_url, cover_image_url, is_demo, archived_at, trashed_at";

type LocationEmbed = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  state: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  is_demo: boolean | null;
  archived_at: string | null;
  trashed_at: string | null;
};

function one<T>(embed: T | T[] | null): T | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

/** Locations connected to a Business — primary first, then oldest link
 * first. Paginated (limit/offset); hasMore says whether another page exists. */
export async function getLocationsForBusiness(
  client: SupabaseClient | null,
  businessId: string,
  { limit = BUSINESS_LOCATIONS_PAGE_SIZE, offset = 0, publicOnly = false }: PageOptions = {}
): Promise<Page<BusinessLocationItem>> {
  if (!client) return { items: [], hasMore: false };
  let query = client
    .from("business_locations")
    .select(`is_primary, created_at, locations!inner(${LOCATION_FIELDS})`)
    .eq("business_id", businessId);
  if (publicOnly) {
    query = query.eq("locations.is_demo", false).is("locations.archived_at", null).is("locations.trashed_at", null);
  }
  const { data, error } = await query
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .range(offset, offset + limit);
  if (error) {
    if (!isMissingBusinessLocationsTable(error)) console.error("getLocationsForBusiness failed:", error.message);
    return { items: [], hasMore: false };
  }
  const rows = (data ?? []) as unknown as { is_primary: boolean; created_at: string; locations: LocationEmbed | LocationEmbed[] | null }[];
  const items: BusinessLocationItem[] = [];
  for (const row of rows) {
    const l = one(row.locations);
    if (!l) continue;
    items.push({
      locationId: l.id,
      isPrimary: row.is_primary,
      linkedAt: row.created_at,
      name: l.name,
      slug: l.slug,
      address: l.address,
      city: l.city,
      state: l.state,
      logoUrl: l.logo_url,
      coverImageUrl: l.cover_image_url,
      isPending: Boolean(l.is_demo),
      isArchived: Boolean(l.archived_at || l.trashed_at),
    });
  }
  return { items: items.slice(0, limit), hasMore: items.length > limit };
}

/** Businesses connected to a Location ("Operated by"). Paginated. */
export async function getOperatorsForLocation(
  client: SupabaseClient | null,
  locationId: string,
  { limit = BUSINESS_LOCATIONS_PAGE_SIZE, offset = 0, publicOnly = false }: PageOptions = {}
): Promise<Page<LocationOperatorItem>> {
  if (!client) return { items: [], hasMore: false };
  let query = client
    .from("business_locations")
    .select("is_primary, created_at, businesses!inner(id, name, slug, logo_url, is_demo, publication_status)")
    .eq("location_id", locationId);
  if (publicOnly) {
    query = query.eq("businesses.is_demo", false).eq("businesses.publication_status", "live");
  }
  const { data, error } = await query.order("created_at", { ascending: true }).range(offset, offset + limit);
  if (error) {
    if (!isMissingBusinessLocationsTable(error)) console.error("getOperatorsForLocation failed:", error.message);
    return { items: [], hasMore: false };
  }
  type BizEmbed = { id: string; name: string; slug: string; logo_url: string | null };
  const rows = (data ?? []) as unknown as { is_primary: boolean; businesses: BizEmbed | BizEmbed[] | null }[];
  const items: LocationOperatorItem[] = [];
  for (const row of rows) {
    const b = one(row.businesses);
    if (!b) continue;
    items.push({ businessId: b.id, isPrimary: row.is_primary, name: b.name, slug: b.slug, logoUrl: b.logo_url });
  }
  return { items: items.slice(0, limit), hasMore: items.length > limit };
}

/** Of the given Location ids, which are already connected to the Business.
 * Bounded by the caller's own (bounded) id list. */
export async function getLinkedLocationIds(
  client: SupabaseClient | null,
  businessId: string,
  locationIds: string[]
): Promise<Set<string>> {
  if (!client || locationIds.length === 0) return new Set();
  const { data, error } = await client
    .from("business_locations")
    .select("location_id")
    .eq("business_id", businessId)
    .in("location_id", locationIds);
  if (error) return new Set();
  return new Set(((data ?? []) as { location_id: string }[]).map((r) => r.location_id));
}

function writeError(error: { code?: string; message?: string }, fallback: string): BusinessLocationWriteResult {
  if (isMissingBusinessLocationsTable(error)) {
    return { ok: false, error: "Locations aren't available yet. Please try again later." };
  }
  console.error(fallback, error.message);
  return { ok: false, error: fallback };
}

/** Connect a Location to a Business (idempotent). Becomes primary when the
 * Business has no primary yet. Service-role client only; authorize first. */
export async function linkBusinessLocation(
  admin: SupabaseClient,
  businessId: string,
  locationId: string
): Promise<BusinessLocationWriteResult> {
  const { error } = await admin.rpc("link_business_location", { p_business_id: businessId, p_location_id: locationId });
  if (error) return writeError(error, "Couldn't connect that location.");
  return { ok: true };
}

/** Remove the relationship row only — never the Location. If exactly one
 * Location remains connected, it becomes primary (see the migration). */
export async function unlinkBusinessLocation(
  admin: SupabaseClient,
  businessId: string,
  locationId: string
): Promise<BusinessLocationWriteResult> {
  const { data, error } = await admin.rpc("unlink_business_location", { p_business_id: businessId, p_location_id: locationId });
  if (error) return writeError(error, "Couldn't remove that location.");
  if (data === false) return { ok: false, error: "That location isn't connected to this business." };
  return { ok: true };
}

/** Make a connected Location the Business's primary, atomically clearing
 * the previous one. */
export async function setPrimaryBusinessLocation(
  admin: SupabaseClient,
  businessId: string,
  locationId: string
): Promise<BusinessLocationWriteResult> {
  const { data, error } = await admin.rpc("set_primary_business_location", { p_business_id: businessId, p_location_id: locationId });
  if (error) return writeError(error, "Couldn't update the primary location.");
  if (data === false) return { ok: false, error: "That location isn't connected to this business." };
  return { ok: true };
}

/** Business Locations — "sufficient authority" for self-service linking
 * is owner or manager on BOTH sides (staff can't connect places). A founder
 * admin session's synthesized membership is role "owner" (see
 * lib/permissions.ts), so Admin Manage-As works unchanged. */
export function isManagingRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

export const MANAGED_LOCATIONS_LIMIT = 100;

export interface ManagedLocationItem {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  isPending: boolean;
}

/** Locations the user manages (owner/manager in location_members) — the
 * ONLY pool self-service "Connect a location you manage" draws from. Never
 * a global Location search. Bounded. */
export async function getManagedLocationsForUser(
  client: SupabaseClient | null,
  userId: string,
  limit = MANAGED_LOCATIONS_LIMIT
): Promise<ManagedLocationItem[]> {
  if (!client) return [];
  const { data, error } = await client
    .from("location_members")
    .select("role, locations!inner(id, name, city, state, is_demo, trashed_at)")
    .eq("user_id", userId)
    .in("role", ["owner", "manager"])
    .is("locations.trashed_at", null)
    .limit(limit);
  if (error) {
    console.error("getManagedLocationsForUser failed:", error.message);
    return [];
  }
  type Embed = { id: string; name: string; city: string | null; state: string | null; is_demo: boolean | null };
  const rows = (data ?? []) as unknown as { locations: Embed | Embed[] | null }[];
  const items: ManagedLocationItem[] = [];
  for (const row of rows) {
    const l = one(row.locations);
    if (l) items.push({ id: l.id, name: l.name, city: l.city, state: l.state, isPending: Boolean(l.is_demo) });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}
