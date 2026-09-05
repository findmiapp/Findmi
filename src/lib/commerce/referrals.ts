import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";

/**
 * Referral Partner + Discount + Manual Payout Foundation — thin,
 * server-only wrappers around the three SECURITY DEFINER RPCs added by
 * the referral_partners migration (attribute_referral, qualify_referral_
 * earning, request_referral_payout). This file never computes or trusts
 * a discount percent, commission amount, or balance itself — every one
 * of those numbers is decided inside the RPCs, reading current server
 * state at the moment it matters. Completely separate from Pro Invites
 * (lib usage of pro_invites/redeem_pro_invite is untouched) — a business
 * can have both a complimentary Pro Invite and its own referral
 * attribution at the same time.
 */

const REFERRAL_ERROR_MESSAGES: Record<string, string> = {
  business_required: "A business is required.",
  user_required: "You need to be signed in.",
  invalid_code: "That referral code isn't valid.",
  invalid_plan: "Invalid plan selection.",
  already_attributed: "This business already has a referral attribution.",
  code_inactive: "This referral code is no longer active.",
  code_expired: "This referral code has expired.",
  code_limit_reached: "This referral code has reached its usage limit.",
};

/**
 * Records referral attribution for a BRAND-NEW business, immediately
 * after creation — see attribute_referral()'s own migration comment for
 * why an already-existing business can never be attributed later. Never
 * throws on an invalid/expired/exhausted code: signup must not be
 * blocked by a bad referral code, so this just returns { error } and the
 * caller (createMemberBusiness) proceeds with business creation
 * regardless — a referral code is an attribution nice-to-have, never a
 * signup requirement.
 */
export async function attributeReferral(
  admin: SupabaseClient,
  businessId: string,
  code: string,
  initialPlan: "free" | "pro",
  userId: string
): Promise<{ ok: true } | { error: string }> {
  const { data, error } = await admin.rpc("attribute_referral", {
    p_business_id: businessId,
    p_code: code,
    p_initial_plan: initialPlan,
    p_user_id: userId,
  });
  if (error || !data) {
    return { error: REFERRAL_ERROR_MESSAGES[error?.message ?? ""] ?? "Couldn't apply that referral code." };
  }
  return { ok: true };
}

/**
 * Looks up an EXISTING referral attribution's currently-valid discount
 * for a business about to start Pro checkout — read fresh from
 * referral_codes on every call (never cached, never trusted from the
 * client), so a code deactivated/expired after attribution simply stops
 * discounting going forward while the original attribution itself stays
 * intact untouched. Returns null for a business with no attribution at
 * all, or whose code is no longer valid — in either case checkout falls
 * back to the plain $99 price, never a broken/blocked checkout.
 */
export async function getActiveReferralDiscount(
  admin: SupabaseClient,
  businessId: string
): Promise<{ referralCodeId: string; discountPercent: number } | null> {
  const { data: attribution } = await admin
    .from("referral_attributions")
    .select("referral_code_id")
    .eq("business_id", businessId)
    .maybeSingle();
  if (!attribution) return null;

  const { data: code } = await admin
    .from("referral_codes")
    .select("id, is_active, discount_percent, expires_at")
    .eq("id", attribution.referral_code_id)
    .maybeSingle();
  if (!code || !code.is_active) return null;
  if (code.expires_at && new Date(code.expires_at) <= new Date()) return null;
  if (!code.discount_percent || code.discount_percent <= 0) return null;

  return { referralCodeId: code.id, discountPercent: Number(code.discount_percent) };
}

/** Server-derived discounted price — never accepts a percent from the
 * client. `basePriceCents` is the caller's own current list price (kept
 * as a parameter, not imported, so this file has no dependency on
 * businessProCheckout.ts — that file imports FROM here). Rounds to the
 * nearest cent, matching how Stripe itself expects unit_amount (an
 * integer number of cents). */
export function applyReferralDiscount(basePriceCents: number, discountPercent: number): number {
  const discounted = basePriceCents * (1 - discountPercent / 100);
  return Math.max(0, Math.round(discounted));
}

/**
 * Called ONLY from the signature-verified Stripe webhook, after a real
 * "checkout.session.completed" event for the native $99(-discounted) Pro
 * checkout. `chargedAmountCents` is Stripe's OWN recorded
 * session.amount_total — the source of truth for what was actually
 * charged, never recomputed from current referral_codes settings (which
 * may have changed between checkout creation and webhook delivery).
 * `listPriceCents` is the caller's current undiscounted list price, used
 * only to compute the discount_amount_cents stored on the earning row
 * (kept as a parameter for the same no-import-cycle reason as
 * applyReferralDiscount above). No-ops safely for a business with no
 * referral attribution at all, and is fully idempotent against webhook
 * redelivery — see qualify_referral_earning()'s own migration comment.
 */
export async function qualifyReferralEarning(
  businessId: string,
  stripeSessionId: string,
  chargedAmountCents: number,
  listPriceCents: number
): Promise<void> {
  const admin = getAdminSupabase();
  if (!admin) return;

  const discountAmountCents = Math.max(0, listPriceCents - chargedAmountCents);

  await admin.rpc("qualify_referral_earning", {
    p_business_id: businessId,
    p_stripe_session_id: stripeSessionId,
    p_gross_amount_cents: chargedAmountCents,
    p_discount_amount_cents: discountAmountCents,
  });
}
