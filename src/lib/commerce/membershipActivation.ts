import { getAdminSupabase } from "@/lib/admin/supabase-admin";

/**
 * Part 11's exact post-payment sequencing: payment confirmed (Stripe
 * webhook, signature already verified by the caller) -> billing_status
 * paid, onboarding_status incomplete, publication_status stays draft.
 * Never touches publication_status here — approval is a founder action
 * (Part 15), regardless of payment.
 */
export async function activateMembership(
  membershipId: string,
  stripeRefs: { subscriptionId: string | null; customerId: string | null }
): Promise<void> {
  const supabase = getAdminSupabase();
  if (!supabase) return;

  const { data: membership } = await supabase
    .from("memberships")
    .select("billing_status")
    .eq("id", membershipId)
    .maybeSingle();
  if (!membership) return;
  // Idempotent — Stripe can redeliver this event.
  if (membership.billing_status === "paid") return;

  const now = new Date();
  const renewsAt = new Date(now);
  renewsAt.setFullYear(renewsAt.getFullYear() + 1);

  await supabase
    .from("memberships")
    .update({
      billing_status: "paid",
      onboarding_status: "incomplete",
      started_at: now.toISOString(),
      renews_at: renewsAt.toISOString(),
      stripe_subscription_id: stripeRefs.subscriptionId,
      stripe_customer_id: stripeRefs.customerId,
      updated_at: now.toISOString(),
    })
    .eq("id", membershipId);
}
