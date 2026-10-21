import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeLocationHours } from "./locationHours";
import type { LocationHours } from "./types";
import { isAvailabilityInEffect, isAvailabilityRelationship, type AvailabilityRelationship } from "./business-availability-domain";

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

/** What the consumer can learn about HOW and WHAT, from the Where To Find Us
 * detail columns. Absent before that migration is applied (and for rows
 * Findmi entered with no detail: stocked, Brand-wide, ongoing). */
export interface AvailabilityDetail {
  relationship: AvailabilityRelationship;
  startsOn: string | null;
  endsOn: string | null;
  note: string | null;
  /** Live, active Products this entry names. Empty = the Brand generally. */
  products: { id: string; name: string; slug: string }[];
}

export interface AvailabilityLocationItem {
  locationId: string;
  detail?: AvailabilityDetail;
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
  detail?: AvailabilityDetail;
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

/** Public reads show only Live entries that are in effect today (the
 * Where To Find Us detail columns: status / starts_on / ends_on). An expired
 * temporary entry just stops showing — it is never deleted. Before the
 * details migration is applied the columns don't exist (42703); callers
 * then fall back to the original unfiltered read so nothing regresses. */
function liveInEffect<T extends { eq: (c: string, v: string) => T; or: (f: string) => T }>(query: T): T {
  const today = new Date().toISOString().slice(0, 10);
  return query.eq("status", "live").or(`starts_on.is.null,starts_on.lte.${today}`).or(`ends_on.is.null,ends_on.gte.${today}`);
}

const isMissingDetailColumn = (e: { code?: string; message?: string } | null | undefined) => Boolean(e && e.code === "42703");

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

type DetailRow = { id: string; relationship?: string | null; starts_on?: string | null; ends_on?: string | null; note?: string | null };

/** Live, active Products for a set of availability rows — one batched read,
 * under the caller's own RLS (anon sees only products of LIVE entries and
 * only publicly visible Products). */
async function loadProducts(client: SupabaseClient, ids: string[]): Promise<Map<string, AvailabilityDetail["products"]>> {
  const byRow = new Map<string, AvailabilityDetail["products"]>();
  if (ids.length === 0) return byRow;
  const { data } = await client
    .from("business_location_availability_products")
    .select("availability_id, products!inner(id, name, slug, is_active)")
    .in("availability_id", ids)
    .eq("products.is_active", true);
  type P = { id: string; name: string; slug: string };
  for (const r of (data ?? []) as unknown as { availability_id: string; products: P | P[] | null }[]) {
    const p = one(r.products);
    if (p) byRow.set(r.availability_id, [...(byRow.get(r.availability_id) ?? []), { id: p.id, name: p.name, slug: p.slug }]);
  }
  for (const list of byRow.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return byRow;
}

function toDetail(row: DetailRow, products: Map<string, AvailabilityDetail["products"]>): AvailabilityDetail | undefined {
  if (!isAvailabilityRelationship(row.relationship)) return undefined;
  return { relationship: row.relationship, startsOn: row.starts_on ?? null, endsOn: row.ends_on ?? null, note: row.note ?? null, products: products.get(row.id) ?? [] };
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
  const build = (details: boolean) => {
    let query = client
      .from("business_location_availability")
      .select(`${details ? "id, relationship, starts_on, ends_on, note, " : ""}created_at, locations!inner(${LOCATION_FIELDS})`)
      .eq("business_id", businessId);
    if (operated.length > 0) query = query.not("location_id", "in", inList(operated));
    if (publicOnly) {
      query = query.eq("locations.is_demo", false).is("locations.archived_at", null).is("locations.trashed_at", null);
      if (details) query = liveInEffect(query);
    }
    return query.order("created_at", { ascending: true }).order("id", { ascending: true }).range(offset, offset + limit);
  };
  let { data, error } = await build(true);
  if (publicOnly && isMissingDetailColumn(error)) ({ data, error } = await build(false));
  if (error) {
    if (!isMissingAvailabilityTable(error)) console.error("getAvailabilityLocationsForBusiness failed:", error.message);
    return { items: [], hasMore: false };
  }
  type Row = DetailRow & { created_at: string; locations: LocationEmbed | LocationEmbed[] | null };
  const today = new Date().toISOString().slice(0, 10);
  // Public: also hide entries outside their date window (an expired temporary
  // entry just stops showing; it is never deleted).
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => !publicOnly || !("starts_on" in r) || isAvailabilityInEffect(r.starts_on ?? null, r.ends_on ?? null, today));
  const detailIds = rows.map((r) => r.id).filter(Boolean);
  const productMap = await loadProducts(client, detailIds.slice(0, limit + 1));
  const seen = new Set<string>();
  const items: AvailabilityLocationItem[] = [];
  for (const row of rows) {
    const l = one(row.locations);
    if (!l || seen.has(l.id) || operated.includes(l.id)) continue;
    seen.add(l.id);
    items.push({
      locationId: l.id,
      detail: row.id ? toDetail(row, productMap) : undefined,
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
  const build = (details: boolean) => {
    let query = client
      .from("business_location_availability")
      .select(`${details ? "id, relationship, starts_on, ends_on, note, " : ""}created_at, businesses!inner(id, name, slug, logo_url, is_demo, publication_status)`)
      .eq("location_id", locationId);
    if (operators.length > 0) query = query.not("business_id", "in", inList(operators));
    if (publicOnly) {
      query = query.eq("businesses.is_demo", false).eq("businesses.publication_status", "live");
      if (details) query = liveInEffect(query);
    }
    return query.order("created_at", { ascending: true }).order("id", { ascending: true }).range(offset, offset + limit);
  };
  let { data, error } = await build(true);
  if (publicOnly && isMissingDetailColumn(error)) ({ data, error } = await build(false));
  if (error) {
    if (!isMissingAvailabilityTable(error)) console.error("getAvailableBrandsForLocation failed:", error.message);
    return { items: [], hasMore: false };
  }
  type BizEmbed = { id: string; name: string; slug: string; logo_url: string | null };
  type BrandRow = DetailRow & { businesses: BizEmbed | BizEmbed[] | null };
  const today = new Date().toISOString().slice(0, 10);
  const rows = ((data ?? []) as unknown as BrandRow[]).filter((r) => !publicOnly || !("starts_on" in r) || isAvailabilityInEffect(r.starts_on ?? null, r.ends_on ?? null, today));
  const productMap = await loadProducts(client, rows.map((r) => r.id).filter(Boolean).slice(0, limit + 1));
  const seen = new Set<string>();
  const items: AvailableBrandItem[] = [];
  for (const row of rows) {
    const b = one(row.businesses);
    if (!b || seen.has(b.id) || operators.includes(b.id)) continue;
    seen.add(b.id);
    items.push({ businessId: b.id, name: b.name, slug: b.slug, logoUrl: b.logo_url, detail: row.id ? toDetail(row, productMap) : undefined });
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
