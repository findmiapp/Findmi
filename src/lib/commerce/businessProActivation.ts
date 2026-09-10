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
 * (Stripe redelivers events): the UPDATE itself is guarded to
 * plan_tier = 'free', so a second delivery of the same (or any) event for
 * this business matches zero rows and does nothing — never extends
 * plan_expires_at again, never touches a business that's already Pro,
 * and — since a pro_seller business is never 'free' — can never
 * downgrade or otherwise touch one either. That safety is unchanged by
 * this pass; only the RETURN VALUE now distinguishes why zero rows
 * matched, instead of always assuming it was safe.
 *
 * Deliberately narrow: only plan_tier/plan_source/plan_started_at/
 * plan_expires_at/plan_payment_reference are written. publication_status,
 * business_members, and ownership are never touched here — a paid
 * business can be Pro + still pending_review until a founder separately
 * approves it, exactly as this pass specifies.
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
    .eq("plan_tier", "free")
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
    console.log("[business-pro-activation] activated", { businessId, stripeSessionId });
    return { status: "activated" };
  }

  // Zero rows matched with no error — either this business is already Pro
  // (a legitimate idempotent redelivery, or a pro_seller that was never
  // 'free' to begin with), or businessId doesn't resolve to a real row at
  // all. Those are very different outcomes — a missing/invalid target must
  // never be silently treated as a safe no-op — so resolve which one this
  // actually is before deciding.
  const { data: existing, error: lookupError } = await supabase
    .from("businesses")
    .select("id, plan_tier")
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
  });
  return { status: "already_pro" };
}
