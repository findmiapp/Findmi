import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingAvailabilityTable, ALREADY_OUR_LOCATION_ERROR } from "./business-location-availability";
import { AVAILABILITY_LIST_PAGE_SIZE, type AvailabilityFilter } from "./business-availability-bulk-domain";
import {
  normalizeAvailabilityRelationships,
  statusAfterOwnerEdit,
  validateAvailabilityRequest,
  type AvailabilityRelationship,
  type AvailabilityRequestInput,
  type AvailabilitySource,
  type AvailabilityStatus,
} from "./business-availability-domain";

/** Owner-side Where To Find Us: read a Business's own availability entries
 * (every status) and submit new ones. Builds on lib/business-location-
 * availability.ts (the canonical table + Our Locations collision rule) and
 * the detail columns from migration 20261021000000. Service-role client
 * only; the caller authorizes the Business first (requireBusinessMember).
 *
 * Fail-safe before the migration is applied: reads return
 * { available: false } and writes return a friendly error — nothing throws,
 * and the existing admin "Find Us At" path is untouched. */

export interface OwnerAvailabilityItem {
  id: string;
  locationId: string;
  locationName: string;
  locationSlug: string;
  city: string | null;
  state: string | null;
  imageUrl: string | null;
  /** Every way the Business is there at this one place (at least one). */
  relationships: AvailabilityRelationship[];
  status: AvailabilityStatus;
  source: AvailabilitySource;
  startsOn: string | null;
  endsOn: string | null;
  note: string | null;
  products: { id: string; name: string }[];
  /** The Location itself is unlisted (is_demo) or archived/trashed — set by the
   * paged reader so Findmi admin can see which entries aren't public places yet. */
  locationUnlisted?: boolean;
  locationArchived?: boolean;
}

/** `multi` adds the relationships array (migration 20261101…); reads fall back
 * to the single legacy `relationship` while that migration is pending. */
const columns = (multi: boolean) =>
  `id, location_id, relationship, ${multi ? "relationships, " : ""}status, source, starts_on, ends_on, note, created_at, locations!inner(id, name, slug, city, state, logo_url, cover_image_url, is_demo, archived_at, trashed_at)`;

const isMissingColumn = (error: { code?: string } | null | undefined) => Boolean(error && error.code === "42703");

/** The stored shape of an entry's relationships: the array, plus the single
 * legacy column mirrored from its first value so older readers still work. */
const relationshipFields = (relationships: AvailabilityRelationship[]) => ({ relationships, relationship: relationships[0] });
const MULTI_UNAVAILABLE = "Choosing more than one isn’t available yet. Pick one for now.";

/** A missing detail column (migration pending) reads like a missing table. */
function detailsUnavailable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return isMissingAvailabilityTable(error) || error.code === "42703" || /column .* does not exist/.test(error.message ?? "");
}

export interface AvailabilityCounts { all: number; live: number; pending: number; declined: number; imported: number }

/** Exact whole-footprint counts, each a `count` over the database (never the length
 * of a fetched list, which the API caps at 1,000 rows). */
export async function getOwnerAvailabilityCounts(admin: SupabaseClient, businessId: string): Promise<AvailabilityCounts & { available: boolean }> {
  const head = (status?: string) => {
    let q = admin.from("business_location_availability").select("id", { count: "exact", head: true }).eq("business_id", businessId);
    if (status) q = q.eq("status", status);
    return q;
  };
  const [all, live, pending, declined, imported] = await Promise.all([
    head(),
    head("live"),
    head("pending"),
    head("declined"),
    admin.from("business_location_availability").select("id", { count: "exact", head: true }).eq("business_id", businessId).not("external_id", "is", null),
  ]);
  const available = !all.error;
  return { available, all: all.count ?? 0, live: live.count ?? 0, pending: pending.count ?? 0, declined: declined.count ?? 0, imported: imported.error ? 0 : imported.count ?? 0 };
}

export interface OwnerAvailabilityPage {
  available: boolean;
  items: OwnerAvailabilityItem[];
  /** Entries matching the current filter (all pages). */
  total: number;
  page: number;
  pageSize: number;
  /** Whole-footprint totals for the filter chips (independent of the filter). */
  counts: { all: number; live: number; pending: number; declined: number; imported: number };
}

const EMPTY_PAGE: OwnerAvailabilityPage = { available: false, items: [], total: 0, page: 1, pageSize: AVAILABILITY_LIST_PAGE_SIZE, counts: { all: 0, live: 0, pending: 0, declined: 0, imported: 0 } };

/** Narrows an availability query to a filter. `multi` = the relationships
 * array exists (migration applied); before it, the legacy single column. */
export function applyAvailabilityFilter(query: any, filter: AvailabilityFilter, multi: boolean) {
  let q = query;
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.relationship) q = multi ? q.contains("relationships", [filter.relationship]) : q.eq("relationship", filter.relationship);
  if (filter.imported) q = q.not("external_id", "is", null);
  if (filter.q) q = q.or(`name.ilike.%${filter.q}%,city.ilike.%${filter.q}%,address.ilike.%${filter.q}%`, { referencedTable: "locations" });
  return q;
}

/** One page of a Business's footprint, filtered and searched in the database.
 * (The unpaged read this replaces silently stopped at the API's 1,000-row
 * cap, which a large brand reaches.) Products are read for the page's own ids
 * only. Before the details migration it fails safe to `available: false`. */
export async function getOwnerAvailabilityPage(
  admin: SupabaseClient,
  businessId: string,
  filter: AvailabilityFilter,
  page: number
): Promise<OwnerAvailabilityPage> {
  const size = AVAILABILITY_LIST_PAGE_SIZE;
  const pageNo = Math.max(1, Math.floor(page) || 1);
  const from = (pageNo - 1) * size;
  const read = (multi: boolean) =>
    applyAvailabilityFilter(
      admin.from("business_location_availability").select(columns(multi), { count: "exact" }).eq("business_id", businessId),
      filter,
      multi
    )
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + size - 1);
  let multi = true;
  let { data, error, count } = await read(true);
  if (isMissingColumn(error)) {
    multi = false;
    ({ data, error, count } = await read(false));
  }
  if (error) {
    if (!detailsUnavailable(error)) console.error("getOwnerAvailabilityPage failed:", error.message);
    return EMPTY_PAGE;
  }
  const [counts, links] = await Promise.all([
    getOwnerAvailabilityCounts(admin, businessId),
    (async () => {
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      return ids.length ? admin.from("business_location_availability_products").select("availability_id, product_id, products(id, name)").in("availability_id", ids) : { data: [] as unknown[] };
    })(),
  ]);
  const items = rowsToItems((data ?? []) as unknown as RawRow[], (links.data ?? []) as RawLink[]);
  return {
    available: true,
    items,
    total: count ?? items.length,
    page: pageNo,
    pageSize: size,
    counts: { all: counts.all, live: counts.live, pending: counts.pending, declined: counts.declined, imported: counts.imported },
  };
}

type RawLoc = { id: string; name: string; slug: string; city: string | null; state: string | null; logo_url: string | null; cover_image_url: string | null; is_demo?: boolean | null; archived_at?: string | null; trashed_at?: string | null };
type RawRow = {
  id: string;
  location_id: string;
  relationship: AvailabilityRelationship;
  relationships?: AvailabilityRelationship[] | null;
  status: AvailabilityStatus;
  source: AvailabilitySource;
  starts_on: string | null;
  ends_on: string | null;
  note: string | null;
  locations: RawLoc | RawLoc[] | null;
};
type RawLink = { availability_id: string; products: { id: string; name: string } | { id: string; name: string }[] | null };

function rowsToItems(rows: RawRow[], links: RawLink[]): OwnerAvailabilityItem[] {
  const byRow = new Map<string, { id: string; name: string }[]>();
  for (const l of links) {
    const p = Array.isArray(l.products) ? l.products[0] : l.products;
    if (!p) continue;
    byRow.set(l.availability_id, [...(byRow.get(l.availability_id) ?? []), p]);
  }
  const items: OwnerAvailabilityItem[] = [];
  for (const r of rows) {
    const loc = Array.isArray(r.locations) ? r.locations[0] : r.locations;
    if (!loc) continue;
    items.push({
      id: r.id,
      locationId: loc.id,
      locationName: loc.name,
      locationSlug: loc.slug,
      city: loc.city,
      state: loc.state,
      imageUrl: loc.cover_image_url ?? loc.logo_url,
      relationships: normalizeAvailabilityRelationships(r.relationships && r.relationships.length > 0 ? r.relationships : [r.relationship]),
      status: r.status,
      source: r.source,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      note: r.note,
      products: byRow.get(r.id) ?? [],
      locationUnlisted: Boolean(loc.is_demo),
      locationArchived: Boolean(loc.archived_at || loc.trashed_at),
    });
  }
  return items;
}

export type OwnerAvailabilityResult = { ok: true } | { ok: false; error: string };

/** An owner submits where they can be found. Always lands as source
 * 'business', status 'pending' — it only shows publicly once Findmi
 * approves it. Refused for a Location the Business operates (Our
 * Locations), a trashed/missing Location, an already-connected Location, or
 * Products that aren't this Business's own. */
export async function requestOwnerAvailability(admin: SupabaseClient, businessId: string, input: AvailabilityRequestInput): Promise<OwnerAvailabilityResult> {
  const checked = validateAvailabilityRequest(input);
  if (!checked.ok) return checked;
  const v = checked.value;

  const { data: operated } = await admin.from("business_locations").select("id").eq("business_id", businessId).eq("location_id", v.locationId).maybeSingle();
  if (operated) return { ok: false, error: ALREADY_OUR_LOCATION_ERROR };

  const { data: location } = await admin.from("locations").select("id, trashed_at").eq("id", v.locationId).maybeSingle();
  const loc = location as { id: string; trashed_at: string | null } | null;
  if (!loc || loc.trashed_at) return { ok: false, error: "That Location doesn't exist on Findmi." };

  if (v.productIds.length > 0) {
    const { data: owned } = await admin.from("products").select("id").eq("business_id", businessId).in("id", v.productIds);
    if (((owned ?? []) as unknown[]).length !== v.productIds.length) return { ok: false, error: "One of those products isn't part of your catalog." };
  }

  const base = { business_id: businessId, location_id: v.locationId, status: "pending", source: "business", starts_on: v.startsOn, ends_on: v.endsOn, note: v.note };
  let { data: inserted, error } = await admin.from("business_location_availability").insert({ ...base, ...relationshipFields(v.relationships) }).select("id").single();
  if (isMissingColumn(error)) {
    // Multi-relationship migration pending: a single relationship still saves.
    if (v.relationships.length > 1) return { ok: false, error: MULTI_UNAVAILABLE };
    ({ data: inserted, error } = await admin.from("business_location_availability").insert({ ...base, relationship: v.relationships[0] }).select("id").single());
  }
  if (error || !inserted) {
    if (error?.code === "23505") return { ok: false, error: "You’re already connected to that location." };
    if (error && detailsUnavailable(error)) return { ok: false, error: "Where To Find Us isn't available yet. Please try again soon." };
    console.error("requestOwnerAvailability failed:", error?.message);
    return { ok: false, error: "Couldn't save that. Please try again." };
  }
  if (v.productIds.length > 0) {
    const { error: linkError } = await admin
      .from("business_location_availability_products")
      .insert(v.productIds.map((product_id) => ({ availability_id: inserted.id, product_id })));
    if (linkError) {
      // Never leave a half-saved entry: the row without its Products would
      // read as a Brand-wide claim the owner didn't make.
      await admin.from("business_location_availability").delete().eq("id", inserted.id);
      return { ok: false, error: "Couldn't save those products. Please try again." };
    }
  }
  return { ok: true };
}

/** An owner edits one of their own entries (relationship, Products, dates,
 * note). The place itself never changes — to move to a different place, remove
 * the entry and add the new one.
 *
 * Review semantics (lib/business-availability-domain.ts statusAfterOwnerEdit — the
 * same rule bulk edits and re-imports use): an edit that does not change what the
 * entry publicly CLAIMS leaves its status exactly as it was — a Live entry stays
 * Live through product, product-set and date changes, and through narrowing its
 * relationships. An edit that ADDS a claim (a relationship it wasn't approved for, or
 * new note text) returns a Live or Declined entry to Pending Review and marks it
 * owner-authored. A Pending entry stays Pending. A save that changes nothing is a
 * no-op. */
export async function updateOwnerAvailability(
  admin: SupabaseClient,
  businessId: string,
  availabilityId: string,
  input: Omit<AvailabilityRequestInput, "locationId">
): Promise<OwnerAvailabilityResult & { changed?: boolean; returnedToReview?: boolean }> {
  const readRow = (multi: boolean) =>
    admin
      .from("business_location_availability")
      .select(`id, location_id, relationship, ${multi ? "relationships, " : ""}status, starts_on, ends_on, note`)
      .eq("id", availabilityId)
      .eq("business_id", businessId)
      .maybeSingle();
  let { data: existing, error: readError } = await readRow(true);
  if (isMissingColumn(readError)) ({ data: existing, error: readError } = await readRow(false));
  if (readError) return { ok: false, error: detailsUnavailable(readError) ? "Where To Find Us isn't available yet. Please try again soon." : "Couldn't load that entry." };
  const row = existing as unknown as { id: string; location_id: string; relationship: string; relationships?: string[] | null; status: AvailabilityStatus; starts_on: string | null; ends_on: string | null; note: string | null } | null;
  if (!row) return { ok: false, error: "That entry wasn't found." };

  const checked = validateAvailabilityRequest({ ...input, locationId: row.location_id });
  if (!checked.ok) return checked;
  const v = checked.value;

  const { data: linkRows } = await admin.from("business_location_availability_products").select("product_id").eq("availability_id", availabilityId);
  const currentProducts = ((linkRows ?? []) as { product_id: string }[]).map((r) => r.product_id).sort();
  const nextProducts = [...v.productIds].sort();
  const currentRelationships = normalizeAvailabilityRelationships(row.relationships && row.relationships.length > 0 ? row.relationships : [row.relationship]);
  const unchanged =
    currentRelationships.length === v.relationships.length &&
    currentRelationships.every((r, i) => r === v.relationships[i]) &&
    row.starts_on === v.startsOn &&
    row.ends_on === v.endsOn &&
    (row.note ?? null) === v.note &&
    currentProducts.length === nextProducts.length &&
    currentProducts.every((id, i) => id === nextProducts[i]);
  if (unchanged) return { ok: true, changed: false };

  if (nextProducts.length > 0) {
    const { data: owned } = await admin.from("products").select("id").eq("business_id", businessId).in("id", nextProducts);
    if (((owned ?? []) as unknown[]).length !== nextProducts.length) return { ok: false, error: "One of those products isn't part of your catalog." };
  }

  // The one review rule: only an edit that adds a public claim goes back to review.
  const nextStatus = statusAfterOwnerEdit(row.status, { relationshipsBefore: currentRelationships, relationshipsAfter: v.relationships, noteBefore: row.note, noteAfter: v.note });
  const returnedToReview = row.status === "live" && nextStatus === "pending";
  // Row first: an edit that adds a claim is already Pending (non-public) before
  // anything after this can fail; one that doesn't add a claim was already approved.
  const write = (fields: Record<string, unknown>) =>
    admin
      .from("business_location_availability")
      .update({ ...fields, starts_on: v.startsOn, ends_on: v.endsOn, note: v.note, ...(nextStatus !== row.status ? { status: nextStatus } : {}), ...(nextStatus === "pending" ? { source: "business" } : {}) })
      .eq("id", availabilityId)
      .eq("business_id", businessId);
  let { error: updateError } = await write(relationshipFields(v.relationships));
  if (isMissingColumn(updateError)) {
    if (v.relationships.length > 1) return { ok: false, error: MULTI_UNAVAILABLE };
    ({ error: updateError } = await write({ relationship: v.relationships[0] }));
  }
  if (updateError) return { ok: false, error: "Couldn't save that. Please try again." };

  const { error: clearError } = await admin.from("business_location_availability_products").delete().eq("availability_id", availabilityId);
  if (clearError) return { ok: false, error: "Couldn't save those products. Please try again." };
  if (nextProducts.length > 0) {
    const { error: linkError } = await admin
      .from("business_location_availability_products")
      .insert(nextProducts.map((product_id) => ({ availability_id: availabilityId, product_id })));
    if (linkError) {
      // Restore the previous links so a failed edit never silently drops them.
      if (currentProducts.length > 0) {
        await admin.from("business_location_availability_products").insert(currentProducts.map((product_id) => ({ availability_id: availabilityId, product_id })));
      }
      return { ok: false, error: "Couldn't save those products. Please try again." };
    }
  }
  return { ok: true, changed: true, returnedToReview };
}

/** Owner removes (or withdraws) ONE of their own entries — scoped by
 * business_id so an id from another Business can never match. */
export async function removeOwnerAvailability(admin: SupabaseClient, businessId: string, availabilityId: string): Promise<OwnerAvailabilityResult> {
  const { data, error } = await admin
    .from("business_location_availability")
    .delete()
    .eq("id", availabilityId)
    .eq("business_id", businessId)
    .select("id");
  if (error) return { ok: false, error: "Couldn't remove that. Please try again." };
  if (((data ?? []) as unknown[]).length === 0) return { ok: false, error: "That entry wasn't found." };
  return { ok: true };
}

/** Findmi reviews an owner-submitted entry. */
export async function reviewAvailability(admin: SupabaseClient, availabilityId: string, status: "live" | "declined"): Promise<OwnerAvailabilityResult> {
  const { data, error } = await admin
    .from("business_location_availability")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", availabilityId)
    .select("id");
  if (error) return { ok: false, error: "Couldn't update that entry." };
  if (((data ?? []) as unknown[]).length === 0) return { ok: false, error: "That entry wasn't found." };
  return { ok: true };
}

/** Findmi reviews EVERY entry this Business has pending, in one statement — for an
 * import that submitted hundreds. Entries for a Location the Business operates (Our
 * Locations) can't be approved (the database refuses it), so they are left pending
 * and counted. Nothing outside this Business's pending entries is touched. */
export async function reviewAllPendingAvailability(
  admin: SupabaseClient,
  businessId: string,
  status: "live" | "declined"
): Promise<{ ok: true; changed: number; left: number } | { ok: false; error: string }> {
  // Pending entries for a place the Business operates (Our Locations) can't be approved
  // (the database refuses it), so they're found first — by checking the operated places
  // in small chunks against the pending set, never a URL-sized list — and left alone.
  let blocked: string[] = [];
  if (status === "live") {
    const operated: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("business_locations").select("location_id").eq("business_id", businessId).order("location_id").range(from, from + 999);
      if (error) return { ok: false, error: "Couldn't review those entries." };
      const rows = (data ?? []) as { location_id: string }[];
      operated.push(...rows.map((r) => r.location_id));
      if (rows.length < 1000) break;
    }
    for (let i = 0; i < operated.length; i += 150) {
      const { data } = await admin.from("business_location_availability").select("id").eq("business_id", businessId).eq("status", "pending").in("location_id", operated.slice(i, i + 150));
      blocked.push(...((data ?? []) as { id: string }[]).map((r) => r.id));
    }
    if (blocked.length > 200) return { ok: false, error: "Too many pending entries are for places this Business operates. Remove those first." };
  }
  const pendingCount = () => admin.from("business_location_availability").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "pending");
  const { count: before } = await pendingCount();
  // ONE set-based statement over the complete pending set. `count` is asked of the
  // database; rows are never returned, so nothing is capped at the API's 1,000-row limit.
  let q = admin.from("business_location_availability").update({ status, updated_at: new Date().toISOString() }, { count: "exact" }).eq("business_id", businessId).eq("status", "pending");
  if (blocked.length > 0) q = q.not("id", "in", `(${blocked.join(",")})`);
  const { error, count: changed } = await q;
  if (error) return { ok: false, error: "Couldn't review those entries." };
  const { count } = await pendingCount();
  // The statement's own count when the API reports it; otherwise the difference in the exact pending counts.
  return { ok: true, changed: changed ?? Math.max(0, (before ?? 0) - (count ?? 0)), left: count ?? 0 };
}

/** ≤20 canonical, published, non-archived Locations matching `query`, for
 * the owner's searchable picker (never a dropdown of every Location). */
export async function searchAvailabilityLocations(
  admin: SupabaseClient,
  query: string
): Promise<{ id: string; name: string; address: string | null; city: string | null; state: string | null }[]> {
  const q = query.trim().replace(/[%,()]/g, " ").slice(0, 60);
  if (q.length < 2) return [];
  const { data } = await admin
    .from("locations")
    .select("id, name, address, city, state")
    .eq("is_demo", false)
    .is("archived_at", null)
    .is("trashed_at", null)
    .or(`name.ilike.%${q}%,city.ilike.%${q}%,address.ilike.%${q}%`)
    .order("name")
    .limit(20);
  return (data ?? []) as { id: string; name: string; address: string | null; city: string | null; state: string | null }[];
}

/** This Business's Find Us Here entry at ONE place (any status), or null — the
 * relationship workspace's Presence. Same columns and mapping as the paged list;
 * the (business, location) pair is unique, so there is at most one. */
export async function getOwnerAvailabilityForLocation(admin: SupabaseClient, businessId: string, locationId: string): Promise<OwnerAvailabilityItem | null> {
  const read = (multi: boolean) => admin.from("business_location_availability").select(columns(multi)).eq("business_id", businessId).eq("location_id", locationId).maybeSingle();
  let { data, error } = await read(true);
  if (isMissingColumn(error)) ({ data, error } = await read(false));
  if (error || !data) return null;
  const row = data as unknown as RawRow;
  const { data: links } = await admin.from("business_location_availability_products").select("availability_id, product_id, products(id, name)").eq("availability_id", row.id);
  return rowsToItems([row], (links ?? []) as RawLink[])[0] ?? null;
}
