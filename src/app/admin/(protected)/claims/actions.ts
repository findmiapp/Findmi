"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import type { ClaimEntityType } from "@/lib/admin/claim-queries";
import { getAccountEmail } from "@/lib/notifications/recipients";
import { sendProductNotification } from "@/lib/notifications/productNotify";

const ENTITY_TABLE: Record<ClaimEntityType, "businesses" | "events" | "locations"> = {
  business: "businesses",
  event: "events",
  location: "locations",
};
const MANAGER_PATH: Record<ClaimEntityType, string> = {
  business: "/account/business",
  event: "/account/event",
  location: "/account/location",
};
const ENTITY_LABEL: Record<ClaimEntityType, string> = {
  business: "Business",
  event: "Event",
  location: "Venue",
};

/** Claim decision notification — the claimant, resolved through their
 * real authenticated account email (never the claim's own editable
 * contact-email field), never the entity's public listing email. Called
 * AFTER the claim row/RPC has already committed — a Resend failure here
 * never affects the claim decision itself (see sendProductNotification's
 * own best-effort contract). */
const APPROVE_RPC: Record<ClaimEntityType, "approve_business_claim" | "approve_event_claim" | "approve_location_claim"> = {
  business: "approve_business_claim",
  event: "approve_event_claim",
  location: "approve_location_claim",
};

const CLAIM_TABLE: Record<ClaimEntityType, "business_claim_requests" | "event_claim_requests" | "location_claim_requests"> = {
  business: "business_claim_requests",
  event: "event_claim_requests",
  location: "location_claim_requests",
};

/** Claim decision notification — the claimant, resolved through their
 * real authenticated account email (never the claim's own editable
 * contact-email field, never the entity's public listing email). Called
 * AFTER the claim row/RPC has already committed — a Resend failure here
 * never affects the claim decision itself (see sendProductNotification's
 * own best-effort contract). Re-reads the claim row itself rather than
 * threading extra data through approveClaim/rejectClaim's own signatures
 * — one small extra read, same shape as every other notification call
 * site in this pass. */
async function notifyClaimant(
  supabase: Awaited<ReturnType<typeof requireAdminSupabase>>,
  entityType: ClaimEntityType,
  claimId: string,
  decision: "approved" | "rejected"
): Promise<void> {
  const { data: claim } = await supabase
    .from(CLAIM_TABLE[entityType])
    .select(`user_id, entity:${ENTITY_TABLE[entityType]}(id, name)`)
    .eq("id", claimId)
    .maybeSingle();
  if (!claim) return;

  const userId = (claim as { user_id: string }).user_id;
  const entityRaw = (claim as { entity: { id: string; name: string } | { id: string; name: string }[] | null }).entity;
  const entity = Array.isArray(entityRaw) ? entityRaw[0] : entityRaw;
  const entityName = entity?.name ?? "your listing";
  const email = await getAccountEmail(supabase, userId);
  if (!email) return;

  const label = ENTITY_LABEL[entityType];
  if (decision === "approved") {
    await sendProductNotification({
      type: "claim_approved",
      to: [email],
      subject: `Your ${label} claim was approved — ${entityName}`,
      heading: `Your ${label.toLowerCase()} claim was approved`,
      body: [
        `Great news — your claim on ${entityName} has been approved.`,
        `You now have management access to this ${label.toLowerCase()} on Findmi.`,
      ],
      actionLabel: `Manage ${entityName}`,
      actionUrl: entity ? `${MANAGER_PATH[entityType]}/${entity.id}` : "/account",
    });
  } else {
    await sendProductNotification({
      type: "claim_rejected",
      to: [email],
      subject: `Update on your ${label} claim — ${entityName}`,
      heading: `Your ${label.toLowerCase()} claim wasn't approved`,
      body: [
        `Your claim on ${entityName} wasn't approved this time.`,
        `If you believe this ${label.toLowerCase()} is genuinely yours, you can submit a new claim with more detail about your connection to it.`,
      ],
      actionLabel: "View Findmi",
      actionUrl: "/account",
    });
  }
}

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
 * against the same business/event/location.
 *
 * Claiming a business, event, or location is free — there is no payment
 * gate here. payment_status/payment_amount/paid_at stay on the claim
 * tables for schema uniformity across the generic claims UI, but they're
 * never checked before approval for any entity type. */
export async function approveClaim(entityType: ClaimEntityType, claimId: string) {
  const supabase = await requireAdminSupabase();

  const { data: claim } = await supabase
    .from(CLAIM_TABLE[entityType])
    .select("payment_status")
    .eq("id", claimId)
    .maybeSingle();
  if (!claim) {
    redirect(errorRedirectUrl("/admin/claims", "That claim no longer exists."));
  }

  const { error } = await supabase.rpc(APPROVE_RPC[entityType], { p_claim_id: claimId });

  if (error) {
    const message = FRIENDLY_ERROR[error.message] ?? "Couldn't approve this claim.";
    redirect(errorRedirectUrl("/admin/claims", message));
  }

  await notifyClaimant(supabase, entityType, claimId, "approved");

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

  await notifyClaimant(supabase, entityType, claimId, "rejected");

  revalidatePath("/admin/claims");
  redirect("/admin/claims?rejected=1");
}

// ── Current access (business_members / event_members) ──────────────────────
// Claim Membership Management pass. Deliberately separate from the claim
// actions above: these never touch business_claim_requests/
// event_claim_requests — only the CURRENT membership rows. Manager <->
// staff role changes and plain removal are single-statement, single-row
// writes — atomic by nature of being one UPDATE/DELETE, so (unlike
// ownership transfer/removal — see the pass report) no new RPC is needed
// for them. Ownership itself is NOT mutable from here: every write below
// carries `.neq("role", "owner")` in its WHERE clause, so even a
// hand-crafted/tampered request naming an owner's membership id matches
// zero rows server-side — a casual role dropdown can never promote to or
// demote an owner. Membership relationships are never trusted from the
// browser beyond the id; the guard re-checks the row's real, current role
// in the database on every write.

const MEMBER_TABLE: Record<ClaimEntityType, "business_members" | "event_members" | "location_members"> = {
  business: "business_members",
  event: "event_members",
  location: "location_members",
};

const VALID_NON_OWNER_ROLES = ["manager", "staff"];

export async function updateMemberRole(entityType: ClaimEntityType, memberId: string, role: string) {
  const supabase = await requireAdminSupabase();
  if (!VALID_NON_OWNER_ROLES.includes(role)) {
    redirect(errorRedirectUrl("/admin/claims", "Invalid role."));
  }

  const { data, error } = await supabase
    .from(MEMBER_TABLE[entityType])
    .update({ role })
    .eq("id", memberId)
    .neq("role", "owner")
    .select()
    .maybeSingle();

  if (error || !data) {
    redirect(errorRedirectUrl("/admin/claims", "Couldn't update that member's role — they may no longer be a member."));
  }

  revalidatePath("/admin/claims");
  redirect("/admin/claims?member_updated=1");
}

/** Removes a manager/staff member's access entirely. Removing the OWNER is
 * a deliberately separate action — see removeOwner() below, which goes
 * through remove_business_owner()/remove_event_owner() instead; this
 * action's own `.neq("role", "owner")` guard makes sure it can never be
 * used for that even by accident. */
export async function removeMember(entityType: ClaimEntityType, memberId: string) {
  const supabase = await requireAdminSupabase();

  const { data, error } = await supabase
    .from(MEMBER_TABLE[entityType])
    .delete()
    .eq("id", memberId)
    .neq("role", "owner")
    .select()
    .maybeSingle();

  if (error || !data) {
    redirect(errorRedirectUrl("/admin/claims", "Couldn't remove that member — they may no longer be a member."));
  }

  revalidatePath("/admin/claims");
  redirect("/admin/claims?member_updated=1");
}

// ── Ownership transfer / removal ────────────────────────────────────────
// Unlike role changes/removal above, ownership itself can only move via
// the reviewed transfer_business_ownership()/transfer_event_ownership()/
// remove_business_owner()/remove_event_owner() RPCs (see
// supabase/migrations/20260902020000_ownership_transfer_rpcs.sql) — those
// functions are the sole atomic authority for it; nothing here reproduces
// the demote/promote/delete sequence in TypeScript, and no multi-step
// application-level "transaction" is attempted. Both actions below do
// nothing but: authenticate as founder admin, validate the inputs they
// were given, and call exactly one of the four service-role-only RPCs.

const TRANSFER_RPC: Record<
  ClaimEntityType,
  "transfer_business_ownership" | "transfer_event_ownership" | "transfer_location_ownership"
> = {
  business: "transfer_business_ownership",
  event: "transfer_event_ownership",
  location: "transfer_location_ownership",
};
const REMOVE_OWNER_RPC: Record<ClaimEntityType, "remove_business_owner" | "remove_event_owner" | "remove_location_owner"> = {
  business: "remove_business_owner",
  event: "remove_event_owner",
  location: "remove_location_owner",
};
const ENTITY_ID_PARAM: Record<ClaimEntityType, "p_business_id" | "p_event_id" | "p_location_id"> = {
  business: "p_business_id",
  event: "p_event_id",
  location: "p_location_id",
};

// Matches the short exception messages raised by the four RPCs above.
const OWNERSHIP_FRIENDLY_ERROR: Record<string, string> = {
  target_not_found: "That member no longer exists or isn't part of this business/event.",
  already_owner: "That member is already the owner.",
  ownership_conflict: "Ownership changed at the same moment by another action — please refresh and try again.",
  no_current_owner: "There's no current owner to remove.",
};

/** Transfer target is always resolved server-side to a business_members/
 * event_members ROW ID the browser submitted (never a user_id) — the RPC
 * itself re-validates that row actually belongs to this business/event
 * (see the migration's target_not_found check), so a tampered id is
 * rejected by the database, not merely by client-side UI restrictions. */
export async function transferOwnership(entityType: ClaimEntityType, entityId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();

  const targetMemberId = str(formData, "target_member_id");
  if (!targetMemberId) {
    redirect(errorRedirectUrl("/admin/claims", "Choose a member to transfer ownership to."));
  }

  const { error } = await supabase.rpc(TRANSFER_RPC[entityType], {
    [ENTITY_ID_PARAM[entityType]]: entityId,
    p_new_owner_member_id: targetMemberId,
  });

  if (error) {
    redirect(errorRedirectUrl("/admin/claims", OWNERSHIP_FRIENDLY_ERROR[error.message] ?? "Couldn't transfer ownership."));
  }

  revalidatePath("/admin/claims");
  redirect("/admin/claims?member_updated=1");
}

/** Remove Owner / Leave Unowned — the separate, more destructive action.
 * Goes through remove_business_owner()/remove_event_owner() (a DELETE of
 * the owner's membership row, done atomically inside the RPC), never a
 * direct membership delete from here. */
export async function removeOwner(entityType: ClaimEntityType, entityId: string) {
  const supabase = await requireAdminSupabase();

  const { error } = await supabase.rpc(REMOVE_OWNER_RPC[entityType], {
    [ENTITY_ID_PARAM[entityType]]: entityId,
  });

  if (error) {
    redirect(errorRedirectUrl("/admin/claims", OWNERSHIP_FRIENDLY_ERROR[error.message] ?? "Couldn't remove the owner."));
  }

  revalidatePath("/admin/claims");
  redirect("/admin/claims?member_updated=1");
}
