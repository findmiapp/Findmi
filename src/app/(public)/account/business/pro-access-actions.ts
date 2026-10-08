"use server";

import { redirect } from "next/navigation";
import { requireBusinessMember } from "@/lib/permissions";
import { isManagingRole } from "@/lib/business-locations";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { isBusinessPro } from "@/lib/entitlements";
import { notifyAdmin } from "@/lib/notifications/adminNotify";

/** Pro Access Request Workflow V1 — the one owner-facing entry point that
 * SUBMITS a request for Findmi Pro. Never touches Stripe, never creates a
 * Checkout Session, never writes plan_tier/plan_expires_at itself — this
 * only inserts a business_pro_access_requests row; the actual Pro grant
 * happens later, admin-side, via approve_pro_access_request() (see
 * src/app/admin/(protected)/pro-requests/actions.ts).
 *
 * Authorization, Pass 2 correction — owner/manager ONLY, never staff:
 * initiating a request that changes the business's commercial/service
 * relationship with Findmi is an owner/manager-level decision, the same
 * "isManagingRole" bar src/lib/business-locations.ts already draws for
 * the equivalent class of decision on Locations (staff can't connect
 * places there either). An admin-elevated "Manage-As" session is refused
 * outright regardless of its synthesized role (requireMembership() gives
 * it role "owner" so Admin Manage-As keeps working for ordinary entity
 * management — see lib/permissions.ts — but this identity-sensitive
 * action stays real-member-only, same rule startBusinessProCheckout/
 * startSubscriptionCheckout already apply to starting a real checkout).
 * Enforced at BOTH layers: this check, AND the INSERT policy's own
 * `role in ('owner','manager')` condition (see the migration) — a crafted
 * direct request can never bypass this server-side check. */
export async function requestProAccess(businessId: string, formData: FormData) {
  const requestPath = `/account/business/${businessId}/pro-request`;

  let membership;
  try {
    membership = await requireBusinessMember(businessId);
  } catch (err) {
    redirect(errorRedirectUrl("/account", err instanceof Error ? err.message : "You don't have access to this business."));
  }
  if (membership.viaAdmin) {
    redirect(errorRedirectUrl(requestPath, "Exit Admin Mode to request Pro access for this business."));
  }
  if (!isManagingRole(membership.role)) {
    redirect(errorRedirectUrl(requestPath, "Only owners and managers can request Pro access for this business."));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(requestPath, "Server isn't configured."));

  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (!user) redirect(errorRedirectUrl("/account", "Sign in to request Pro access."));

  const { data: business } = await admin
    .from("businesses")
    .select("id, name, plan_tier, plan_expires_at")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) redirect(errorRedirectUrl(requestPath, "Business not found."));

  // Core product rule: an already-ACTIVE Pro business (per the existing,
  // unmodified isBusinessPro() resolver — an expired business returns
  // false here and is correctly allowed to request again) never gets a
  // redundant request.
  if (isBusinessPro(business)) {
    redirect(errorRedirectUrl(requestPath, "This business already has Findmi Pro active."));
  }

  // Checked proactively before inserting (same pattern as
  // /api/account/claim/route.ts's own pending-claim check) so a duplicate
  // submission gets a clean, friendly message rather than surfacing a raw
  // unique-constraint error — the partial unique index on the table
  // itself (business_pro_access_requests_one_pending) is the real,
  // DB-enforced guard this check only front-runs for a better message.
  const { data: existingPending } = await admin
    .from("business_pro_access_requests")
    .select("id")
    .eq("business_id", businessId)
    .eq("status", "pending")
    .maybeSingle();
  if (existingPending) {
    redirect(errorRedirectUrl(requestPath, "A Pro access request for this business is already pending review."));
  }

  const message = str(formData, "message");

  const { error } = await admin
    .from("business_pro_access_requests")
    .insert({ business_id: businessId, requested_by_user_id: user.id, message });

  if (error) {
    redirect(errorRedirectUrl(requestPath, "Couldn't submit your request. Please try again."));
  }

  await notifyAdmin({
    subject: `New Pro access request: ${business.name}`,
    heading: "New Pro access request",
    body: [`Business: ${business.name}`, ...(message ? [`Message: "${message}"`] : [])],
    actionLabel: "Review Pro Requests",
    actionUrl: "/admin/pro-requests?status=pending",
  });

  redirect(`${requestPath}?submitted=1`);
}
