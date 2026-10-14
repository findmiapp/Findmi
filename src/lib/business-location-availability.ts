import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeLocationHours } from "./locationHours";
import type { LocationHours } from "./types";

/** Find Us At — business_location_availability (see the migration
 * 20261015000000_business_location_availability.sql).
 *
 * A row means "this Business/Brand is normally available at this
 * THIRD-PARTY canonical Findmi Location" (stocked, sold, served, carried).
 * Distinct from business_locations (Our Locations — the Business operates the
 * place) and from Events/Appearances (Findmi Here — dated presence). Nothing
 * here is ever inferred from Events, Appearances or Our Locations: rows only
 * come from an explicit Admin connection.
 *
 * Collision rule: a Business/Location pair that is also in business_locations
 * ("we operate it") is never a Find Us At pair — connecting it is refused,
 * and every public read excludes it even if bad data creates both.
 *
 * Canonical Location only — every place field is read from `locations`.
 * Reads take whichever client the caller is entitled to (anon for public,
 * service role for Admin); writes are service role only, after the caller
 * authorizes. Fails safe before the migration exists: reads return empty,
 * writes return an error result — nothing throws. */

export const FIND_US_AT_PUBLIC_LIMIT = 6;
export const AVAILABILITY_PAGE_SIZE = 50;

export interface AvailabilityLocationItem {
  locationId: string;
  linkedAt: string;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  hours: LocationHours | null;
  /** is_demo — not public yet. */
  isPending: boolean;
  /** archived_at / trashed_at set — hidden from the public. */
  isArchived: boolean;
}

export interface AvailableBrandItem {
  businessId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
}

export type AvailabilityWriteResult = { ok: true; already?: boolean } | { ok: false; error: string };

interface PageOptions {
  limit?: number;
  offset?: number;
  /** Public surfaces: published, non-archived Locations / live Businesses only. */
  publicOnly?: boolean;
}

export function isMissingAvailabilityTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /business_location_availability/.test(error.message ?? "");
}

const LOCATION_FIELDS = "id, name, slug, address, city, state, logo_url, cover_image_url, hours, is_demo, archived_at, trashed_at";

type LocationEmbed = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  state: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  hours?: unknown;
  is_demo: boolean | null;
  archived_at: string | null;
  trashed_at: string | null;
};

function one<T>(embed: T | T[] | null): T | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

/** PostgREST `in` list for uuids (ids come from our own rows). */
const inList = (ids: string[]) => `(${ids.join(",")})`;

/** Location ids this Business operates (Our Locations) — the collision set. */
async function operatedLocationIds(client: SupabaseClient, businessId: string): Promise<string[]> {
  const { data, error } = await client.from("business_locations").select("location_id").eq("business_id", businessId);
  if (error) return [];
  return ((data ?? []) as { location_id: string }[]).map((r) => r.location_id);
}

/** Business ids that operate this Location (Our Locations) — the collision set. */
async function operatorBusinessIds(client: SupabaseClient, locationId: string): Promise<string[]> {
  const { data, error } = await client.from("business_locations").select("business_id").eq("location_id", locationId);
  if (error) return [];
  return ((data ?? []) as { business_id: string }[]).map((r) => r.business_id);
}

/** Find Us At for a Business — third-party Locations in connection order
 * (stable created_at, id — ready for future pagination), each once,
 * never one it operates. Requests only the page asked for (limit + 1 to know
 * whether more exist), so a Brand with thousands stays cheap. */
export async function getAvailabilityLocationsForBusiness(
  client: SupabaseClient | null,
  businessId: string,
  { limit = AVAILABILITY_PAGE_SIZE, offset = 0, publicOnly = false }: PageOptions = {}
): Promise<Page<AvailabilityLocationItem>> {
  if (!client) return { items: [], hasMore: false };
  const operated = await operatedLocationIds(client, businessId);
  let query = client
    .from("business_location_availability")
    .select(`created_at, locations!inner(${LOCATION_FIELDS})`)
    .eq("business_id", businessId);
  if (operated.length > 0) query = query.not("location_id", "in", inList(operated));
  if (publicOnly) {
    query = query.eq("locations.is_demo", false).is("locations.archived_at", null).is("locations.trashed_at", null);
  }
  const { data, error } = await query.order("created_at", { ascending: true }).order("id", { ascending: true }).range(offset, offset + limit);
  if (error) {
    if (!isMissingAvailabilityTable(error)) console.error("getAvailabilityLocationsForBusiness failed:", error.message);
    return { items: [], hasMore: false };
  }
  const rows = (data ?? []) as unknown as { created_at: string; locations: LocationEmbed | LocationEmbed[] | null }[];
  const seen = new Set<string>();
  const items: AvailabilityLocationItem[] = [];
  for (const row of rows) {
    const l = one(row.locations);
    if (!l || seen.has(l.id) || operated.includes(l.id)) continue;
    seen.add(l.id);
    items.push({
      locationId: l.id,
      linkedAt: row.created_at,
      name: l.name,
      slug: l.slug,
      address: l.address,
      city: l.city,
      state: l.state,
      logoUrl: l.logo_url,
      coverImageUrl: l.cover_image_url,
      hours: normalizeLocationHours(l.hours),
      isPending: Boolean(l.is_demo),
      isArchived: Boolean(l.archived_at || l.trashed_at),
    });
  }
  return { items: items.slice(0, limit), hasMore: items.length > limit };
}

/** Brands Available Here — live Businesses available at this Location, in
 * connection order, each once, never a Business that operates it. */
export async function getAvailableBrandsForLocation(
  client: SupabaseClient | null,
  locationId: string,
  { limit = AVAILABILITY_PAGE_SIZE, offset = 0, publicOnly = false }: PageOptions = {}
): Promise<Page<AvailableBrandItem>> {
  if (!client) return { items: [], hasMore: false };
  const operators = await operatorBusinessIds(client, locationId);
  let query = client
    .from("business_location_availability")
    .select("created_at, businesses!inner(id, name, slug, logo_url, is_demo, publication_status)")
    .eq("location_id", locationId);
  if (operators.length > 0) query = query.not("business_id", "in", inList(operators));
  if (publicOnly) query = query.eq("businesses.is_demo", false).eq("businesses.publication_status", "live");
  const { data, error } = await query.order("created_at", { ascending: true }).order("id", { ascending: true }).range(offset, offset + limit);
  if (error) {
    if (!isMissingAvailabilityTable(error)) console.error("getAvailableBrandsForLocation failed:", error.message);
    return { items: [], hasMore: false };
  }
  type BizEmbed = { id: string; name: string; slug: string; logo_url: string | null };
  const rows = (data ?? []) as unknown as { businesses: BizEmbed | BizEmbed[] | null }[];
  const seen = new Set<string>();
  const items: AvailableBrandItem[] = [];
  for (const row of rows) {
    const b = one(row.businesses);
    if (!b || seen.has(b.id) || operators.includes(b.id)) continue;
    seen.add(b.id);
    items.push({ businessId: b.id, name: b.name, slug: b.slug, logoUrl: b.logo_url });
  }
  return { items: items.slice(0, limit), hasMore: items.length > limit };
}

function writeError(error: { code?: string; message?: string }, fallback: string): AvailabilityWriteResult {
  if (isMissingAvailabilityTable(error)) return { ok: false, error: "Find Us At isn't available yet. Please try again later." };
  console.error(fallback, error.message);
  return { ok: false, error: fallback };
}

export const ALREADY_OUR_LOCATION_ERROR =
  "That Location is already one of this business's Our Locations (it operates it), so it can't also be a Find Us At place.";

/** Connect a third-party Location to a Business (idempotent). Refused when
 * the Business already operates it (business_locations) or the Location is
 * trashed / missing. Service-role client only; authorize first. Never
 * creates a Location. */
export async function connectBusinessLocationAvailability(
  admin: SupabaseClient,
  businessId: string,
  locationId: string
): Promise<AvailabilityWriteResult> {
  const { data: operated, error: operatedError } = await admin
    .from("business_locations")
    .select("id")
    .eq("business_id", businessId)
    .eq("location_id", locationId)
    .maybeSingle();
  if (operatedError) return writeError(operatedError, "Couldn't check this business's Our Locations.");
  if (operated) return { ok: false, error: ALREADY_OUR_LOCATION_ERROR };

  const { data: location } = await admin.from("locations").select("id, trashed_at").eq("id", locationId).maybeSingle();
  const loc = location as { id: string; trashed_at: string | null } | null;
  if (!loc || loc.trashed_at) return { ok: false, error: "That Location doesn't exist on Findmi." };

  const { data, error } = await admin
    .from("business_location_availability")
    .upsert({ business_id: businessId, location_id: locationId }, { onConflict: "business_id,location_id", ignoreDuplicates: true })
    .select("id");
  if (error) return writeError(error, "Couldn't connect that location.");
  return { ok: true, already: ((data ?? []) as unknown[]).length === 0 };
}

/** Remove ONLY the availability row — never the Location, the Business,
 * Events, Appearances, Our Locations or anything else. */
export async function removeBusinessLocationAvailability(
  admin: SupabaseClient,
  businessId: string,
  locationId: string
): Promise<AvailabilityWriteResult> {
  const { data, error } = await admin
    .from("business_location_availability")
    .delete()
    .eq("business_id", businessId)
    .eq("location_id", locationId)
    .select("id");
  if (error) return writeError(error, "Couldn't remove that location.");
  if (((data ?? []) as unknown[]).length === 0) return { ok: false, error: "That location isn't connected to this business." };
  return { ok: true };
}
