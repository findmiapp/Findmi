// Business Order Management Overhaul V1 — business-scoped order read
// helpers for the Business Manager Orders tab. Same authorize-then-elevate
// shape as getBusinessFollowerSummary/getBusinessInquiryList: every export
// here takes an already-service-role `admin` client and is only ever
// called AFTER the page itself has run requireBusinessMember(businessId),
// and every query is filtered by `.eq("business_id", businessId)` so a
// multi-vendor order can never leak another business's items, revenue, or
// fees. Reuses the existing orders/order_items schema — no competing order
// system, no new tables.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FulfillmentMethod } from "@/lib/types";
import type { FulfillmentStatus, OrderPaymentStatus } from "@/lib/commerce/types";

/** Weakest-link rollup for a set of item-level statuses belonging to one
 * order (a business may have several items on the same order). Cancelled
 * items are excluded from the rollup unless every item is cancelled — a
 * single cancelled item shouldn't make an otherwise-active order read as
 * "Cancelled". Mirrors the same "weakest link" approach the customer-
 * facing aggregate status (task section 6) uses. */
const STAGE_RANK: Record<Exclude<FulfillmentStatus, "cancelled">, number> = {
  new: 0,
  confirmed: 1,
  ready: 2,
  fulfilled: 3,
};

export function aggregateFulfillmentStatus(statuses: FulfillmentStatus[]): FulfillmentStatus {
  const active = statuses.filter((s): s is Exclude<FulfillmentStatus, "cancelled"> => s !== "cancelled");
  if (active.length === 0) return "cancelled";
  return active.reduce((weakest, s) => (STAGE_RANK[s] < STAGE_RANK[weakest] ? s : weakest), active[0]);
}

export type BusinessOrderStatusFilter = "new" | "open" | "ready" | "fulfilled" | "cancelled";

const FILTER_TO_STATUS: Record<BusinessOrderStatusFilter, FulfillmentStatus> = {
  new: "new",
  open: "confirmed",
  ready: "ready",
  fulfilled: "fulfilled",
  cancelled: "cancelled",
};

export interface BusinessOrderSummary {
  newCount: number;
  openCount: number;
  readyCount: number;
  fulfilledCount: number;
  cancelledCount: number;
}

type OrderItemRow = {
  order_id: string;
  business_id: string;
  fulfillment_status: FulfillmentStatus;
  orders: { payment_status: OrderPaymentStatus } | { payment_status: OrderPaymentStatus }[] | null;
};

function orderPaid(row: OrderItemRow): boolean {
  const o = Array.isArray(row.orders) ? row.orders[0] : row.orders;
  return o?.payment_status === "paid";
}

/** Only paid orders count/show at all — an unpaid or failed order has
 * nothing for a business to fulfill yet (task section 5: a business
 * cannot mark an unpaid order paid, and by the same logic never sees one
 * to act on in the first place). */
export async function getBusinessOrderSummary(
  admin: SupabaseClient,
  businessId: string
): Promise<BusinessOrderSummary> {
  const { data } = await admin
    .from("order_items")
    .select("order_id, business_id, fulfillment_status, orders(payment_status)")
    .eq("business_id", businessId);

  const rows = ((data ?? []) as OrderItemRow[]).filter(orderPaid);
  const byOrder = new Map<string, FulfillmentStatus[]>();
  for (const row of rows) {
    const list = byOrder.get(row.order_id) ?? [];
    list.push(row.fulfillment_status);
    byOrder.set(row.order_id, list);
  }

  const summary: BusinessOrderSummary = { newCount: 0, openCount: 0, readyCount: 0, fulfilledCount: 0, cancelledCount: 0 };
  for (const statuses of byOrder.values()) {
    const status = aggregateFulfillmentStatus(statuses);
    if (status === "new") summary.newCount++;
    else if (status === "confirmed") summary.openCount++;
    else if (status === "ready") summary.readyCount++;
    else if (status === "fulfilled") summary.fulfilledCount++;
    else summary.cancelledCount++;
  }
  return summary;
}

export interface BusinessOrderListItem {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  customerName: string | null;
  customerEmail: string;
  itemCount: number;
  quantityTotal: number;
  businessSubtotal: number;
  fulfillmentMethods: FulfillmentMethod[];
  status: FulfillmentStatus;
}

type ListRow = {
  order_id: string;
  quantity: number;
  line_merchandise_total: number;
  fulfillment_amount: number;
  fulfillment_method: FulfillmentMethod;
  fulfillment_status: FulfillmentStatus;
  orders:
    | { id: string; order_number: string; created_at: string; customer_name: string | null; customer_email: string; payment_status: OrderPaymentStatus }
    | { id: string; order_number: string; created_at: string; customer_name: string | null; customer_email: string; payment_status: OrderPaymentStatus }[]
    | null;
};

export async function getBusinessOrderList(
  admin: SupabaseClient,
  businessId: string,
  statusFilter?: BusinessOrderStatusFilter
): Promise<BusinessOrderListItem[]> {
  const { data } = await admin
    .from("order_items")
    .select(
      "order_id, quantity, line_merchandise_total, fulfillment_amount, fulfillment_method, fulfillment_status, orders(id, order_number, created_at, customer_name, customer_email, payment_status)"
    )
    .eq("business_id", businessId);

  const rows = (data ?? []) as ListRow[];
  const byOrder = new Map<string, ListRow[]>();
  for (const row of rows) {
    const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    if (!order || order.payment_status !== "paid") continue;
    const list = byOrder.get(row.order_id) ?? [];
    list.push(row);
    byOrder.set(row.order_id, list);
  }

  const items: BusinessOrderListItem[] = [];
  for (const [orderId, orderRows] of byOrder) {
    const order = Array.isArray(orderRows[0].orders) ? orderRows[0].orders[0] : orderRows[0].orders;
    if (!order) continue;
    const status = aggregateFulfillmentStatus(orderRows.map((r) => r.fulfillment_status));
    if (statusFilter && FILTER_TO_STATUS[statusFilter] !== status) continue;
    items.push({
      orderId,
      orderNumber: order.order_number,
      createdAt: order.created_at,
      customerName: order.customer_name,
      customerEmail: order.customer_email,
      itemCount: orderRows.length,
      quantityTotal: orderRows.reduce((sum, r) => sum + r.quantity, 0),
      businessSubtotal: orderRows.reduce((sum, r) => sum + r.line_merchandise_total + r.fulfillment_amount, 0),
      fulfillmentMethods: Array.from(new Set(orderRows.map((r) => r.fulfillment_method))),
      status,
    });
  }

  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export interface BusinessOrderEventContext {
  eventId: string;
  eventName: string;
  eventSlug: string;
  appearanceTitle: string;
  venueName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  startAt: string;
  endAt: string | null;
  description: string | null;
}

export interface BusinessOrderItemDetail {
  id: string;
  productId: string;
  productName: string;
  productImageUrl: string | null;
  quantity: number;
  unitPrice: number;
  lineMerchandiseTotal: number;
  fulfillmentMethod: FulfillmentMethod;
  fulfillmentAmount: number;
  fulfillmentStatus: FulfillmentStatus;
  internalNote: string | null;
  refundedAmount: number;
  eventContext: BusinessOrderEventContext | null;
}

export interface BusinessOrderDetail {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  paymentStatus: OrderPaymentStatus;
  customerName: string | null;
  customerEmail: string;
  customerPhone: string | null;
  businessSubtotal: number;
  status: FulfillmentStatus;
  items: BusinessOrderItemDetail[];
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
  internal_note: string | null;
  refunded_amount: number;
  appearance_id: string | null;
  products: { name: string; image_url: string | null } | { name: string; image_url: string | null }[] | null;
  appearances:
    | {
        title: string;
        venue_name: string | null;
        address: string | null;
        city: string | null;
        state: string | null;
        start_at: string;
        end_at: string | null;
        description: string | null;
        event: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null;
      }
    | {
        title: string;
        venue_name: string | null;
        address: string | null;
        city: string | null;
        state: string | null;
        start_at: string;
        end_at: string | null;
        description: string | null;
        event: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null;
      }[]
    | null;
};

/** Order detail for exactly one business's own line items on one order —
 * `.eq("business_id", businessId)` on the items query is the actual
 * enforcement (never trust the caller only checked requireBusinessMember);
 * a mismatched orderId/businessId pair simply yields an empty items array
 * and this returns null, same "wrong id -> null, never another tenant's
 * data" shape as getBusinessInquiryDetail. */
export async function getBusinessOrderDetail(
  admin: SupabaseClient,
  orderId: string,
  businessId: string
): Promise<BusinessOrderDetail | null> {
  const [{ data: order }, { data: itemRows }] = await Promise.all([
    admin
      .from("orders")
      .select("id, order_number, created_at, payment_status, customer_name, customer_email, customer_phone")
      .eq("id", orderId)
      .maybeSingle(),
    admin
      .from("order_items")
      .select(
        "id, product_id, quantity, unit_price, line_merchandise_total, fulfillment_method, fulfillment_amount, fulfillment_status, internal_note, refunded_amount, appearance_id, products(name, image_url), appearances(title, venue_name, address, city, state, start_at, end_at, description, event:events(id, name, slug))"
      )
      .eq("order_id", orderId)
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
  ]);

  if (!order) return null;
  const rows = (itemRows ?? []) as DetailItemRow[];
  if (rows.length === 0) return null;

  const items: BusinessOrderItemDetail[] = rows.map((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    const appearance = Array.isArray(row.appearances) ? row.appearances[0] : row.appearances;
    const event = appearance ? (Array.isArray(appearance.event) ? appearance.event[0] : appearance.event) : null;
    return {
      id: row.id,
      productId: row.product_id,
      productName: product?.name ?? "Product",
      productImageUrl: product?.image_url ?? null,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      lineMerchandiseTotal: row.line_merchandise_total,
      fulfillmentMethod: row.fulfillment_method,
      fulfillmentAmount: row.fulfillment_amount,
      fulfillmentStatus: row.fulfillment_status,
      internalNote: row.internal_note,
      refundedAmount: row.refunded_amount,
      eventContext:
        appearance && event
          ? {
              eventId: event.id,
              eventName: event.name,
              eventSlug: event.slug,
              appearanceTitle: appearance.title,
              venueName: appearance.venue_name,
              address: appearance.address,
              city: appearance.city,
              state: appearance.state,
              startAt: appearance.start_at,
              endAt: appearance.end_at,
              description: appearance.description,
            }
          : null,
    };
  });

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    createdAt: order.created_at,
    paymentStatus: order.payment_status,
    customerName: order.customer_name,
    customerEmail: order.customer_email,
    customerPhone: order.customer_phone,
    businessSubtotal: items.reduce((sum, i) => sum + i.lineMerchandiseTotal + i.fulfillmentAmount, 0),
    status: aggregateFulfillmentStatus(items.map((i) => i.fulfillmentStatus)),
    items,
  };
}
