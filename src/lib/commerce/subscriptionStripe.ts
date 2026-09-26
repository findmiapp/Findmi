import Stripe from "stripe";

// Recurring Billing Pass 2A — a SEPARATE, additive Stripe client boundary
// for the future recurring FindMi Pro/Managed Pro subscription system.
// Deliberately does NOT reuse getStripe() (lib/commerce/stripe.ts) or its
// STRIPE_SECRET_KEY: that key is shared with legacy/live marketplace order
// checkout, legacy memberships, the existing $99 Business Pro checkout, and
// the existing webhook infrastructure, and this pass must not silently
// repurpose or rotate it. The dedicated recurring-subscription Stripe
// account is expected to use its own key, kept in
// STRIPE_SUBSCRIPTIONS_SECRET_KEY. Until a human configures that key, every
// function here fails closed with a clear server-side error — there is no
// fallback to the legacy key.
let cached: Stripe | null = null;

export function getSubscriptionStripe(): Stripe | null {
  const key = process.env.STRIPE_SUBSCRIPTIONS_SECRET_KEY;
  if (!key) return null;
  if (cached) return cached;
  // Same apiVersion pin as the legacy getStripe() client — both point at
  // the one Stripe SDK version this repo has installed, so there's no
  // reason for the two accounts to negotiate different API versions.
  cached = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
  return cached;
}

// Stripe mode (test vs. live) must be read from Stripe itself, never
// inferred from NODE_ENV/VERCEL_ENV/hostname/key-string-parsing/database
// state — see this pass's own report for the reasoning. Every Stripe API
// object (Customer, Checkout Session, Balance, ...) carries a `livemode`
// boolean directly from Stripe, so the smallest reliable way to learn a
// dedicated key's mode WITHOUT creating anything and without a chicken-
// and-egg dependency on the Customer resolver is a single, side-effect-
// free `balance.retrieve()` call — Balance is a read-only singleton
// resource scoped to the account behind the key, and its `livemode` field
// is exactly the signal we need. Cached per warm server instance: a given
// deployed secret's mode never changes while that instance is running, so
// repeat calls (customer resolution, then the duplicate-subscription
// check, then checkout creation) reuse one Balance lookup instead of one
// each. A cold start simply re-resolves it once.
let cachedLivemode: boolean | null = null;

export async function getSubscriptionStripeMode(stripe: Stripe): Promise<boolean> {
  if (cachedLivemode !== null) return cachedLivemode;
  const balance = await stripe.balance.retrieve();
  cachedLivemode = balance.livemode;
  return cachedLivemode;
}
