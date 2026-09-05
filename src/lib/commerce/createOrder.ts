import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { computeOrderDraft } from "./quote";
import { generateOrderNumber } from "./orderNumber";
import type { CartLine } from "./types";

export interface CreateOrderInput {
  lines: CartLine[];
  customerEmail: string;
  customerName?: string | null;
  customerPhone?: string | null;
  sourceEventId?: string | null;
  sourceAppearanceId?: string | null;
  /** The signed-in customer's auth id, if any — populates orders.user_id
   * so /account/orders can show real order history (see business_order_
   * management migration). Guest checkout passes null/undefined and is
   * completely unaffected. */
  userId?: string | null;
}

export interface CreateOrderResult {
  orderId: string;
  orderNumber: string;
  total: number;
  lineItemsForStripe: { name: string; amount: number; quantity: number }[];
}

/** Re-derives the full order economics server-side (see computeOrderDraft
 * — never trusts the client) and persists a pending order + its items.
 * Called right before creating the Stripe Checkout Session; the order
 * exists in "pending" state before the customer ever reaches Stripe, so
 * the webhook has something to mark paid. */
export async function createPendingOrder(
  input: CreateOrderInput
): Promise<CreateOrderResult | { error: string }> {
  const supabase = getAdminSupabase();
  if (!supabase) return { error: "Server isn't configured for checkout." };
  if (!input.customerEmail?.trim()) return { error: "An email address is required." };

  const draft = await computeOrderDraft(input.lines);
  if (draft.items.length === 0) return { error: "Your cart is empty." };
  if (draft.quote.hasUnavailable) {
    return { error: "One or more items in your cart are no longer available. Please review your cart." };
  }

  let orderId: string | null = null;
  let orderNumber = "";
  for (let attempt = 0; attempt < 3 && !orderId; attempt++) {
    orderNumber = generateOrderNumber();
    const { data, error } = await supabase
      .from("orders")
      .insert({
        order_number: orderNumber,
        user_id: input.userId ?? null,
        customer_email: input.customerEmail.trim(),
        customer_name: input.customerName?.trim() || null,
        customer_phone: input.customerPhone?.trim() || null,
        merchandise_subtotal: draft.quote.merchandiseSubtotal,
        fulfillment_total: draft.quote.fulfillmentTotal,
        customer_processing_fee_total: draft.quote.customerProcessingFeeTotal,
        total_charged: draft.quote.total,
        source_event_id: input.sourceEventId ?? null,
        source_appearance_id: input.sourceAppearanceId ?? null,
      })
      .select("id")
      .single();
    if (!error && data) orderId = data.id;
    else if (error && error.code !== "23505") return { error: error.message }; // 23505 = unique_violation, retry
  }
  if (!orderId) return { error: "Could not create order — please try again." };

  const itemRows = draft.items.map((item) => ({
    order_id: orderId,
    product_id: item.productId,
    business_id: item.businessId,
    product_name: item.productName,
    unit_price: item.unitPrice,
    quantity: item.quantity,
    line_merchandise_total: item.lineMerchandiseTotal,
    fulfillment_method: item.fulfillmentMethod,
    fulfillment_amount: item.fulfillmentAmount,
    appearance_id: item.appearanceId,
    event_id: item.eventId,
    marketplace_fee_percent: item.marketplaceFeePercent,
    marketplace_fee_amount: item.marketplaceFeeAmount,
    applied_fee_source: item.appliedFeeSource,
    processing_fee_payer: item.processingFeePayer,
    allocated_processing_fee_amount: item.allocatedProcessingFeeAmount,
    vendor_gross: item.vendorGross,
    vendor_net: item.vendorNet,
    source_channel: item.sourceChannel,
  }));
  const { error: itemsError } = await supabase.from("order_items").insert(itemRows);
  if (itemsError) {
    await supabase.from("orders").delete().eq("id", orderId);
    return { error: itemsError.message };
  }

  const lineItemsForStripe = draft.items.flatMap((item) => {
    const rows = [
      {
        name: `${item.productName} × ${item.quantity}`,
        amount: item.unitPrice,
        quantity: item.quantity,
      },
    ];
    if (item.fulfillmentAmount > 0) {
      rows.push({
        name: `${item.productName} — ${item.fulfillmentLabel}`,
        amount: item.fulfillmentAmount,
        quantity: 1,
      });
    }
    return rows;
  });
  if (draft.quote.customerProcessingFeeTotal > 0) {
    lineItemsForStripe.push({
      name: "Processing fee",
      amount: draft.quote.customerProcessingFeeTotal,
      quantity: 1,
    });
  }

  return { orderId, orderNumber, total: draft.quote.total, lineItemsForStripe };
}
