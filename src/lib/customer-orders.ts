// Business Order Management Overhaul V1 — customer-facing order history
// (task section 6). Reads go through the caller's own session client, so
// orders_select_own / order_items_select_own_customer RLS (see migration
// business_order_management) is the real enforcement — a signed-in
// customer can only ever see rows where orders.user_id = auth.uid(),
// never another customer's order and never a business's internal_note.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FulfillmentMethod } from "@/lib/types";
import type { FulfillmentStatus, OrderPaymentStatus } from "@/lib/commerce/types";
import { aggregateFulfillmentStatus } from "@/lib/business-orders";

/** Customer-facing collapse of the 5 internal fulfillment stages into the
 * 5 labels task section 6 asks for — a 1:1 rename, since the internal
 * "confirmed" stage IS what a customer would understand as "Confirmed"
 * and so on; kept as its own map (rather than reusing ORDER_STATUS_LABELS
 * from the Business Manager page) so the two surfaces can diverge in
 * wording later without coupling. */
export const CUSTOMER_STATUS_LABELS: Record<FulfillmentStatus, string> = {
  new: "Order received",
  confirmed: "Confirmed",
  ready: "Ready for pickup",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

export interface CustomerOrderListItem {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  totalCharged: number;
  paymentStatus: OrderPaymentStatus;
  status: FulfillmentStatus;
  itemCount: number;
}

type ListRow = {
  id: string;
  order_number: string;
  created_at: string;
  total_charged: number;
  payment_status: OrderPaymentStatus;
  order_items: { fulfillment_status: FulfillmentStatus }[] | null;
};

export async function getCustomerOrderList(supabase: SupabaseClient, userId: string): Promise<CustomerOrderListItem[]> {
  const { data } = await supabase
    .from("orders")
    .select("id, order_number, created_at, total_charged, payment_status, order_items(fulfillment_status)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as ListRow[]).map((row) => {
    const items = row.order_items ?? [];
    return {
      orderId: row.id,
      orderNumber: row.order_number,
      createdAt: row.created_at,
      totalCharged: row.total_charged,
      paymentStatus: row.payment_status,
      status: row.payment_status === "paid" ? aggregateFulfillmentStatus(items.map((i) => i.fulfillment_status)) : "new",
      itemCount: items.length,
    };
  });
}

export interface CustomerOrderItemDetail {
  id: string;
  productName: string;
  productImageUrl: string | null;
  quantity: number;
  unitPrice: number;
  lineMerchandiseTotal: number;
  fulfillmentMethod: FulfillmentMethod;
  fulfillmentAmount: number;
  fulfillmentStatus: FulfillmentStatus;
  businessName: string;
  businessSlug: string;
}

export interface CustomerOrderDetail {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  paymentStatus: OrderPaymentStatus;
  merchandiseSubtotal: number;
  fulfillmentTotal: number;
  customerProcessingFeeTotal: number;
  totalCharged: number;
  status: FulfillmentStatus;
  items: CustomerOrderItemDetail[];
}

type DetailItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_merchandise_total: number;
  fulfillment_method: FulfillmentMethod;
  fulfillment_amount: number;
  fulfillment_status: FulfillmentStatus;
  products: { name: string; image_url: string | null } | { name: string; image_url: string | null }[] | null;
  businesses: { name: string; slug: string } | { name: string; slug: string }[] | null;
};

/** Returns null for any order that isn't this exact user's own — relies
 * on RLS as the real guard (`.eq("user_id", userId)` here is defense in
 * depth, same discipline used for getCustomerInquiryDetail). Never
 * selects order_items.internal_note. */
export async function getCustomerOrderDetail(
  supabase: SupabaseClient,
  orderId: string,
  userId: string
): Promise<CustomerOrderDetail | null> {
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, order_number, created_at, payment_status, merchandise_subtotal, fulfillment_total, customer_processing_fee_total, total_charged"
    )
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!order) return null;

  const { data: itemRows } = await supabase
    .from("order_items")
    .select(
      "id, product_id, quantity, unit_price, line_merchandise_total, fulfillment_method, fulfillment_amount, fulfillment_status, products(name, image_url), businesses(name, slug)"
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  const items: CustomerOrderItemDetail[] = ((itemRows ?? []) as unknown as DetailItemRow[]).map((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    const business = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses;
    return {
      id: row.id,
      productName: product?.name ?? "Product",
      productImageUrl: product?.image_url ?? null,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      lineMerchandiseTotal: row.line_merchandise_total,
      fulfillmentMethod: row.fulfillment_method,
      fulfillmentAmount: row.fulfillment_amount,
      fulfillmentStatus: row.fulfillment_status,
      businessName: business?.name ?? "FindMi business",
      businessSlug: business?.slug ?? "",
    };
  });

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    createdAt: order.created_at,
    paymentStatus: order.payment_status,
    merchandiseSubtotal: order.merchandise_subtotal,
    fulfillmentTotal: order.fulfillment_total,
    customerProcessingFeeTotal: order.customer_processing_fee_total,
    totalCharged: order.total_charged,
    status: order.payment_status === "paid" ? aggregateFulfillmentStatus(items.map((i) => i.fulfillmentStatus)) : "new",
    items,
  };
}
