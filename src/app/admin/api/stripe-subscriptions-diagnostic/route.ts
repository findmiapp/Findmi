import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAdmin } from "@/lib/admin/auth";
import { getSubscriptionStripe, getSubscriptionStripeMode } from "@/lib/commerce/subscriptionStripe";
import { getSubscriptionPriceId } from "@/lib/commerce/subscriptionPricing";

// TEMPORARY production diagnostic — Stripe Account Identity pass. Answers
// exactly one question: which Stripe account does
// STRIPE_SUBSCRIPTIONS_SECRET_KEY actually authenticate as, and can that
// EXACT client retrieve the currently-configured Pro Monthly Price. Reuses
// the existing getSubscriptionStripe() client — no second Stripe client is
// constructed here, and the legacy Explore Staten Island client
// (lib/commerce/stripe.ts) is never imported/touched. Every call here is
// read-only (accounts.retrieve, prices.retrieve, and balance.retrieve via
// the existing getSubscriptionStripeMode helper) — this never creates,
// updates, or deletes any Stripe object, never touches Checkout.
//
// Protection: lives under /admin/api/..., so src/middleware.ts's existing
// "/admin/:path*" matcher already gates it behind the founder admin
// session cookie before this file's own code ever runs; requireAdmin()
// below is the same second, independent layer every other /admin/api/*
// route already uses (see admin/api/search/route.ts) — this is not a
// publicly reachable Stripe introspection endpoint.
//
// Output is a deliberately narrow allowlist — only what's explicitly safe
// to see (account id/name/country, livemode, and the retrieved Price's own
// public fields). Never returns or logs any secret key, publishable key,
// webhook secret, request header, or customer/payment data.
//
// DELETE THIS FILE once the account-identity question is answered — it is
// a one-time diagnostic, not a permanent surface.
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = getSubscriptionStripe();
  if (!stripe) {
    return NextResponse.json({ error: "STRIPE_SUBSCRIPTIONS_SECRET_KEY is not configured." }, { status: 500 });
  }

  const result: Record<string, unknown> = {};

  try {
    const account = await stripe.accounts.retrieveCurrent();
    result.account = {
      id: account.id,
      name: account.business_profile?.name ?? account.settings?.dashboard?.display_name ?? null,
      country: account.country ?? null,
    };
  } catch (err) {
    result.account = { error: stripeErrorInfo(err) };
  }

  try {
    result.livemode = await getSubscriptionStripeMode(stripe);
  } catch (err) {
    result.livemode = { error: stripeErrorInfo(err) };
  }

  // Reuses the exact same resolver createRecurringSubscriptionCheckoutSession
  // itself calls — never a hardcoded/duplicated Price ID literal here, so
  // this diagnostic always checks whatever is ACTUALLY configured right now.
  let priceId: string | null = null;
  try {
    priceId = getSubscriptionPriceId("pro", "monthly");
  } catch {
    priceId = null;
  }

  if (!priceId) {
    result.price = { error: "STRIPE_PRO_MONTHLY_PRICE_ID is not configured." };
  } else {
    try {
      const price = await stripe.prices.retrieve(priceId);
      result.price = {
        id: price.id,
        active: price.active,
        currency: price.currency,
        unit_amount: price.unit_amount,
        recurring_interval: price.recurring?.interval ?? null,
        product: typeof price.product === "string" ? price.product : (price.product?.id ?? null),
      };
    } catch (err) {
      result.price = { requestedId: priceId, error: stripeErrorInfo(err) };
    }
  }

  return NextResponse.json(result);
}

/** Extracts only the safe, non-secret fields of a Stripe error — type,
 * code, and message. Never touches request/response headers or anything
 * that could carry a key. */
function stripeErrorInfo(err: unknown): { type: string | null; code: string | null; message: string } {
  if (err instanceof Stripe.errors.StripeError) {
    return { type: err.type ?? null, code: err.code ?? null, message: err.message };
  }
  return { type: null, code: null, message: err instanceof Error ? err.message : String(err) };
}
