"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember } from "@/lib/permissions";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";

/**
 * Pro Invite / Complimentary Access Codes — the one real redemption path.
 * Everything that matters is verified/decided server-side, never trusted
 * from the client:
 *   - The authenticated user comes from the CALLER'S OWN session
 *     (getServerSupabase().auth.getUser()), never a submitted field.
 *   - requireBusinessMember(businessId) re-derives real membership from
 *     the caller's own session-scoped business_members row before this
 *     ever reaches the RPC — same authorize-then-elevate shape every
 *     other member action in account/business/actions.ts already uses.
 *   - The actual grant/limit/duplicate/expiration logic all lives in
 *     redeem_pro_invite() (see the pro_invites migration) — this action
 *     never computes or writes plan_tier/plan_expires_at/redemption_count
 *     itself, and never accepts them as form input either. This function
 *     only ever passes the code + businessId + the session's own
 *     user.id through to that RPC.
 * redeem_pro_invite() independently re-checks business_members
 * membership too (defense-in-depth, never trusting this action's own
 * prior check alone — see that function's comment).
 */
const REDEEM_ERROR_MESSAGES: Record<string, string> = {
  user_required: "You need to be signed in to redeem this invite.",
  business_required: "Choose a business to apply this invite to.",
  not_authorized_for_business: "You don't have access to that business.",
  invalid_code: "This invite code isn't valid.",
  invite_inactive: "This invite is no longer active.",
  invite_expired: "This invite has expired.",
  invite_redemption_limit_reached: "This invite has already reached its redemption limit.",
  already_redeemed_by_business: "This business has already redeemed this invite.",
  business_not_found: "That business no longer exists.",
};

export async function redeemProInvite(code: string, formData: FormData) {
  const redirectPath = `/redeem/${encodeURIComponent(code)}`;

  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(redirectPath)}`);

  const businessId = str(formData, "business_id");
  if (!businessId) redirect(errorRedirectUrl(redirectPath, "Choose a business to apply this invite to."));

  try {
    await requireBusinessMember(businessId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to that business.";
    redirect(errorRedirectUrl(redirectPath, message));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(redirectPath, "Server isn't configured."));

  const { data, error } = await admin.rpc("redeem_pro_invite", {
    p_code: code,
    p_business_id: businessId,
    p_user_id: user.id,
  });

  if (error || !data) {
    const message = REDEEM_ERROR_MESSAGES[error?.message ?? ""] ?? "Couldn't redeem this invite. Please try again.";
    redirect(errorRedirectUrl(redirectPath, message));
  }

  const result = data as {
    business_id: string;
    business_name: string;
    plan_tier_changed: boolean;
    granted_until: string;
  };
  const params = new URLSearchParams({
    success: "1",
    business_id: result.business_id,
    business_name: result.business_name,
    granted_until: result.granted_until,
  });
  redirect(`${redirectPath}?${params.toString()}`);
}
