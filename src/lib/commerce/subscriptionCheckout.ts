import { requireBusinessMember } from "@/lib/permissions";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getPublicOrigin } from "@/lib/site-url";
import { getSubscriptionStripe, getSubscriptionStripeMode } from "./subscriptionStripe";
import { resolveSubscriptionStripeCustomerId, SubscriptionCustomerPersistError } from "./subscriptionCustomer";
import { getSubscriptionPriceId, SubscriptionPriceNotConfiguredError } from "./subscriptionPricing";
import type { BillingInterval, CommercialPlan } from "./subscriptionTypes";

// Recurring Billing Pass 2A — Stripe Customer resolution + recurring
// Checkout Session creation, BEHIND THE SCENES ONLY. This function is
// intentionally not imported by any route, page, Server Action, or button
// yet — see the pass report. Creating (or even completing) a Checkout
// Session through this helper must NEVER grant FindMi Pro: it never calls
// activateBusinessPro(), never writes businesses.plan_*, and never inserts
// into business_subscriptions itself — that table is a mirror of REAL
// Stripe subscriptions, populated only by a future verified-webhook pass
// (2B), not by Checkout Session creation.

// The same four statuses the Pass 1 partial unique index
// (business_subscriptions_one_active_per_business_mode) treats as
// blocking. Kept in sync with that index deliberately — this is a
// friendly, pre-Stripe-call duplicate check, not the race-safe backstop
// (the DB index remains that); see the pass report.
const BLOCKING_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "paused"] as const;

type CheckoutResult = { url: string } | { error: string };

/** Creates a recurring ("subscription" mode) Stripe Checkout Session for
 * one business's Pro or Managed Pro plan, scoped to the authenticated
 * caller who initiates it. NOT reachable from any live UI in this pass —
 * see the pass report for exactly what still needs to happen (webhook
 * lifecycle sync, dedicated Stripe Price IDs, UI cutover) before this can
 * be safely exposed to users.
 *
 * Authorization mirrors createBusinessProCheckoutSession/
 * startBusinessProCheckout: a REAL business_members row (owner, manager,
 * or staff) is required, and the founder admin's Manage-As synthetic
 * membership (`viaAdmin`) is explicitly forbidden from starting a real
 * customer charge — this is a financial/identity action, not entity
 * management. The authenticated user who calls this becomes
 * `payer_user_id`; it is never inferred from business.owner_id or any
 * other shortcut.
 */
export async function createRecurringSubscriptionCheckoutSession(
  businessId: string,
  plan: CommercialPlan,
  interval: BillingInterval
): Promise<CheckoutResult> {
  let membership;
  try {
    membership = await requireBusinessMember(businessId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "You don't have access to this business." };
  }

  // Admin Manage-As sessions must never initiate a real customer charge —
  // same rule startBusinessProCheckout already enforces for the $99
  // checkout (see permissions.ts's own Membership.viaAdmin doc).
  if (membership.viaAdmin) {
    return { error: "Exit Admin Mode to start a subscription checkout for this business." };
  }

  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  // Defensive only: requireBusinessMember() above only returns a non-
  // viaAdmin Membership when a real user_id matched a business_members
  // row, which requires a real authenticated user — this should be
  // unreachable, but payer identity must never be assumed.
  if (!user) return { error: "You need to be signed in to start a subscription checkout." };

  const admin = getAdminSupabase();
  if (!admin) return { error: "Server isn't configured." };

  const stripe = getSubscriptionStripe();
  if (!stripe) {
    console.error("[subscription-checkout] STRIPE_SUBSCRIPTIONS_SECRET_KEY is not configured");
    return { error: "Recurring checkout isn't configured yet." };
  }

  // Fail fast on missing Price configuration before making any Stripe
  // network calls (mode lookup, Customer resolution).
  let priceId: string;
  try {
    priceId = getSubscriptionPriceId(plan, interval);
  } catch (err) {
    if (err instanceof SubscriptionPriceNotConfiguredError) {
      console.error("[subscription-checkout] missing Price ID configuration", { envVar: err.envVar, plan, interval });
    }
    return { error: "Recurring checkout isn't configured yet." };
  }

  let livemode: boolean;
  try {
    livemode = await getSubscriptionStripeMode(stripe);
  } catch (err) {
    console.error("[subscription-checkout] failed to determine Stripe mode", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: "Couldn't reach Stripe. Please try again." };
  }

  // Duplicate-subscription pre-check — friendly UX only; the Pass 1
  // partial unique index (business_id, livemode) WHERE status IN (...) is
  // the real, race-safe backstop once webhook sync exists. Deliberately
  // does NOT consult businesses.plan_tier — a business can be Pro via
  // invite/manual grant/legacy $99 purchase and still be free to start a
  // real recurring subscription; this check is only about existing
  // business_subscriptions rows.
  const { data: blockingSubscription, error: dupeCheckError } = await admin
    .from("business_subscriptions")
    .select("id")
    .eq("business_id", businessId)
    .eq("livemode", livemode)
    .in("status", BLOCKING_SUBSCRIPTION_STATUSES)
    .maybeSingle();
  if (dupeCheckError) {
    console.error("[subscription-checkout] duplicate-subscription check failed", {
      businessId,
      errorCode: dupeCheckError.code,
      errorMessage: dupeCheckError.message,
    });
    return { error: "Couldn't verify this business's billing status. Please try again." };
  }
  if (blockingSubscription) {
    return { error: "This business already has an active recurring subscription." };
  }

  let customerId: string;
  try {
    customerId = await resolveSubscriptionStripeCustomerId({
      admin,
      stripe,
      livemode,
      userId: user.id,
      userEmail: user.email,
    });
  } catch (err) {
    if (err instanceof SubscriptionCustomerPersistError) {
      console.error("[subscription-checkout] customer resolution failed", {
        userId: user.id,
        livemode,
        error: err.message,
        cause: err.cause instanceof Error ? err.cause.message : err.cause,
      });
      return { error: err.message };
    }
    console.error("[subscription-checkout] unexpected customer resolution error", {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: "Couldn't set up your billing account. Please try again." };
  }

  const siteUrl = getPublicOrigin();
  const manageUrl = `${siteUrl}/account/business/${businessId}`;

  const metadata = {
    findmi_purpose: "business_pro_subscription",
    findmi_business_id: businessId,
    findmi_plan: plan,
    findmi_interval: interval,
    findmi_user_id: user.id,
  };

  // Checkout idempotency — deliberately NOT a permanent key scoped to
  // businessId alone (would return an ancient completed/expired session
  // forever). Bucketed into 30-minute windows purely from the wall clock
  // (no new persisted checkout-attempt state): a double-click or an
  // immediate network retry lands in the same bucket and collapses onto
  // the SAME Checkout Session via Stripe's own idempotency layer, while a
  // genuinely later attempt (a new bucket) always gets a fresh Session.
  // This can never cause a duplicate CHARGE — the duplicate-subscription
  // pre-check above plus the Pass 1 partial unique index are what prevent
  // two real subscriptions from coexisting; at worst, an attempt that
  // straddles a bucket boundary leaves one extra abandoned, unpaid
  // Checkout Session, which is safe. See the pass report for why a
  // persistent checkout-attempt table was deliberately not introduced.
  const idempotencyBucket = Math.floor(Date.now() / (30 * 60 * 1000));
  const idempotencyKey = `findmi_subscription_checkout:${user.id}:${businessId}:${plan}:${interval}:${livemode ? "live" : "test"}:${idempotencyBucket}`;

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata,
        subscription_data: { metadata },
        success_url: `${manageUrl}?subscription_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${manageUrl}?subscription_checkout=cancelled`,
      },
      { idempotencyKey }
    );
    if (!session.url) return { error: "Could not start checkout. Please try again." };
    return { url: session.url };
  } catch (err) {
    console.error("[subscription-checkout] Stripe checkout session creation failed", {
      businessId,
      plan,
      interval,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: "Could not start checkout. Please try again." };
  }
}
