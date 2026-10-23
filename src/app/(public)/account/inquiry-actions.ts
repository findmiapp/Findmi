"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember, requireEventMember, requireLocationMember, type Membership } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/supabase/server";
import { isTargetKind } from "@/lib/commercial-intents";
import { isInquiryStatus } from "@/lib/commercial-inquiries-domain";
import { getInquiryRow, inquiryActorForEntity, sendCommercialInquiry, setInquiryOutcome, type InquiryOutcomeResult } from "@/lib/commercial-inquiries";

/** Commercial Inquiry v1 — member actions. Every call re-verifies the session
 * server-side against the exact entity it acts as (never trusts ids from the
 * client): sending and withdrawing need an owner / manager of the SENDING
 * Business (a founder Admin session in Manage-As may send on its behalf);
 * Accept / Decline need an owner / manager of the entity the Inquiry was
 * routed to. Findmi's own outcomes and replies are Admin-only
 * (admin/(protected)/commercial-inquiries/actions.ts). Nothing here touches
 * the Target beyond the documented Target → In Conversation move, and nothing
 * creates Find Us Here, Appearances, participation, Opportunities or Orders. */

const MANAGING = ["owner", "manager"];
const isManager = (m: Membership) => MANAGING.includes(m.role) || Boolean(m.viaHost);

async function membershipFor(entityType: string, entityId: string): Promise<Membership | null> {
  try {
    if (entityType === "business") return await requireBusinessMember(entityId);
    if (entityType === "location") return await requireLocationMember(entityId);
    if (entityType === "event") return await requireEventMember(entityId);
  } catch {
    return null;
  }
  return null;
}

const refresh = (businessId: string | null) => {
  if (businessId) revalidatePath(`/account/business/${businessId}`);
  revalidatePath("/account/messages");
};

export type SendInquiryActionResult = { ok: true; inquiryId: string; href: string; existing: boolean } | { ok: false; error: string; participation?: boolean };

/** Send (or, for a double tap / retry, re-resolve) one Inquiry from a Business. */
export async function sendInquiryAction(
  businessId: string,
  input: { targetId: string | null; kind: string; counterpartyId: string; intent: string; message: string; requestKey: string }
): Promise<SendInquiryActionResult> {
  const membership = await membershipFor("business", businessId);
  if (!membership) return { ok: false, error: "You don't have access to this business." };
  if (!membership.viaAdmin && !isManager(membership)) return { ok: false, error: "Only a Business owner or manager can send an Inquiry." };
  if (!isTargetKind(input.kind)) return { ok: false, error: "Choose who to contact." };
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const user = membership.viaAdmin ? null : await getCurrentUser().catch(() => null);
  const result = await sendCommercialInquiry(admin, {
    senderBusinessId: businessId,
    userId: user?.id ?? null,
    targetId: input.targetId,
    kind: input.kind,
    counterpartyId: input.counterpartyId,
    intent: input.intent,
    message: input.message,
    requestKey: input.requestKey,
  });
  if (!result.ok) return result;
  refresh(businessId);
  return { ok: true, inquiryId: result.inquiryId, href: `/account/business/${businessId}/inquiries/${result.inquiryId}`, existing: result.existing };
}

/** Accept / Decline (counterparty) or Withdraw (sender), acting as one of the
 * viewer's own entities. A founder Admin session never acts through here —
 * Findmi's outcomes come from Admin, as Findmi. */
export async function inquiryOutcomeAction(inquiryId: string, asEntity: { entityType: string; entityId: string }, next: string): Promise<InquiryOutcomeResult> {
  if (!isInquiryStatus(next)) return { ok: false, error: "That isn't an Inquiry outcome." };
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const inquiry = await getInquiryRow(admin, inquiryId);
  if (!inquiry) return { ok: false, error: "That Inquiry wasn't found." };
  const actor = inquiryActorForEntity(inquiry, asEntity);
  if (!actor) return { ok: false, error: "You don't have access to this Inquiry." };
  const membership = await membershipFor(asEntity.entityType, asEntity.entityId);
  if (!membership || membership.viaAdmin) return { ok: false, error: "You don't have access to this Inquiry." };
  if (!isManager(membership)) return { ok: false, error: "Only an owner or manager can do that." };
  const result = await setInquiryOutcome(admin, inquiryId, actor, next);
  if (result.ok) refresh(asEntity.entityType === "business" ? asEntity.entityId : null);
  return result;
}
