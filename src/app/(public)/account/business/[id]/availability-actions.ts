"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember } from "@/lib/permissions";
import { isManagingRole } from "@/lib/business-locations";
import {
  removeOwnerAvailability,
  requestOwnerAvailability,
  searchAvailabilityLocations,
  updateOwnerAvailability,
  type OwnerAvailabilityResult,
} from "@/lib/business-availability-owner";
import type { AvailabilityRequestInput } from "@/lib/business-availability-domain";
import { createProductSet, deleteProductSet, duplicateProductSet, updateProductSet, type ProductSetResult } from "@/lib/business-product-sets";
import { bulkAvailability, type BulkResult } from "@/lib/business-availability-bulk";
import { parseAvailabilityFilter, validateBulkOp, BULK_IDS_MAX } from "@/lib/business-availability-bulk-domain";
import type { ProductSetInput } from "@/lib/business-product-sets-domain";

/** Owner mutations for Findmi Here → Where To Find Us. Each re-verifies the
 * caller against THIS Business server-side (never trusts the id as sent);
 * only an owner/manager (or an elevated Admin session, which
 * requireBusinessMember already resolves) may write. */

/** The Location page slug for one of this Business's entries (looked up
 * BEFORE a removal, while the row still exists). */
async function locationSlugFor(businessId: string, availabilityId: string): Promise<string | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const { data } = await admin.from("business_location_availability").select("locations(slug)").eq("id", availabilityId).eq("business_id", businessId).maybeSingle();
  const loc = (data as { locations: { slug: string } | { slug: string }[] | null } | null)?.locations;
  return (Array.isArray(loc) ? loc[0]?.slug : loc?.slug) ?? null;
}

/** Public pages that render this Business's Find Us At / a Location's Brands
 * Available Here — refreshed after any change that can alter what is public
 * (an edit sends a Live entry back to review, a removal takes it down). */
async function revalidatePublic(businessId: string, locationSlug?: string | null) {
  revalidatePath(`/account/business/${businessId}`);
  const admin = getAdminSupabase();
  if (!admin) return;
  const { data: business } = await admin.from("businesses").select("slug").eq("id", businessId).maybeSingle();
  if (business?.slug) revalidatePath(`/business/${business.slug}`);
  if (locationSlug) revalidatePath(`/location/${locationSlug}`);
}

async function authorize(businessId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const membership = await requireBusinessMember(businessId);
    if (membership.viaAdmin || isManagingRole(membership.role)) return { ok: true };
    return { ok: false, error: "Only a Business owner or manager can change where to find you." };
  } catch {
    return { ok: false, error: "You don't have access to this business." };
  }
}

export async function searchLocationsForAvailability(businessId: string, query: string) {
  const auth = await authorize(businessId);
  const admin = getAdminSupabase();
  if (!auth.ok || !admin) return [];
  return searchAvailabilityLocations(admin, query);
}

export async function requestAvailabilityAction(businessId: string, input: AvailabilityRequestInput): Promise<OwnerAvailabilityResult> {
  const auth = await authorize(businessId);
  if (!auth.ok) return auth;
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const result = await requestOwnerAvailability(admin, businessId, input);
  if (result.ok) await revalidatePublic(businessId);
  return result;
}

export async function updateAvailabilityAction(
  businessId: string,
  availabilityId: string,
  input: Omit<AvailabilityRequestInput, "locationId">
): Promise<OwnerAvailabilityResult & { changed?: boolean; returnedToReview?: boolean }> {
  const auth = await authorize(businessId);
  if (!auth.ok) return auth;
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const locationSlug = await locationSlugFor(businessId, availabilityId);
  const result = await updateOwnerAvailability(admin, businessId, availabilityId, input);
  if (result.ok) await revalidatePublic(businessId, locationSlug);
  return result;
}

export async function removeAvailabilityAction(businessId: string, availabilityId: string): Promise<OwnerAvailabilityResult> {
  const auth = await authorize(businessId);
  if (!auth.ok) return auth;
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const locationSlug = await locationSlugFor(businessId, availabilityId);
  const result = await removeOwnerAvailability(admin, businessId, availabilityId);
  if (result.ok) await revalidatePublic(businessId, locationSlug);
  return result;
}

/** Product Sets — the owner's saved, named groups of their own Products. Same
 * authorization as the entries they fill in; a Set only ever pre-fills the
 * selection, so nothing public changes when one is saved or deleted. */
export async function createProductSetAction(businessId: string, input: ProductSetInput): Promise<ProductSetResult> {
  const auth = await authorize(businessId);
  if (!auth.ok) return auth;
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const result = await createProductSet(admin, businessId, input);
  if (result.ok) revalidatePath(`/account/business/${businessId}`);
  return result;
}

export async function updateProductSetAction(businessId: string, setId: string, input: ProductSetInput): Promise<ProductSetResult> {
  const auth = await authorize(businessId);
  if (!auth.ok) return auth;
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const result = await updateProductSet(admin, businessId, setId, input);
  if (result.ok) revalidatePath(`/account/business/${businessId}`);
  return result;
}

export async function deleteProductSetAction(businessId: string, setId: string): Promise<ProductSetResult> {
  const auth = await authorize(businessId);
  if (!auth.ok) return auth;
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const result = await deleteProductSet(admin, businessId, setId);
  if (result.ok) revalidatePath(`/account/business/${businessId}`);
  return result;
}

export async function duplicateProductSetAction(businessId: string, setId: string): Promise<ProductSetResult> {
  const auth = await authorize(businessId);
  if (!auth.ok) return auth;
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const result = await duplicateProductSet(admin, businessId, setId);
  if (result.ok) revalidatePath(`/account/business/${businessId}`);
  return result;
}

/** Bulk change to the Business's footprint: one chunk per call (the browser
 * repeats with `cursor` until `done`). Scope is either explicit entry ids or a
 * filter the server resolves itself — never a client-supplied id list that was
 * not re-scoped to THIS Business. */
export async function bulkAvailabilityAction(
  businessId: string,
  scope: { kind: "ids"; ids: string[] } | { kind: "filter"; filter: unknown },
  rawOp: unknown,
  cursor: string | null
): Promise<BulkResult> {
  const auth = await authorize(businessId);
  if (!auth.ok) return auth;
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const checked = validateBulkOp(rawOp);
  if (!checked.ok) return checked;
  const resolved =
    scope && scope.kind === "ids"
      ? ({ kind: "ids", ids: Array.isArray(scope.ids) ? scope.ids.slice(0, BULK_IDS_MAX) : [] } as const)
      : ({ kind: "filter", filter: parseAvailabilityFilter((scope as { filter?: Record<string, unknown> } | null)?.filter ?? {}) } as const);
  const result = await bulkAvailability(admin, businessId, resolved, checked.op, typeof cursor === "string" ? cursor : null);
  if (result.ok && result.done) await revalidatePublic(businessId);
  return result;
}
