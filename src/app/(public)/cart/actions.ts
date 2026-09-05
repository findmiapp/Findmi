"use server";

import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { getStripe } from "@/lib/commerce/stripe";
import { computeOrderDraft } from "@/lib/commerce/quote";
import { createPendingOrder } from "@/lib/commerce/createOrder";
import { getPublicOrigin } from "@/lib/site-url";
import type { CartLine, CartQuote } from "@/lib/commerce/types";

/** Re-prices the cart server-side for display — the /cart page never
 * trusts anything read back from localStorage for money, only for which
 * product/quantity/fulfillment was chosen (see lib/commerce/quote.ts). */
export async function quoteCart(lines: CartLine[]): Promise<CartQuote> {
  const draft = await computeOrderDraft(lines);
  return draft.quote;
}

export interface StartCheckoutInput {
  lines: CartLine[];
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  sourceEventId?: string | null;
  sourceAppearanceId?: string | null;
}

/** Creates the pending FindMi order (server-recomputed economics — see
 * createPendingOrder) and a Stripe Checkout Session for its total. The
 * customer pays FindMi once, even across multiple vendors; no Stripe
 * Connect transfer happens here (see Part 14). */
export async function startCheckout(
  input: StartCheckoutInput
): Promise<{ url: string } | { error: string }> {
  const stripe = getStripe();
  if (!stripe) return { error: "Payments aren't configured yet — missing STRIPE_SECRET_KEY." };

  // Best-effort: a signed-in customer's order gets linked to their account
  // (orders.user_id) so it shows up in /account/orders. Checkout works
  // identically for a signed-out guest — this is purely additive.
  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();

  const order = await createPendingOrder({
    lines: input.lines,
    customerEmail: input.customerEmail,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    sourceEventId: input.sourceEventId,
    sourceAppearanceId: input.sourceAppearanceId,
    userId: user?.id ?? null,
  });
  if ("error" in order) return order;

  const siteUrl = getPublicOrigin();

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: input.customerEmail,
      line_items: order.lineItemsForStripe.map((li) => ({
        price_data: {
          currency: "usd",
          product_data: { name: li.name },
          unit_amount: Math.round(li.amount * 100),
        },
        quantity: li.quantity,
      })),
      metadata: { findmi_order_id: order.orderId, findmi_order_number: order.orderNumber },
      success_url: `${siteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/cart`,
    });

    const supabase = getAdminSupabase();
    if (supabase) {
      await supabase
        .from("orders")
        .update({ stripe_checkout_session_id: session.id })
        .eq("id", order.orderId);
    }

    if (!session.url) return { error: "Stripe didn't return a checkout URL." };
    return { url: session.url };
  } catch (err) {
    // The order row stays "pending" — it's simply abandoned if the
    // customer never completes a new checkout attempt; nothing to unwind.
    return { error: err instanceof Error ? err.message : "Could not start checkout." };
  }
}
