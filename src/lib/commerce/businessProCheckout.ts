import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "./stripe";
import { getPublicOrigin } from "@/lib/site-url";
import { isBusinessPro } from "@/lib/entitlements";

// Native Business Onboarding Pass 3 — the introductory $20/first-year
// Pro offer, deliberately separate from the marketplace order checkout
// (lib/commerce/quote.ts, order/order_items — untouched) and from the
// legacy membership checkout (membershipCheckout.ts, still intact,
// unreachable from any live UI, not reused here per this pass's own
// instruction not to resurrect it). One-time Stripe Checkout ("payment"
// mode, never "subscription" — no renewal/subscription behavior exists
// yet), for an ALREADY-EXISTING, already-owned business — this never
// creates a business or a membership row itself; the caller (the
// creation action, or /upgrade/pro) is responsible for having a real,
// authorized business_id before calling this.

/** Current introductory offer — the one and only Pro price point this
 * pass implements. A single named constant so the amount is server-
 * controlled in exactly one place, never trusted from the client, and
 * easy to find if/when a real pricing pass replaces it. offerId is
 * carried in Checkout metadata purely so the webhook (or a future
 * admin/report view) can tell which offer a given payment was for,
 * without guessing from the raw amount — it's never read back anywhere
 * today (confirmed: only findmi_purpose/findmi_business_id drive the
 * webhook), so renaming it (Pro Offer Pass 4 — was "pro_intro_90d_2000")
 * to match the new 1-year duration is safe: no idempotency/webhook
 * logic keys off its value, and no historical payment record is
 * altered by changing what a FUTURE checkout tags itself with. */
export const BUSINESS_PRO_INTRO_OFFER_ID = "pro_intro_1yr_2000";
export const BUSINESS_PRO_INTRO_PRICE_CENTS = 2000; // $20
// Pro Offer Pass 4 — locked launch offer is "$20 for the first year",
// not 90 days. Feeds businessProActivation.ts's plan_expires_at
// calculation directly (expiresAt.setDate(... + BUSINESS_PRO_INTRO_DAYS))
// — that's the entire "existing expiration/provenance mechanism" this
// pass reuses, no other change needed there.
export const BUSINESS_PRO_INTRO_DAYS = 365;

/** Creates a one-time Stripe Checkout Session for the introductory Pro
 * offer, scoped to exactly one already-existing business. Deliberately
 * does NOT re-check authorization itself (every caller — createMemberBusiness,
 * startBusinessProCheckout — already required real business_members
 * access via requireBusinessMember before reaching here); it DOES
 * independently re-read the business's current plan_tier server-side and
 * refuse checkout if it's already pro/pro_seller, so a stale page or a
 * replayed request can never start a second, redundant $20 charge — and
 * a pro_seller business (inherits Pro already) is never offered this
 * checkout either, satisfying this pass's own Pro Seller safeguard. */
export async function createBusinessProCheckoutSession(
  admin: SupabaseClient,
  businessId: string
): Promise<{ url: string } | { error: string }> {
  const stripe = getStripe();
  if (!stripe) return { error: "Checkout isn't configured yet." };

  const { data: business } = await admin
    .from("businesses")
    .select("id, name, plan_tier")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) return { error: "Business not found." };
  if (isBusinessPro(business)) {
    // Covers both plan_tier === 'pro' and 'pro_seller' — a Pro Seller
    // already inherits full Pro access and must never be offered this
    // $20 checkout (see isBusinessPro's own pro_seller handling).
    return { error: "This business already has Pro access." };
  }

  const siteUrl = getPublicOrigin();
  const manageUrl = `${siteUrl}/account/business/${businessId}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            // Server-controlled amount — never derived from anything the
            // client submitted. The ONLY input from the caller is which
            // business_id this charge is for.
            unit_amount: BUSINESS_PRO_INTRO_PRICE_CENTS,
            product_data: {
              name: `FindMi Pro — ${business.name}`,
              description: "FindMi Pro, first year. No automatic renewal during the introductory period.",
            },
          },
        },
      ],
      metadata: {
        findmi_purpose: "business_pro_intro",
        findmi_business_id: businessId,
        findmi_offer_id: BUSINESS_PRO_INTRO_OFFER_ID,
      },
      success_url: `${manageUrl}?pro_payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${manageUrl}?pro_payment=cancelled`,
    });
    if (!session.url) return { error: "Could not start checkout. Please try again." };
    return { url: session.url };
  } catch (err) {
    console.error("[business-pro-checkout] stripe checkout session creation failed", {
      businessId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: "Could not start checkout. Please try again." };
  }
}
