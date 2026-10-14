"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { connectBusinessLocationAvailability, removeBusinessLocationAvailability } from "@/lib/business-location-availability";

/** Find Us At V1 — founder admin management of where a Business/Brand is
 * normally available (business_location_availability). Admin only (no
 * Business self-service in V1). Connecting is idempotent and refused when
 * the Business already operates that Location (Our Locations). Removing
 * deletes only the availability row. Never inferred from Events/Appearances. */

function tabPath(businessId: string): string {
  return `/admin/businesses/${businessId}?tab=find-us-at`;
}

async function done(businessId: string, params: Record<string, string>): Promise<never> {
  revalidatePath(`/admin/businesses/${businessId}`);
  const admin = await requireAdminSupabase();
  const { data } = await admin.from("businesses").select("slug").eq("id", businessId).maybeSingle();
  const slug = (data as { slug: string } | null)?.slug;
  if (slug) revalidatePath(`/business/${slug}`);
  redirect(`${tabPath(businessId)}&${new URLSearchParams(params).toString()}`);
}

export async function adminConnectFindUsAt(businessId: string, formData: FormData) {
  const admin = await requireAdminSupabase();
  const locationId = String(formData.get("location_id") ?? "").trim();
  if (!locationId) return done(businessId, { error: "Choose a location to connect." });
  const result = await connectBusinessLocationAvailability(admin, businessId, locationId);
  return done(businessId, result.ok ? { saved: "1" } : { error: result.error });
}

export async function adminRemoveFindUsAt(businessId: string, locationId: string) {
  const admin = await requireAdminSupabase();
  const result = await removeBusinessLocationAvailability(admin, businessId, locationId);
  return done(businessId, result.ok ? { saved: "1" } : { error: result.error });
}
