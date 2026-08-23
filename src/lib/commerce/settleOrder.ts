import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { allocateProportionally } from "./processingFee";
import { round2 } from "./fees";

/** Runs once per order, when Stripe confirms payment (see the webhook
 * route). Idempotent: if the order is already "paid", this is a no-op —
 * Stripe can and will redeliver the same event, and the browser landing on
 * /checkout/success must never be what marks an order paid (Part 15).
 *
 * Does three things:
 *  1. Marks the order paid and records the PaymentIntent id.
 *  2. Reconciles each item's estimated processing-fee allocation against
 *     Stripe's real fee, if it could be read from the charge (best-effort
 *     — the estimate already on each item stands if not available yet).
 *  3. Builds the per-vendor settlement ledger (vendor_order_allocations),
 *     status "held" — no money moves, this just records what's owed.
 */
export async function settleOrder(
  orderId: string,
  stripePaymentIntentId: string | null,
  actualProcessingFee: number | null
): Promise<void> {
  const supabase = getAdminSupabase();
  if (!supabase) return;

  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return;
  if (order.payment_status === "paid") return; // already settled — idempotent guard

  const { data: items } = await supabase.from("order_items").select("*").eq("order_id", orderId).order("id");
  const orderItems = items ?? [];

  if (actualProcessingFee != null && orderItems.length > 0) {
    const allocation = allocateProportionally(
      orderItems.map((i) => ({ id: i.id, chargeableValue: i.vendor_gross })),
      actualProcessingFee
    );
    for (const item of orderItems) {
      const share = allocation.get(item.id) ?? 0;
      const vendorNet =
        item.processing_fee_payer === "vendor"
          ? round2(item.vendor_gross - item.marketplace_fee_amount - share)
          : round2(item.vendor_gross - item.marketplace_fee_amount);
      await supabase
        .from("order_items")
        .update({ allocated_processing_fee_amount: share, vendor_net: vendorNet })
        .eq("id", item.id);
      item.allocated_processing_fee_amount = share;
      item.vendor_net = vendorNet;
    }
  }

  await supabase
    .from("orders")
    .update({
      payment_status: "paid",
      stripe_payment_intent_id: stripePaymentIntentId,
      stripe_processing_fee_amount: actualProcessingFee,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  const byBusiness = new Map<
    string,
    {
      merchandise_gross: number;
      fulfillment_revenue: number;
      marketplace_fee_amount: number;
      processing_fee_amount: number;
      vendor_net: number;
    }
  >();
  for (const item of orderItems) {
    const agg = byBusiness.get(item.business_id) ?? {
      merchandise_gross: 0,
      fulfillment_revenue: 0,
      marketplace_fee_amount: 0,
      processing_fee_amount: 0,
      vendor_net: 0,
    };
    agg.merchandise_gross = round2(agg.merchandise_gross + item.line_merchandise_total);
    agg.fulfillment_revenue = round2(agg.fulfillment_revenue + item.fulfillment_amount);
    agg.marketplace_fee_amount = round2(agg.marketplace_fee_amount + item.marketplace_fee_amount);
    if (item.processing_fee_payer === "vendor") {
      agg.processing_fee_amount = round2(agg.processing_fee_amount + item.allocated_processing_fee_amount);
    }
    agg.vendor_net = round2(agg.vendor_net + item.vendor_net);
    byBusiness.set(item.business_id, agg);
  }

  for (const [businessId, agg] of byBusiness) {
    await supabase.from("vendor_order_allocations").upsert(
      {
        order_id: orderId,
        business_id: businessId,
        ...agg,
        refund_adjustment: 0,
        amount_paid: 0,
        amount_outstanding: agg.vendor_net,
        status: "held",
      },
      { onConflict: "order_id,business_id" }
    );
  }
}
