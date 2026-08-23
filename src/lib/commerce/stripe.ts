import Stripe from "stripe";

// Server-only Stripe client — STRIPE_SECRET_KEY has no NEXT_PUBLIC_ prefix,
// so it's never inlined client-side. This is a separate integration from
// the static NEXT_PUBLIC_STRIPE_FOUNDING_LINK Payment Link used for the
// Founding Membership — that one is untouched by commerce checkout.
let cached: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (cached) return cached;
  cached = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
  return cached;
}
