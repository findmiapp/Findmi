"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember } from "@/lib/permissions";
import { isManagingRole } from "@/lib/business-locations";
import { getCurrentUser } from "@/lib/supabase/server";
import { setMomentDisplay, type MomentDisplayResult } from "@/lib/entity-moment-display";

/** Show / hide a Moment on THIS Business's public profile.
 *
 * A display preference, not ownership: it never edits, unpublishes or deletes
 * the Moment, and never changes anything on its author, its Event, its
 * Location or any other Business. Only an owner/manager (or an elevated Admin
 * session, resolved by requireBusinessMember) may set it, and only for a
 * Moment that is actually connected to this Business and eligible to appear on
 * its profile (tagged to it, public, published) — re-verified here against the
 * database, never trusted from the client. */
export async function setMomentProfileDisplayAction(businessId: string, entryId: string, hidden: boolean): Promise<MomentDisplayResult> {
  try {
    const membership = await requireBusinessMember(businessId);
    if (!membership.viaAdmin && !isManagingRole(membership.role)) return { ok: false, error: "Only a Business owner or manager can change what shows on your profile." };
  } catch {
    return { ok: false, error: "You don't have access to this business." };
  }
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };

  const [{ data: connection }, { data: entry }, { data: business }] = await Promise.all([
    admin.from("journal_entry_connections").select("id").eq("journal_entry_id", entryId).eq("business_id", businessId).limit(1).maybeSingle(),
    admin.from("journal_entries").select("id, visibility, status").eq("id", entryId).maybeSingle(),
    admin.from("businesses").select("slug").eq("id", businessId).maybeSingle(),
  ]);
  const e = entry as { visibility: string; status: string } | null;
  if (!connection || !e || e.visibility !== "public" || e.status !== "published") return { ok: false, error: "That Moment isn't connected to your profile." };

  const user = await getCurrentUser();
  const result = await setMomentDisplay(admin, "business", businessId, entryId, hidden ? "hidden" : "shown", user?.id ?? null);
  if (result.ok) {
    revalidatePath(`/account/business/${businessId}`);
    const slug = (business as { slug: string | null } | null)?.slug;
    if (slug) revalidatePath(`/business/${slug}`);
  }
  return result;
}
