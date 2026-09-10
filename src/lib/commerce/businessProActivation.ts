import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { BUSINESS_PRO_INTRO_DAYS } from "./businessProCheckout";

/** Paid Pro Activation Reliability pass — activateBusinessPro() used to
 * return void and treat every "0 rows updated" outcome (already Pro,
 * Supabase error, or a businessId that doesn't exist at all) identically
 * to a safe no-op. That let a genuine database error during a real $99
 * payment's activation disappear silently: no log, no thrown exception,
 * and the webhook route below still answered Stripe with 200 — meaning
 * Stripe considered the event delivered and never retried, even though
 * the business never actually became Pro. This return type makes the
 * three real outcomes explicit so the webhook can tell a customer's
 * payment succeeded but our own write failed. */
export type BusinessProActivationResult =
  | { status: "activated" }
  | { status: "already_pro" }
  | { status: "failed"; reason: string };

/**
 * Native Business Onboarding Pass 3 — the ONLY code path allowed to write
 * plan_tier='pro' for a paid business. Called exclusively from the
 * signature-verified Stripe webhook (see /api/webhooks/stripe), never
 * reachable from client-submitted metadata or any other request — the
 * webhook's own signature check is what makes calling this safe.
 *
 * Idempotent and race-safe the same way activateMembership() already is
 * (Stripe redelivers events) — the UPDATE itself carries the entire
 * eligibility condition in its WHERE clause (never a separate read-then-
 * write), so two concurrent deliveries can never both apply it.
 *
 * Business Pro Expiration Enforcement pass — this used to be guarded to
 * plan_tier = 'free' only, which meant an EXPIRED Pro business (still
 * stored as plan_tier = 'pro' — expiration never rewrites plan_tier, see
 * lib/entitlements.ts) could pay for a new $99 term via
 * createBusinessProCheckoutSession (its own eligibility check now uses
 * ACTIVE entitlement) but this activation step would then match zero
 * rows and silently do nothing, leaving a real paying customer un-
 * reactivated. The WHERE clause now matches EITHER:
 *   - plan_tier = 'free' (first-time activation), OR
 *   - plan_tier = 'pro' AND plan_expires_at is in the past (reactivating
 *     a lapsed term)
 * A business with plan_expires_at = null is a permanent/manual grant
 * (see isBusinessPro's own comment) and is never "in the past", so it
 * can never match the second branch. An ACTIVE (non-expired) pro/
 * pro_seller business also never matches either branch, so a redelivered
 * webhook event for an already-active business still matches zero rows
 * and does nothing — never extends plan_expires_at again. pro_seller is
 * deliberately excluded from both branches (this checkout never sells or
 * renews that tier — no seller checkout exists yet), so a pro_seller
 * business, expired or not, is never touched here even by mistake.
 *
 * Deliberately narrow: only plan_tier/plan_source/plan_started_at/
 * plan_expires_at/plan_payment_reference are written. publication_status,
 * business_members, and ownership are never touched here — a paid
 * business can be Pro + still pending_review until a founder separately
 * approves it, exactly as this pass specifies. plan_started_at IS
 * overwritten to the new term's start on a reactivation (unlike the Pro
 * Invite RPC's coalesce-only behavior) — a paid term is a fresh,
 * standalone $99/365-day purchase, not an extension of the earlier lapsed
 * one, so its own start date should reflect that.
 */
export async function activateBusinessPro(
  businessId: string,
  stripeSessionId: string
): Promise<BusinessProActivationResult> {
  const supabase = getAdminSupabase();
  if (!supabase) {
    console.error("[business-pro-activation] Supabase not configured — cannot activate", {
      businessId,
      stripeSessionId,
    });
    return { status: "failed", reason: "supabase_not_configured" };
  }

  const startedAt = new Date();
  const expiresAt = new Date(startedAt);
  expiresAt.setDate(expiresAt.getDate() + BUSINESS_PRO_INTRO_DAYS);
  const nowIso = startedAt.toISOString();

  const { data: updated, error } = await supabase
    .from("businesses")
    .update({
      plan_tier: "pro",
      plan_source: "paid",
      plan_started_at: startedAt.toISOString(),
      plan_expires_at: expiresAt.toISOString(),
      plan_payment_reference: stripeSessionId,
    })
    .eq("id", businessId)
    .or(`plan_tier.eq.free,and(plan_tier.eq.pro,plan_expires_at.lte.${nowIso})`)
    .select("id")
    .maybeSingle();

  if (error) {
    // A genuine database failure — never treated as "already Pro". Never
    // logs full Stripe payloads/secrets, only the error's own code/message
    // (safe, non-sensitive Postgres/PostgREST metadata) plus the two ids
    // needed to find and retry this activation.
    console.error("[business-pro-activation] Supabase update failed", {
      businessId,
      stripeSessionId,
      errorCode: error.code,
      errorMessage: error.message,
    });
    return { status: "failed", reason: "database_error" };
  }

  if (updated) {
    // Covers both a first-time Free->Pro activation and reactivating a
    // lapsed Pro term — both are a genuine, successful write of a fresh
    // 365-day term, so both report the same "activated" outcome.
    console.log("[business-pro-activation] activated", { businessId, stripeSessionId });
    return { status: "activated" };
  }

  // Zero rows matched with no error — either this business already has
  // ACTIVE Pro (a legitimate idempotent redelivery of this same event, or
  // any other still-current pro/pro_seller business), or businessId
  // doesn't resolve to a real row at all. Those are very different
  // outcomes — a missing/invalid target must never be silently treated as
  // a safe no-op — so resolve which one this actually is before deciding.
  const { data: existing, error: lookupError } = await supabase
    .from("businesses")
    .select("id, plan_tier, plan_expires_at")
    .eq("id", businessId)
    .maybeSingle();

  if (lookupError) {
    console.error("[business-pro-activation] Supabase lookup failed after a no-op update", {
      businessId,
      stripeSessionId,
      errorCode: lookupError.code,
      errorMessage: lookupError.message,
    });
    return { status: "failed", reason: "database_error" };
  }

  if (!existing) {
    console.error("[business-pro-activation] target business not found — activation cannot complete", {
      businessId,
      stripeSessionId,
    });
    return { status: "failed", reason: "business_not_found" };
  }

  console.log("[business-pro-activation] already Pro — idempotent redelivery, no change", {
    businessId,
    stripeSessionId,
    planTier: existing.plan_tier,
    planExpiresAt: existing.plan_expires_at,
  });
  return { status: "already_pro" };
}
