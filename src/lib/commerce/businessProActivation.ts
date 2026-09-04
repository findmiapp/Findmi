import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { BUSINESS_PRO_INTRO_DAYS } from "./businessProCheckout";

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
 * downgrade or otherwise touch one either.
 *
 * Deliberately narrow: only plan_tier/plan_source/plan_started_at/
 * plan_expires_at/plan_payment_reference are written. publication_status,
 * business_members, and ownership are never touched here — a paid
 * business can be Pro + still pending_review until a founder separately
 * approves it, exactly as this pass specifies.
 */
export async function activateBusinessPro(businessId: string, stripeSessionId: string): Promise<void> {
  const supabase = getAdminSupabase();
  if (!supabase) return;

  const startedAt = new Date();
  const expiresAt = new Date(startedAt);
  expiresAt.setDate(expiresAt.getDate() + BUSINESS_PRO_INTRO_DAYS);

  const { data: updated } = await supabase
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

  if (!updated) {
    // Already Pro (idempotent redelivery of the same or a stray event),
    // or not currently 'free' for some other reason (e.g. pro_seller) —
    // never overwritten either way, nothing further to do.
    return;
  }
}
