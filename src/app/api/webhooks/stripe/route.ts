import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/commerce/stripe";
import { settleOrder } from "@/lib/commerce/settleOrder";

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
