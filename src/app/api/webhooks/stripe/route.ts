import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/commerce/stripe";
import { settleOrder } from "@/lib/commerce/settleOrder";
import { activateMembership } from "@/lib/commerce/membershipActivation";
import { activateBusinessPro } from "@/lib/commerce/businessProActivation";
import { BUSINESS_PRO_INTRO_PRICE_CENTS } from "@/lib/commerce/businessProCheckout";
import { qualifyReferralEarning } from "@/lib/commerce/referrals";

// Stripe calls this directly — not gated by /admin's cookie auth, so the
// Stripe signature itself is the only authentication. Never trust the
// payload without verifying it against STRIPE_WEBHOOK_SECRET.
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.findmi_order_id;
    const membershipId = session.metadata?.findmi_membership_id;
    const businessProPurpose = session.metadata?.findmi_purpose;
    const businessProBusinessId = session.metadata?.findmi_business_id;

    // Native Business Onboarding Pass 3 — the native $99/year Pro
    // checkout, a THIRD system alongside marketplace orders and legacy
    // membership billing, distinguished the same way those two already
    // are: by which metadata key/value Stripe echoes back, all verified
    // by the one signature check above. Trusted metadata only — this
    // never reads anything from the request body outside the
    // signature-verified event.
    if (businessProPurpose === "business_pro_intro" && businessProBusinessId) {
      await activateBusinessPro(businessProBusinessId, session.id);

      // Referral Partner + Discount Foundation — a SEPARATE, independent
      // step from activation above: qualifies a commission ONLY when this
      // exact business has its own stored referral attribution (looked up
      // fresh server-side, never from Stripe metadata) and is fully
      // idempotent against this same webhook event being redelivered —
      // see qualify_referral_earning()'s own migration comment. A Pro
      // Invite's complimentary activation never fires this event at all
      // (no Stripe checkout involved), so it can never reach this line —
      // that's the whole mechanism behind "no paid commission from a $0
      // complimentary activation."
      await qualifyReferralEarning(
        businessProBusinessId,
        session.id,
        session.amount_total ?? BUSINESS_PRO_INTRO_PRICE_CENTS,
        BUSINESS_PRO_INTRO_PRICE_CENTS
      );
    }

    // Membership billing (Part 11) is a separate system from marketplace
    // order checkout — distinguished purely by which metadata key Stripe
    // echoes back, both verified by the one signature check above.
    if (membershipId) {
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
      await activateMembership(membershipId, { subscriptionId, customerId });
    }

    if (orderId) {
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;

      // Best-effort: read Stripe's real processing fee off the charge's
      // balance transaction for immediate reconciliation. If anything here
      // fails (fee not posted yet, API hiccup), settleOrder still runs
      // with the estimate already stored on each item — never blocks
      // marking the order paid.
      let actualFee: number | null = null;
      if (paymentIntentId) {
        try {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ["latest_charge.balance_transaction"],
          });
          const charge = pi.latest_charge;
          const balanceTx =
            typeof charge === "object" && charge?.balance_transaction && typeof charge.balance_transaction === "object"
              ? charge.balance_transaction
              : null;
          if (balanceTx && typeof balanceTx.fee === "number") {
            actualFee = balanceTx.fee / 100;
          }
        } catch {
          // Reconciliation can happen later (Part 24) — not fatal here.
        }
      }

      await settleOrder(orderId, paymentIntentId, actualFee);
    }
  }

  // Every other event type is acknowledged but ignored — this pass only
  // needs successful payment confirmation (Part 15).
  return NextResponse.json({ received: true });
}
