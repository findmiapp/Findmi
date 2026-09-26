import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getSubscriptionStripe } from "@/lib/commerce/subscriptionStripe";
import { syncSubscriptionFromStripe } from "@/lib/commerce/subscriptionSync";

// Recurring Billing Pass 2B — the dedicated recurring-subscription webhook
// endpoint. Deliberately a SEPARATE route/secret/Stripe client from the
// legacy /api/webhooks/stripe route: that route (and its
// STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET) is shared with the marketplace
// order checkout, legacy memberships, and the existing $99 Business Pro
// checkout, and must never be repurposed or mixed with the dedicated
// recurring-subscription Stripe account. A Stripe event from the legacy
// account can never be accepted here (and vice versa): each account's
// Dashboard sends its own events only to its own configured endpoint URL,
// and even a misdirected POST would fail signature verification below —
// STRIPE_SUBSCRIPTIONS_WEBHOOK_SECRET and STRIPE_WEBHOOK_SECRET are
// distinct HMAC secrets, not forgeable across accounts.
//
// Handles ONLY customer.subscription.created/updated/deleted. Deliberately
// does NOT subscribe to checkout.session.completed (redundant — Pass 2A's
// Checkout already sets subscription_data.metadata, so the created
// Subscription itself already carries full attribution) or any invoice.*
// event (latest_invoice_status is derived from the same canonical
// Subscription retrieve via `expand: ["latest_invoice"]` inside
// syncSubscriptionFromStripe — see that function and the pass's own
// design report for the full reasoning).
export async function POST(request: NextRequest) {
  const stripe = getSubscriptionStripe();
  const webhookSecret = process.env.STRIPE_SUBSCRIPTIONS_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Recurring subscription webhook not configured." }, { status: 500 });
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

  const SUBSCRIPTION_EVENT_TYPES = new Set(["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]);

  if (!SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
    // Acknowledged but ignored — the dedicated Dashboard endpoint should
    // only ever be configured to send these 3 types, but a defensive,
    // non-retryable ack matches the legacy route's own catch-all posture.
    return NextResponse.json({ received: true });
  }

  const subscription = event.data.object as Stripe.Subscription;

  try {
    const result = await syncSubscriptionFromStripe(subscription.id, event.id, new Date(event.created * 1000), event.livemode);
    // Every non-throwing outcome — a successful sync, a duplicate delivery
    // that safely converges, or a known structural anomaly that has
    // already been durably persisted (see syncSubscriptionFromStripe) — is
    // safe to acknowledge. Retrying would not change any of these.
    return NextResponse.json({ received: true, outcome: result.outcome });
  } catch (err) {
    // A transient failure (Stripe unreachable, Supabase unavailable, RPC
    // infrastructure error, or the anomaly persistence itself failing) —
    // never acknowledged, so Stripe retries the whole event.
    console.error("[subscription-webhook] sync failed", {
      eventId: event.id,
      eventType: event.type,
      subscriptionId: subscription.id,
      livemode: event.livemode,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Synchronization failed." }, { status: 500 });
  }
}
