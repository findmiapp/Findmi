import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingAvailabilityTable, ALREADY_OUR_LOCATION_ERROR } from "./business-location-availability";
import {
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
  relationship: AvailabilityRelationship;
  status: AvailabilityStatus;
  source: AvailabilitySource;
  startsOn: string | null;
  endsOn: string | null;
  note: string | null;
  products: { id: string; name: string }[];
}

const COLUMNS =
  "id, location_id, relationship, status, source, starts_on, ends_on, note, created_at, locations!inner(id, name, slug, city, state, logo_url, cover_image_url)";

/** A missing detail column (migration pending) reads like a missing table. */
function detailsUnavailable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return isMissingAvailabilityTable(error) || error.code === "42703" || /column .* does not exist/.test(error.message ?? "");
}

export async function getOwnerAvailability(
  admin: SupabaseClient,
  businessId: string
): Promise<{ available: boolean; items: OwnerAvailabilityItem[] }> {
  const { data, error } = await admin
    .from("business_location_availability")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) {
    if (!detailsUnavailable(error)) console.error("getOwnerAvailability failed:", error.message);
    return { available: false, items: [] };
  }
  type Loc = { id: string; name: string; slug: string; city: string | null; state: string | null; logo_url: string | null; cover_image_url: string | null };
  type Row = {
    id: string;
    location_id: string;
    relationship: AvailabilityRelationship;
    status: AvailabilityStatus;
    source: AvailabilitySource;
    starts_on: string | null;
    ends_on: string | null;
    note: string | null;
    locations: Loc | Loc[] | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const ids = rows.map((r) => r.id);
  const { data: links } = ids.length
    ? await admin.from("business_location_availability_products").select("availability_id, product_id, products(id, name)").in("availability_id", ids)
    : { data: [] as unknown[] };
  type Link = { availability_id: string; products: { id: string; name: string } | { id: string; name: string }[] | null };
  const byRow = new Map<string, { id: string; name: string }[]>();
  for (const l of (links ?? []) as Link[]) {
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
      relationship: r.relationship,
      status: r.status,
      source: r.source,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      note: r.note,
      products: byRow.get(r.id) ?? [],
    });
  }
  return { available: true, items };
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

  const { data: inserted, error } = await admin
    .from("business_location_availability")
    .insert({
      business_id: businessId,
      location_id: v.locationId,
      relationship: v.relationship,
      status: "pending",
      source: "business",
      starts_on: v.startsOn,
      ends_on: v.endsOn,
      note: v.note,
    })
    .select("id")
    .single();
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
 * Review semantics: ANY actual change returns the entry to Pending Review
 * (and marks it owner-authored), including one Findmi had approved or added —
 * owner-edited content is never left Findmi-verified without a fresh review.
 * While it is pending it does not show publicly; the owner sees that
 * plainly. A save that changes nothing is a no-op and leaves the status alone.
 * A declined entry that is edited is thereby resubmitted. */
export async function updateOwnerAvailability(
  admin: SupabaseClient,
  businessId: string,
  availabilityId: string,
  input: Omit<AvailabilityRequestInput, "locationId">
): Promise<OwnerAvailabilityResult & { changed?: boolean }> {
  const { data: existing, error: readError } = await admin
    .from("business_location_availability")
    .select("id, location_id, relationship, starts_on, ends_on, note")
    .eq("id", availabilityId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (readError) return { ok: false, error: detailsUnavailable(readError) ? "Where To Find Us isn't available yet. Please try again soon." : "Couldn't load that entry." };
  const row = existing as { id: string; location_id: string; relationship: string; starts_on: string | null; ends_on: string | null; note: string | null } | null;
  if (!row) return { ok: false, error: "That entry wasn't found." };

  const checked = validateAvailabilityRequest({ ...input, locationId: row.location_id });
  if (!checked.ok) return checked;
  const v = checked.value;

  const { data: linkRows } = await admin.from("business_location_availability_products").select("product_id").eq("availability_id", availabilityId);
  const currentProducts = ((linkRows ?? []) as { product_id: string }[]).map((r) => r.product_id).sort();
  const nextProducts = [...v.productIds].sort();
  const unchanged =
    row.relationship === v.relationship &&
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

  // Row first, straight to pending: if anything after this fails the entry is
  // already in its safe (non-public) state.
  const { error: updateError } = await admin
    .from("business_location_availability")
    .update({ relationship: v.relationship, starts_on: v.startsOn, ends_on: v.endsOn, note: v.note, status: "pending", source: "business" })
    .eq("id", availabilityId)
    .eq("business_id", businessId);
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
  return { ok: true, changed: true };
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

/** ≤20 canonical, published, non-archived Locations matching `query`, for
 * the owner's searchable picker (never a dropdown of every Location). */
export async function searchAvailabilityLocations(
  admin: SupabaseClient,
  query: string
): Promise<{ id: string; name: string; city: string | null; state: string | null }[]> {
  const q = query.trim().replace(/[%,()]/g, " ").slice(0, 60);
  if (q.length < 2) return [];
  const { data } = await admin
    .from("locations")
    .select("id, name, city, state")
    .eq("is_demo", false)
    .is("archived_at", null)
    .is("trashed_at", null)
    .or(`name.ilike.%${q}%,city.ilike.%${q}%`)
    .order("name")
    .limit(20);
  return (data ?? []) as { id: string; name: string; city: string | null; state: string | null }[];
}
