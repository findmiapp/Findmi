"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { getStripe } from "@/lib/commerce/stripe";
import { round2 } from "@/lib/commerce/fees";
import { computeAllocationStatus } from "@/lib/commerce/ledger";
import { errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";

/** Refunds a specific dollar amount against one order item (Part 13 — a
 * whole-order refund is just doing this once per item). Attempts the real
 * Stripe refund (best-effort — a founder may also be recording a refund
 * already issued elsewhere), then always records the accounting entries so
 * the ledger stays the source of truth regardless of Stripe's outcome. */
export async function issueRefund(orderItemId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();

  const { data: item } = await supabase.from("order_items").select("*").eq("id", orderItemId).maybeSingle();
  if (!item) redirect(errorRedirectUrl("/admin/orders", "Order item not found."));

  const orderPath = `/admin/orders/${item!.order_id}`;

  const { data: order } = await supabase.from("orders").select("*").eq("id", item!.order_id).maybeSingle();
  if (!order) redirect(errorRedirectUrl(orderPath, "Order not found."));

  // Authoritative server-side eligibility check — the UI's decision to
  // show/hide the Refund control is never trusted on its own. A refund can
  // only be issued against money Stripe actually confirmed as captured;
  // without both a "paid" order and a real PaymentIntent id, there is
  // nothing to refund — proceeding would just fabricate a `refunds` row
  // and a `refunded_amount` bump for money that was never collected
  // (the exact production bug this check exists to close). Checked before
  // any Stripe call or write below.
  if (order!.payment_status !== "paid" || !order!.stripe_payment_intent_id) {
    redirect(errorRedirectUrl(orderPath, "This order hasn't been paid — there's nothing to refund."));
  }

  const amount = num(formData, "amount");
  const reason = str(formData, "reason");
  const refundable = round2(item!.line_merchandise_total + item!.fulfillment_amount - item!.refunded_amount);
  if (!amount || amount <= 0) redirect(errorRedirectUrl(orderPath, "Enter a refund amount greater than $0."));
  if (amount! > refundable + 0.005) {
    redirect(errorRedirectUrl(orderPath, `Can't refund more than the remaining $${refundable.toFixed(2)} on this item.`));
  }

  const { data: allocation } = await supabase
    .from("vendor_order_allocations")
    .select("*")
    .eq("order_id", item!.order_id)
    .eq("business_id", item!.business_id)
    .maybeSingle();

  let stripeRefundId: string | null = null;
  let stripeError: string | null = null;
  const stripe = getStripe();
  if (stripe && order!.stripe_payment_intent_id) {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: order!.stripe_payment_intent_id,
        amount: Math.round(amount! * 100),
      });
      stripeRefundId = refund.id;
    } catch (err) {
      stripeError = err instanceof Error ? err.message : "Stripe refund failed.";
    }
  }

  const vendorRecoverable = Boolean(allocation && allocation.amount_paid > 0);
  await supabase.from("refunds").insert({
    order_id: item!.order_id,
    order_item_id: orderItemId,
    amount,
    reason,
    stripe_refund_id: stripeRefundId,
    vendor_recoverable: vendorRecoverable,
  });

  const newRefundedAmount = round2(item!.refunded_amount + amount!);
  await supabase.from("order_items").update({ refunded_amount: newRefundedAmount }).eq("id", orderItemId);

  if (allocation) {
    const vendorShareRatio = item!.vendor_gross > 0 ? item!.vendor_net / item!.vendor_gross : 0;
    const vendorPortion = round2(amount! * vendorShareRatio);
    const newRefundAdjustment = round2(allocation.refund_adjustment - vendorPortion);
    const newOutstanding = round2(allocation.vendor_net + newRefundAdjustment - allocation.amount_paid);

    const { data: allItems } = await supabase.from("order_items").select("*").eq("order_id", item!.order_id);
    const fullyRefunded = (allItems ?? [])
      .filter((i) => i.business_id === item!.business_id)
      .every((i) => round2(i.line_merchandise_total + i.fulfillment_amount - i.refunded_amount) <= 0.005);

    await supabase
      .from("vendor_order_allocations")
      .update({
        refund_adjustment: newRefundAdjustment,
        amount_outstanding: newOutstanding,
        status: computeAllocationStatus(allocation.amount_paid, newOutstanding, fullyRefunded),
        updated_at: new Date().toISOString(),
      })
      .eq("id", allocation.id);
  }

  const { data: allItems } = await supabase.from("order_items").select("*").eq("order_id", item!.order_id);
  const items = allItems ?? [];
  const allRefunded = items.every((i) => round2(i.line_merchandise_total + i.fulfillment_amount - i.refunded_amount) <= 0.005);
  const anyRefunded = items.some((i) => i.refunded_amount > 0);
  await supabase
    .from("orders")
    .update({ refund_status: allRefunded ? "full" : anyRefunded ? "partial" : "none", updated_at: new Date().toISOString() })
    .eq("id", item!.order_id);

  revalidatePath(orderPath);
  revalidatePath("/admin/orders");
  revalidatePath("/admin/settlements");
  redirect(
    stripeError
      ? errorRedirectUrl(orderPath, `Refund recorded, but the Stripe refund failed: ${stripeError}`)
      : `${orderPath}?refunded=1`
  );
}

// Business Order Management Overhaul V1 — fulfillment_status widened from
// a plain unfulfilled/fulfilled toggle to a real workflow (new/confirmed/
// ready/fulfilled/cancelled; see that migration). "unfulfilled" is no
// longer a valid value at all, so un-marking fulfilled here now reverts
// to "new" (the same "not yet handled" starting state "unfulfilled" used
// to mean) rather than a value the DB would now reject outright.
export async function toggleItemFulfilled(orderItemId: string, orderId: string, fulfilled: boolean) {
  const supabase = await requireAdminSupabase();
  await supabase
    .from("order_items")
    .update({ fulfillment_status: fulfilled ? "fulfilled" : "new" })
    .eq("id", orderItemId);
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
}
