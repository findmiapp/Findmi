import type { BillingInterval, CommercialPlan } from "./subscriptionTypes";

// Recurring Billing Pass 2A — a small, pure resolver from a canonical
// (commercial_plan, billing_interval) selection to the stable Stripe Price
// ID Checkout must use. Dollar amounts ($20/$149/$49/$399) are deliberately
// NOT encoded here or anywhere in application code — Checkout always uses a
// real Stripe Price ID from environment configuration, never inline
// price_data and never a client-submitted amount or Price ID. Reuses the
// Pass 1 CommercialPlan/BillingInterval unions rather than inventing a
// second, parallel string union.

const PRICE_ENV_VAR: Record<CommercialPlan, Record<BillingInterval, string>> = {
  pro: {
    monthly: "STRIPE_PRO_MONTHLY_PRICE_ID",
    annual: "STRIPE_PRO_ANNUAL_PRICE_ID",
  },
  managed_pro: {
    monthly: "STRIPE_MANAGED_PRO_MONTHLY_PRICE_ID",
    annual: "STRIPE_MANAGED_PRO_ANNUAL_PRICE_ID",
  },
};

/** Thrown when a required recurring-subscription Price ID environment
 * variable is absent — a server configuration problem, never a client
 * input problem (plan/interval are always canonical typed values by the
 * time this is called). Callers should catch this and surface a generic,
 * actionable "not configured yet" error rather than the raw message. */
export class SubscriptionPriceNotConfiguredError extends Error {
  constructor(public readonly envVar: string) {
    super(`${envVar} is not configured — recurring checkout is unavailable.`);
    this.name = "SubscriptionPriceNotConfiguredError";
  }
}

/** Resolves the exact Stripe Price ID Checkout must use for a canonical
 * plan+interval selection. Never accepts or returns a dollar amount, never
 * exposes a secret key, and never falls back to a guessed/default Price
 * ID — an unset environment variable fails clearly instead of silently
 * checking out against the wrong price. */
export function getSubscriptionPriceId(plan: CommercialPlan, interval: BillingInterval): string {
  const envVar = PRICE_ENV_VAR[plan][interval];
  const priceId = process.env[envVar]?.trim();
  if (!priceId) throw new SubscriptionPriceNotConfiguredError(envVar);
  return priceId;
}
