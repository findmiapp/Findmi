"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import type { ClaimEntityType } from "@/lib/admin/claim-queries";

const APPROVE_RPC: Record<ClaimEntityType, "approve_business_claim" | "approve_event_claim"> = {
  business: "approve_business_claim",
  event: "approve_event_claim",
};

const CLAIM_TABLE: Record<ClaimEntityType, "business_claim_requests" | "event_claim_requests"> = {
  business: "business_claim_requests",
  event: "event_claim_requests",
};

// Matches the short exception messages raised by approve_business_claim()/
// approve_event_claim() in the claim foundation migration.
const FRIENDLY_ERROR: Record<string, string> = {
  claim_not_found: "That claim no longer exists.",
  claim_not_pending: "That claim has already been reviewed.",
  already_member: "That person is already a member — nothing to approve.",
  already_owned: "This already has an owner — reject this claim or resolve it manually before approving another.",
};

/** Approval is the one permission-grant event in this whole feature, and
 * it has to be atomic (claim-still-pending + not-already-member +
 * no-existing-owner + grant membership + mark approved, all together or
 * not at all) — done via a single service-role-only Postgres function
 * (see the migration) rather than a multi-write sequence from here, which
 * would leave a real window for two concurrent approvals to both succeed
 * against the same business/event. */
export async function approveClaim(entityType: ClaimEntityType, claimId: string) {
  const supabase = await requireAdminSupabase();
  const { error } = await supabase.rpc(APPROVE_RPC[entityType], { p_claim_id: claimId });

  if (error) {
    const message = FRIENDLY_ERROR[error.message] ?? "Couldn't approve this claim.";
    redirect(errorRedirectUrl("/admin/claims", message));
  }

  revalidatePath("/admin/claims");
  redirect("/admin/claims?approved=1");
}

/** Rejection never creates a membership row, so unlike approval it's
 * already atomic as a single guarded UPDATE — no function needed. */
export async function rejectClaim(entityType: ClaimEntityType, claimId: string) {
  const supabase = await requireAdminSupabase();
  const table = CLAIM_TABLE[entityType];

  const { data, error } = await supabase
    .from(table)
    .update({ status: "rejected", reviewed_at: new Date().toISOString() })
    .eq("id", claimId)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (error || !data) {
    redirect(errorRedirectUrl("/admin/claims", "Couldn't reject — the claim may have already been reviewed."));
  }

  revalidatePath("/admin/claims");
  redirect("/admin/claims?rejected=1");
}
