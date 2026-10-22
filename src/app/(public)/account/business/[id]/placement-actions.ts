"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { isAdminSession } from "@/lib/admin/auth";
import { requireBusinessMember } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/supabase/server";
import { insertInlinePlace } from "@/lib/places/inline-place";
import type { CreateInlineLocationResult } from "@/lib/locationCreation";
import type { SelectedLocationDetail } from "@/components/account/EventLocationField";
import { canEditPlacements, parseActivityCursor, placementActor, type PlacementStatus, type PlacementUpdateInput } from "@/lib/business-placements-domain";
import {
  addBusinessPlacement,
  addPlacementNote,
  adminSetPlacementInternalNotes,
  getPlacementActivityPage,
  searchTargetLocations,
  updateBusinessPlacement,
  type PlacementActivityPage,
  type PlacementResult,
} from "@/lib/business-placements";

/** Owner mutations for Findmi Here → Find Us Here → Targets. Each re-verifies
 * the caller against THIS Business server-side (never trusts the id as sent):
 * an owner or manager — or a founder Admin session, which requireBusinessMember
 * already resolves (Manage-As) — may write; staff are read-only. Nothing here
 * can write internal_notes except saveTargetInternalNotesAction, which requires
 * a founder Admin session itself, never Business membership. Nothing here
 * changes anything public: Targets are private, so only the manager page is
 * revalidated. */

async function authorizeWrite(businessId: string): Promise<{ ok: true; viaAdmin: boolean } | { ok: false; error: string }> {
  try {
    const membership = await requireBusinessMember(businessId);
    if (canEditPlacements(membership.role, membership.viaAdmin)) return { ok: true, viaAdmin: Boolean(membership.viaAdmin) };
    return { ok: false, error: "Only a Business owner or manager can change Targets." };
  } catch {
    return { ok: false, error: "You don't have access to this business." };
  }
}

/** Any member of THIS Business (staff included) or a founder Admin session — Activity is readable by the whole team. */
async function authorizeRead(businessId: string): Promise<boolean> {
  try {
    await requireBusinessMember(businessId);
    return true;
  } catch {
    return false;
  }
}

/** Who the database should record as having acted (Findmi for a Manage-As Admin session). */
async function actingAs(viaAdmin: boolean) {
  const user = viaAdmin ? null : await getCurrentUser().catch(() => null);
  return placementActor(viaAdmin, user?.id ?? null);
}

const refresh = (businessId: string) => revalidatePath(`/account/business/${businessId}`);

/** Linkable places for the Add Target picker (published and not-yet-public). */
export async function searchTargetLocationsAction(businessId: string, query: string): Promise<SelectedLocationDetail[]> {
  const auth = await authorizeWrite(businessId);
  const admin = getAdminSupabase();
  if (!auth.ok || !admin) return [];
  return searchTargetLocations(admin, query);
}

/** The place isn't on Findmi yet: the SAME inline place creation every other
 * picker uses (lib/places/inline-place.ts — duplicate check first unless the
 * person explicitly chose "Add as a new place", an unlisted Location, no
 * membership or Business Location for anyone). Only this action's
 * authorization differs: the caller must be able to edit THIS Business's
 * Targets (which also lets a founder Admin session add one). The new place is
 * then attached with addTargetAction like any picked place. */
export async function createTargetPlaceAction(businessId: string, formData: FormData): Promise<CreateInlineLocationResult> {
  const auth = await authorizeWrite(businessId);
  if (!auth.ok) return { status: "error", error: auth.error };
  const admin = getAdminSupabase();
  if (!admin) return { status: "error", error: "Server isn't configured." };
  return insertInlinePlace(admin, formData);
}

export async function addTargetAction(
  businessId: string,
  locationId: string
): Promise<{ ok: true; id: string; existing: boolean; status: PlacementStatus } | { ok: false; error: string }> {
  const auth = await authorizeWrite(businessId);
  if (!auth.ok) return auth;
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const user = await getCurrentUser().catch(() => null);
  const result = await addBusinessPlacement(admin, businessId, { locationId, source: auth.viaAdmin ? "admin" : "business", userId: user?.id ?? null });
  if (result.ok) refresh(businessId);
  return result;
}

export async function updateTargetAction(businessId: string, placementId: string, input: PlacementUpdateInput): Promise<PlacementResult & { changed?: boolean }> {
  const auth = await authorizeWrite(businessId);
  if (!auth.ok) return auth;
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  // Only the four Business fields are forwarded — whatever else arrives is dropped here.
  // A status change records its own Activity in the database (with this actor).
  const result = await updateBusinessPlacement(
    admin,
    businessId,
    placementId,
    {
      status: input?.status,
      notes: input?.notes,
      nextAction: input?.nextAction,
      nextActionAt: input?.nextActionAt,
    },
    await actingAs(auth.viaAdmin)
  );
  if (result.ok && result.changed) refresh(businessId);
  return result;
}

/** Findmi-only notes (managed service). Requires a founder Admin session —
 * Business membership, of any role, is never enough. */
export async function saveTargetInternalNotesAction(businessId: string, placementId: string, notes: string): Promise<PlacementResult> {
  if (!(await isAdminSession())) return { ok: false, error: "Only Findmi can change internal notes." };
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const result = await adminSetPlacementInternalNotes(admin, businessId, placementId, notes);
  if (result.ok) refresh(businessId);
  return result;
}

/** Add Note: appends a NEW Activity entry (owner, manager or founder Admin). */
export async function addTargetNoteAction(businessId: string, placementId: string, body: string): Promise<PlacementResult> {
  const auth = await authorizeWrite(businessId);
  if (!auth.ok) return auth;
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const result = await addPlacementNote(admin, businessId, placementId, body, await actingAs(auth.viaAdmin));
  if (result.ok) refresh(businessId);
  return result;
}

/** "Load More" — the next (older) page of an opened Target's Activity. */
export async function loadTargetActivityAction(businessId: string, placementId: string, before: string): Promise<PlacementActivityPage> {
  const admin = getAdminSupabase();
  const cursor = parseActivityCursor(before);
  if (!admin || !cursor || !(await authorizeRead(businessId))) return { available: false, items: [], nextCursor: null };
  return getPlacementActivityPage(admin, businessId, placementId, cursor);
}
