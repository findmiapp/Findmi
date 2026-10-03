"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { linkBusinessLocation, setPrimaryBusinessLocation, unlinkBusinessLocation } from "@/lib/business-locations";

/** /account V2 Pass 2 — founder admin management of a Business's connected
 * Locations (Admin Business -> Locations tab). Admin session required
 * (requireAdminSupabase); writes go through the same shared helpers and
 * SQL functions as owner self-service. Deliberate, one at a time — never
 * inferred or backfilled. Removing only ever deletes the relationship row. */

function tabPath(businessId: string): string {
  return `/admin/businesses/${businessId}?tab=locations`;
}

function done(businessId: string, params: Record<string, string>): never {
  revalidatePath(`/admin/businesses/${businessId}`);
  revalidatePath(`/account/business/${businessId}`);
  redirect(`${tabPath(businessId)}&${new URLSearchParams(params).toString()}`);
}

export async function adminConnectBusinessLocation(businessId: string, formData: FormData) {
  const admin = await requireAdminSupabase();
  const locationId = String(formData.get("location_id") ?? "").trim();
  if (!locationId) done(businessId, { error: "Choose a location to connect." });
  const result = await linkBusinessLocation(admin, businessId, locationId);
  done(businessId, result.ok ? { saved: "1" } : { error: result.error });
}

export async function adminRemoveBusinessLocation(businessId: string, locationId: string) {
  const admin = await requireAdminSupabase();
  const result = await unlinkBusinessLocation(admin, businessId, locationId);
  done(businessId, result.ok ? { saved: "1" } : { error: result.error });
}

export async function adminSetPrimaryBusinessLocation(businessId: string, locationId: string) {
  const admin = await requireAdminSupabase();
  const result = await setPrimaryBusinessLocation(admin, businessId, locationId);
  done(businessId, result.ok ? { saved: "1" } : { error: result.error });
}
