import { getStripe } from "./stripe";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getPublicOrigin } from "@/lib/site-url";

/**
 * Path B (public/paid) checkout — the smallest server-side Stripe Checkout
 * architecture needed for plan-aware, metadata-carrying membership billing.
 * Deliberately separate from the marketplace commerce checkout
 * (lib/commerce/quote.ts, order/order_items) — this creates a `memberships`
 * row, never an order. Reuses the same getStripe() singleton and the same
 * /api/webhooks/stripe endpoint/signing secret; the webhook branches on
 * which metadata key is present (findmi_order_id vs findmi_membership_id).
 *
 * A membership row (billing_status=pending_payment) is created BEFORE the
 * Stripe session so an abandoned checkout still leaves a lead the founder
 * can see in /admin/onboarding — never silently lost.
 */
export async function createMembershipCheckoutSession(input: {
  planSlug: string;
  marketIds: string[];
  contactName: string;
  contactEmail: string;
  businessName: string;
}): Promise<{ url: string } | { error: string }> {
  const supabase = getAdminSupabase();
  const stripe = getStripe();
  if (!supabase || !stripe) return { error: "Checkout isn't configured yet." };

  const { data: plan } = await supabase
    .from("membership_plans")
    .select("*")
    .eq("slug", input.planSlug)
    .eq("active", true)
    .eq("publicly_available", true)
    .maybeSingle();
  if (!plan) return { error: "That plan isn't available." };

  const marketIds = Array.from(new Set(input.marketIds.filter(Boolean)));
  if (marketIds.length === 0) return { error: "Choose at least one FindMi market." };
  if (plan.market_limit !== null && marketIds.length > plan.market_limit) {
    return {
      error: `${plan.name} includes up to ${plan.market_limit} market${plan.market_limit === 1 ? "" : "s"}. Choose fewer markets, or pick a plan with broader coverage.`,
    };
  }

  const { data: validMarkets } = await supabase.from("markets").select("id").in("id", marketIds).eq("active", true);
  if (!validMarkets || validMarkets.length !== marketIds.length) {
    return { error: "One of the selected markets isn't available." };
  }

  if (!input.businessName.trim() || !input.contactName.trim() || !input.contactEmail.trim()) {
    return { error: "Business name, contact name, and email are required." };
  }

  const { data: membership, error: insertError } = await supabase
    .from("memberships")
    .insert({
      plan_id: plan.id,
      billing_status: "pending_payment",
      onboarding_status: "not_started",
      publication_status: "draft",
      contact_name: input.contactName.trim(),
      contact_email: input.contactEmail.trim(),
      intended_business_name: input.businessName.trim(),
      founding_price_locked: plan.slug === "founding-500",
    })
    .select("id")
    .single();
  if (insertError || !membership) return { error: "Could not start checkout. Please try again." };

  await supabase.from("membership_markets").insert(marketIds.map((market_id) => ({ membership_id: membership.id, market_id })));

  const siteUrl = getPublicOrigin();

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: input.contactEmail.trim(),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(Number(plan.annual_price) * 100),
            recurring: { interval: "year" },
            product_data: {
              name: `FindMi ${plan.name} Membership`,
              description: plan.description ?? undefined,
            },
          },
        },
      ],
      metadata: { findmi_membership_id: membership.id },
      subscription_data: { metadata: { findmi_membership_id: membership.id } },
      success_url: `${siteUrl}/join/success?membership_id=${membership.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/join?cancelled=1`,
    });
    if (!session.url) return { error: "Could not start checkout. Please try again." };

    await supabase.from("memberships").update({ stripe_checkout_session_id: session.id }).eq("id", membership.id);
    return { url: session.url };
  } catch {
    return { error: "Could not start checkout. Please try again." };
  }
}
