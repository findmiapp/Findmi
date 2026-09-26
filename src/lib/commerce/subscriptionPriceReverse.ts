import { getSubscriptionPriceId, SubscriptionPriceNotConfiguredError } from "./subscriptionPricing";
import type { BillingInterval, CommercialPlan } from "./subscriptionTypes";

// Recurring Billing Pass 2B — the reverse of Pass 2A's getSubscriptionPriceId:
// given a Stripe Price ID actually attached to a Subscription Item, resolve
// which canonical (commercial_plan, billing_interval) it represents. Built
// entirely from getSubscriptionPriceId's own 4 env vars — no second,
// independent set of Price IDs is ever hardcoded here, so the two resolvers
// can never drift out of sync with each other.
//
// Price ID is AUTHORITATIVE for webhook synchronization (see
// subscriptionSync.ts): an unknown Price ID never grants entitlement and is
// never guessed at — it durably records an "unresolvable_price" anomaly
// instead.

const ALL_PLAN_INTERVAL_PAIRS: ReadonlyArray<{ plan: CommercialPlan; interval: BillingInterval }> = [
  { plan: "pro", interval: "monthly" },
  { plan: "pro", interval: "annual" },
  { plan: "managed_pro", interval: "monthly" },
  { plan: "managed_pro", interval: "annual" },
];

/** Resolves a Stripe Price ID back to its canonical plan+interval, or
 * `null` if it doesn't match any of the 4 currently-configured recurring
 * Price IDs (either a genuinely unknown Price, or one of the 4 env vars
 * simply isn't set yet — both cases are indistinguishable to a caller and
 * both correctly mean "cannot resolve this Price"). */
export function resolvePlanFromPriceId(priceId: string): { plan: CommercialPlan; interval: BillingInterval } | null {
  for (const { plan, interval } of ALL_PLAN_INTERVAL_PAIRS) {
    try {
      if (getSubscriptionPriceId(plan, interval) === priceId) return { plan, interval };
    } catch (err) {
      if (err instanceof SubscriptionPriceNotConfiguredError) continue;
      throw err;
    }
  }
  return null;
}
