"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getCurrentUser } from "@/lib/supabase/server";
import { requireEventMember, requireLocationMember } from "@/lib/permissions";
import { isPageManagerRole } from "@/lib/capabilities";
import { setMomentDisplay, type MomentDisplayResult, type MomentDisplayState } from "@/lib/entity-moment-display";
import { isEntryOnEntityPage, type EntityMomentKind } from "@/lib/entity-moments";

/** Show / Hide / Feature a Moment on ONE Location or Event page.
 *
 * A display preference of that page only — it never edits, unpublishes or deletes the
 * Moment and changes nothing on its author or any other page. Only an owner/manager of
 * THAT Location or Event (or an elevated Admin session, resolved by the membership
 * check) may set it; Staff stay read-only. The Moment must actually be eligible for the
 * page (public, published and connected to it), re-verified here against the database. */
export async function setEntityMomentDisplayAction(kind: EntityMomentKind, entityId: string, entryId: string, display: MomentDisplayState): Promise<MomentDisplayResult> {
  if ((kind !== "location" && kind !== "event") || (display !== "shown" && display !== "hidden" && display !== "featured")) return { ok: false, error: "Choose what to do." };
  try {
    const membership = kind === "location" ? await requireLocationMember(entityId) : await requireEventMember(entityId);
    if (!membership.viaAdmin && !isPageManagerRole(membership.role)) return { ok: false, error: `Only an owner or manager can change what shows on this ${kind}.` };
  } catch {
    return { ok: false, error: `You don't have access to this ${kind}.` };
  }
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  if (!(await isEntryOnEntityPage(admin, kind, entityId, entryId))) return { ok: false, error: `That Moment isn't connected to this ${kind}.` };

  const user = await getCurrentUser();
  const result = await setMomentDisplay(admin, kind, entityId, entryId, display, user?.id ?? null);
  if (result.ok) {
    revalidatePath(`/account/${kind}/${entityId}`);
    const { data } = await admin.from(kind === "location" ? "locations" : "events").select("slug").eq("id", entityId).maybeSingle();
    const slug = (data as { slug: string | null } | null)?.slug;
    if (slug) revalidatePath(`/${kind}/${slug}`);
  }
  return result;
}
