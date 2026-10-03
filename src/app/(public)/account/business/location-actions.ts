"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember, requireLocationMember } from "@/lib/permissions";
import {
  isManagingRole,
  linkBusinessLocation,
  setPrimaryBusinessLocation,
  unlinkBusinessLocation,
} from "@/lib/business-locations";

/** /account V2 Pass 2 — owner self-service for a Business's Locations
 * (Presence -> Locations). Authorization is always re-derived server-side:
 *
 *   connect / remove — owner/manager of the Business AND owner/manager of
 *     the Location. Managing a Business never by itself lets anyone attach
 *     (or detach) an arbitrary Location.
 *   set primary — owner/manager of the Business; the Location must
 *     already be connected (primary is the Business's own display
 *     preference and grants nothing over the Location).
 *
 * Writes go through the service-role client (business_locations grants
 * authenticated users read only). */

function locationsPath(businessId: string): string {
  return `/account/business/${businessId}?tab=findmi-here&view=locations`;
}

function back(businessId: string, params: Record<string, string>): never {
  redirect(`${locationsPath(businessId)}&${new URLSearchParams(params).toString()}`);
}

async function requireBusinessManager(businessId: string) {
  try {
    const membership = await requireBusinessMember(businessId);
    if (!isManagingRole(membership.role)) back(businessId, { error: "Only owners and managers can change this business's locations." });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back(businessId, { error: "You don't have access to this business." });
  }
}

async function requireLocationManager(businessId: string, locationId: string) {
  try {
    const membership = await requireLocationMember(locationId);
    if (!isManagingRole(membership.role)) back(businessId, { error: "You need to manage that location to change its connection." });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back(businessId, { error: "You need to manage that location to change its connection." });
  }
}

// next/navigation's redirect() throws a special error — never swallow it.
function isRedirect(err: unknown): boolean {
  return typeof err === "object" && err !== null && "digest" in err && String((err as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT");
}

function adminOrBack(businessId: string) {
  const admin = getAdminSupabase();
  if (!admin) back(businessId, { error: "Server isn't configured." });
  return admin;
}

function revalidate(businessId: string) {
  revalidatePath(`/account/business/${businessId}`);
}

export async function connectBusinessLocation(businessId: string, formData: FormData) {
  const locationId = String(formData.get("location_id") ?? "").trim();
  if (!locationId) back(businessId, { error: "Choose a location to connect." });
  await requireBusinessManager(businessId);
  await requireLocationManager(businessId, locationId);
  const admin = adminOrBack(businessId);
  const result = await linkBusinessLocation(admin, businessId, locationId);
  if (!result.ok) back(businessId, { error: result.error });
  revalidate(businessId);
  back(businessId, { location_updated: "connected" });
}

export async function removeBusinessLocation(businessId: string, locationId: string) {
  await requireBusinessManager(businessId);
  await requireLocationManager(businessId, locationId);
  const admin = adminOrBack(businessId);
  const result = await unlinkBusinessLocation(admin, businessId, locationId);
  if (!result.ok) back(businessId, { error: result.error });
  revalidate(businessId);
  back(businessId, { location_updated: "removed" });
}

export async function makePrimaryBusinessLocation(businessId: string, locationId: string) {
  await requireBusinessManager(businessId);
  const admin = adminOrBack(businessId);
  const result = await setPrimaryBusinessLocation(admin, businessId, locationId);
  if (!result.ok) back(businessId, { error: result.error });
  revalidate(businessId);
  back(businessId, { location_updated: "primary" });
}
