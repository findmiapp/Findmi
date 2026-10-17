"use server";

// Identity, Authorship & Entity Access V1 — Admin Business access controls
// on the existing Ownership tab. These only ever touch business_members
// rows: the Business itself and its Events, Locations, Appearances,
// Products, media, relationships and analytics are never deleted or
// detached (no table references business_members). Admin's own operational
// editing never depended on these rows (service role + Manage As), so it
// keeps working with zero members. Ownership moves only through the
// existing transfer_business_ownership / remove_business_owner RPCs.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { recordAccessEvents } from "@/lib/access-history";

const OWNERSHIP_ERROR: Record<string, string> = {
  target_not_found: "That member no longer exists or isn't part of this Business.",
  already_owner: "That member is already the owner.",
  ownership_conflict: "Ownership changed at the same moment — please refresh and try again.",
  no_current_owner: "There's no current owner to remove.",
};

const pathFor = (businessId: string) => `/admin/businesses/${businessId}?tab=ownership`;
const withQuery = (path: string, params: Record<string, string>) => `${path}&${new URLSearchParams(params).toString()}`;

/** Make / transfer owner: the member (of THIS Business) becomes owner; a
 * current owner, if any, becomes manager. Works when there is no owner. */
export async function makeBusinessOwner(businessId: string, memberId: string) {
  const supabase = await requireAdminSupabase();
  const { data: target } = await supabase.from("business_members").select("user_id").eq("id", memberId).eq("business_id", businessId).maybeSingle();
  if (!target) redirect(withQuery(pathFor(businessId), { error: OWNERSHIP_ERROR.target_not_found }));
  const { error } = await supabase.rpc("transfer_business_ownership", { p_business_id: businessId, p_new_owner_member_id: memberId });
  if (error) redirect(withQuery(pathFor(businessId), { error: OWNERSHIP_ERROR[error.message] ?? "Couldn't change the owner." }));
  await recordAccessEvents(supabase, [
    { entityType: "business", entityId: businessId, action: "ownership_transferred", actor: { kind: "admin" }, subjectUserId: (target as { user_id: string }).user_id, detail: {} },
  ]);
  revalidatePath(pathFor(businessId));
  redirect(withQuery(pathFor(businessId), { member_updated: "1" }));
}

/** Removes the owner's access (the Business stays, unowned). */
export async function removeBusinessOwnerAccess(businessId: string) {
  const supabase = await requireAdminSupabase();
  const { data: owner } = await supabase.from("business_members").select("user_id").eq("business_id", businessId).eq("role", "owner").maybeSingle();
  const { error } = await supabase.rpc("remove_business_owner", { p_business_id: businessId });
  if (error) redirect(withQuery(pathFor(businessId), { error: OWNERSHIP_ERROR[error.message] ?? "Couldn't remove the owner." }));
  await recordAccessEvents(supabase, [
    { entityType: "business", entityId: businessId, action: "owner_removed", actor: { kind: "admin" }, subjectUserId: (owner as { user_id: string } | null)?.user_id ?? null, detail: {} },
  ]);
  revalidatePath(pathFor(businessId));
  redirect(withQuery(pathFor(businessId), { member_updated: "1" }));
}

/** Remove All Managers / Return To Unclaimed: deletes EVERY
 * business_members row of this one Business — and nothing else. Requires
 * the typed confirmation "REMOVE". Pending claims are untouched (the
 * Business then reads Claim Pending until Admin reviews them). */
export async function removeAllBusinessManagers(businessId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "REMOVE") {
    redirect(withQuery(pathFor(businessId), { error: "Type REMOVE to confirm removing every manager." }));
  }
  const { data, error } = await supabase.from("business_members").delete().eq("business_id", businessId).select("user_id, role");
  if (error) redirect(withQuery(pathFor(businessId), { error: "Couldn't remove the managers. Nothing was changed." }));
  const removed = (data ?? []) as { user_id: string; role: string }[];
  const { count: pending } = await supabase
    .from("business_claim_requests")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("status", "pending");
  await recordAccessEvents(supabase, [
    {
      entityType: "business",
      entityId: businessId,
      action: "all_managers_removed",
      actor: { kind: "admin" },
      detail: { removed: removed.map((r) => ({ user_id: r.user_id, role: r.role })), state_after: (pending ?? 0) > 0 ? "claim_pending" : "unclaimed" },
    },
  ]);
  revalidatePath(pathFor(businessId));
  redirect(withQuery(pathFor(businessId), { member_updated: "1" }));
}
