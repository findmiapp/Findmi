// Recurring Billing Pass 1 — TypeScript shapes for the two new billing
// tables (see migration 20260925220000_recurring_billing_data_foundation.sql).
// Kept separate from lib/commerce/types.ts (the cart/order/fulfillment
// pipeline — a different concern) since these describe Stripe Customer/
// Subscription identity, not marketplace commerce.
//
// No resolver, no Stripe API calls, no checkout/webhook logic here — this
// pass is data-model-only. businesses.plan_tier/plan_source/
// plan_started_at/plan_expires_at/plan_payment_reference and
// isBusinessPro() are untouched and remain the entitlement source of
// truth; nothing here is wired to them yet.

/** One row per (FindMi user, Stripe mode) — a user can legitimately hold
 * both a test-mode and a live-mode Stripe Customer at once, since Preview
 * and Production currently share one Supabase project. No email (lives in
 * auth.users), no business_id (a Customer belongs to a user, not a
 * business), no payment-method data. */
export interface StripeCustomerRow {
  user_id: string;
  stripe_customer_id: string;
  livemode: boolean;
  created_at: string;
  updated_at: string;
}

export type CommercialPlan = "pro" | "managed_pro";

export type BillingInterval = "monthly" | "annual";

/** Mirrors Stripe subscription state per business. business_id is who
 * RECEIVES the entitlement; payer_user_id is who OWNS the Stripe billing
 * relationship — deliberately separate, since business ownership can
 * change while the original payer keeps paying. `status` is intentionally
 * `string`, not a closed union — Stripe's own SDK types it as an open
 * union for forward compatibility with future Stripe statuses. */
export interface BusinessSubscriptionRow {
  id: string;
  business_id: string;
  payer_user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  stripe_price_id: string;
  commercial_plan: CommercialPlan;
  billing_interval: BillingInterval;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  latest_invoice_status: string | null;
  livemode: boolean;
  created_at: string;
  updated_at: string;
}
