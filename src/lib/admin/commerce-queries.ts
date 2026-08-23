import { getAdminSupabase } from "./supabase-admin";
import type {
  AllocationStatus,
  FulfillmentStatus,
  OrderPaymentStatus,
  OrderRefundStatus,
  SettlementMethod,
} from "@/lib/commerce/types";
import type { FulfillmentMethod, ProcessingFeePayer } from "@/lib/types";

export interface AdminOrderRow {
  id: string;
  order_number: string;
  customer_email: string;
  customer_name: string | null;
  total_charged: number;
  payment_status: OrderPaymentStatus;
  refund_status: OrderRefundStatus;
  created_at: string;
  vendorNames: string[];
  fulfillmentStatus: "unfulfilled" | "partial" | "fulfilled";
  settlementStatus: "held" | "partially_paid" | "paid" | "mixed" | "—";
}

export interface OrderListFilters {
  q?: string;
  paymentStatus?: OrderPaymentStatus;
}

export async function getAdminOrders(filters: OrderListFilters = {}): Promise<AdminOrderRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];

  let query = supabase.from("orders").select("*").order("created_at", { ascending: false });
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`order_number.ilike.${term},customer_email.ilike.${term}`);
  }
  if (filters.paymentStatus) query = query.eq("payment_status", filters.paymentStatus);
  const { data: orders } = await query.limit(200);
  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length === 0) return [];

  const [{ data: items }, { data: allocations }] = await Promise.all([
    supabase
      .from("order_items")
      .select("order_id, fulfillment_status, businesses(name)")
      .in("order_id", orderIds),
    supabase.from("vendor_order_allocations").select("order_id, status").in("order_id", orderIds),
  ]);

  type ItemRow = { order_id: string; fulfillment_status: FulfillmentStatus; businesses: { name: string } | { name: string }[] | null };
  const itemsByOrder = new Map<string, ItemRow[]>();
  for (const row of (items ?? []) as ItemRow[]) {
    const list = itemsByOrder.get(row.order_id) ?? [];
    list.push(row);
    itemsByOrder.set(row.order_id, list);
  }
  const allocationsByOrder = new Map<string, AllocationStatus[]>();
  for (const row of (allocations ?? []) as { order_id: string; status: AllocationStatus }[]) {
    const list = allocationsByOrder.get(row.order_id) ?? [];
    list.push(row.status);
    allocationsByOrder.set(row.order_id, list);
  }

  return (orders ?? []).map((order) => {
    const orderItems = itemsByOrder.get(order.id) ?? [];
    const vendorNames = Array.from(
      new Set(
        orderItems
          .map((i) => (Array.isArray(i.businesses) ? i.businesses[0] : i.businesses)?.name)
          .filter((n): n is string => Boolean(n))
      )
    );
    const fulfilledCount = orderItems.filter((i) => i.fulfillment_status === "fulfilled").length;
    const fulfillmentStatus =
      orderItems.length === 0 || fulfilledCount === 0
        ? "unfulfilled"
        : fulfilledCount === orderItems.length
          ? "fulfilled"
          : "partial";

    const statuses = allocationsByOrder.get(order.id) ?? [];
    const uniqueStatuses = new Set(statuses);
    const settlementStatus =
      uniqueStatuses.size === 0
        ? "—"
        : uniqueStatuses.size > 1
          ? "mixed"
          : (statuses[0] as "held" | "partially_paid" | "paid");

    return {
      id: order.id,
      order_number: order.order_number,
      customer_email: order.customer_email,
      customer_name: order.customer_name,
      total_charged: order.total_charged,
      payment_status: order.payment_status,
      refund_status: order.refund_status,
      created_at: order.created_at,
      vendorNames,
      fulfillmentStatus,
      settlementStatus,
    };
  });
}

export interface AdminOrderItemRow {
  id: string;
  product_id: string;
  business_id: string;
  business_name: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_merchandise_total: number;
  fulfillment_method: FulfillmentMethod;
  fulfillment_amount: number;
  appearance_id: string | null;
  event_id: string | null;
  marketplace_fee_percent: number;
  marketplace_fee_amount: number;
  applied_fee_source: string;
  processing_fee_payer: ProcessingFeePayer;
  allocated_processing_fee_amount: number;
  vendor_gross: number;
  vendor_net: number;
  source_channel: string | null;
  fulfillment_status: FulfillmentStatus;
  refunded_amount: number;
}

export interface AdminVendorAllocationRow {
  id: string;
  business_id: string;
  business_name: string;
  merchandise_gross: number;
  fulfillment_revenue: number;
  marketplace_fee_amount: number;
  processing_fee_amount: number;
  refund_adjustment: number;
  vendor_net: number;
  amount_paid: number;
  amount_outstanding: number;
  status: AllocationStatus;
}

export interface AdminRefundRow {
  id: string;
  order_item_id: string;
  amount: number;
  reason: string | null;
  vendor_recoverable: boolean;
  created_at: string;
}

export async function getAdminOrderById(id: string): Promise<{
  order: {
    id: string;
    order_number: string;
    customer_email: string;
    customer_name: string | null;
    customer_phone: string | null;
    currency: string;
    merchandise_subtotal: number;
    fulfillment_total: number;
    customer_processing_fee_total: number;
    total_charged: number;
    stripe_checkout_session_id: string | null;
    stripe_payment_intent_id: string | null;
    stripe_processing_fee_amount: number | null;
    payment_status: OrderPaymentStatus;
    refund_status: OrderRefundStatus;
    created_at: string;
  };
  items: AdminOrderItemRow[];
  allocations: AdminVendorAllocationRow[];
  refunds: AdminRefundRow[];
} | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;

  const { data: order } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (!order) return null;

  const [{ data: items }, { data: allocations }, { data: refunds }] = await Promise.all([
    supabase
      .from("order_items")
      .select("*, businesses(name)")
      .eq("order_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("vendor_order_allocations")
      .select("*, businesses(name)")
      .eq("order_id", id),
    supabase.from("refunds").select("*").eq("order_id", id).order("created_at", { ascending: false }),
  ]);

  type ItemJoin = { businesses: { name: string } | { name: string }[] | null };
  const mappedItems: AdminOrderItemRow[] = ((items ?? []) as never[]).map((row: unknown) => {
    const r = row as AdminOrderItemRow & ItemJoin;
    const business = Array.isArray(r.businesses) ? r.businesses[0] : r.businesses;
    return { ...r, business_name: business?.name ?? "Unknown business" };
  });

  type AllocJoin = { businesses: { name: string } | { name: string }[] | null };
  const mappedAllocations: AdminVendorAllocationRow[] = ((allocations ?? []) as never[]).map((row: unknown) => {
    const r = row as AdminVendorAllocationRow & AllocJoin;
    const business = Array.isArray(r.businesses) ? r.businesses[0] : r.businesses;
    return { ...r, business_name: business?.name ?? "Unknown business" };
  });

  return {
    order,
    items: mappedItems,
    allocations: mappedAllocations,
    refunds: (refunds as AdminRefundRow[]) ?? [],
  };
}

// ---------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------

export interface VendorSettlementSummary {
  business_id: string;
  business_name: string;
  held: number;
  paid: number;
  refundAdjustment: number;
  outstanding: number;
}

export async function getVendorSettlementSummaries(): Promise<VendorSettlementSummary[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("vendor_order_allocations")
    .select("business_id, vendor_net, amount_paid, amount_outstanding, refund_adjustment, businesses(name)");

  type Row = {
    business_id: string;
    vendor_net: number;
    amount_paid: number;
    amount_outstanding: number;
    refund_adjustment: number;
    businesses: { name: string } | { name: string }[] | null;
  };
  const byBusiness = new Map<string, VendorSettlementSummary>();
  for (const row of (data ?? []) as Row[]) {
    const business = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses;
    const existing = byBusiness.get(row.business_id) ?? {
      business_id: row.business_id,
      business_name: business?.name ?? "Unknown business",
      held: 0,
      paid: 0,
      refundAdjustment: 0,
      outstanding: 0,
    };
    existing.held += row.vendor_net;
    existing.paid += row.amount_paid;
    existing.refundAdjustment += row.refund_adjustment;
    existing.outstanding += row.amount_outstanding;
    byBusiness.set(row.business_id, existing);
  }
  return Array.from(byBusiness.values()).filter((s) => s.held !== 0 || s.paid !== 0);
}

export interface UnpaidAllocationRow {
  id: string;
  order_id: string;
  order_number: string;
  vendor_net: number;
  refund_adjustment: number;
  amount_paid: number;
  amount_outstanding: number;
  status: AllocationStatus;
}

export async function getUnpaidAllocationsForBusiness(businessId: string): Promise<UnpaidAllocationRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("vendor_order_allocations")
    .select("id, order_id, vendor_net, refund_adjustment, amount_paid, amount_outstanding, status, orders(order_number)")
    .eq("business_id", businessId)
    .neq("amount_outstanding", 0)
    .order("created_at", { ascending: true });

  type Row = UnpaidAllocationRow & { orders: { order_number: string } | { order_number: string }[] | null };
  return ((data ?? []) as never[]).map((row: unknown) => {
    const r = row as Row;
    const order = Array.isArray(r.orders) ? r.orders[0] : r.orders;
    return { ...r, order_number: order?.order_number ?? "—" };
  });
}

export interface SettlementPaymentRow {
  id: string;
  amount: number;
  payment_date: string;
  method: SettlementMethod;
  reference: string | null;
  note: string | null;
  created_at: string;
}

export async function getSettlementPaymentsForBusiness(businessId: string): Promise<SettlementPaymentRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("settlement_payments")
    .select("*")
    .eq("business_id", businessId)
    .order("payment_date", { ascending: false });
  return (data as SettlementPaymentRow[]) ?? [];
}
