import { notFound } from "next/navigation";
import Link from "next/link";
import { getAdminOrderById } from "@/lib/admin/commerce-queries";
import FulfillmentStatusToggle from "@/components/admin/FulfillmentStatusToggle";
import RefundForm from "@/components/admin/RefundForm";
import { issueRefund } from "../actions";

export const dynamic = "force-dynamic";

const FULFILLMENT_LABELS: Record<string, string> = {
  shipping: "Shipping",
  local_delivery: "Local Delivery",
  pickup: "Pickup",
  event_pickup: "Event Pickup",
};

export default async function AdminOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; refunded?: string }>;
}) {
  const { id } = await params;
  const { error, refunded } = await searchParams;
  const result = await getAdminOrderById(id);
  if (!result) notFound();
  const { order, items, allocations, refunds } = result;

  const itemsByBusiness = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByBusiness.get(item.business_id) ?? [];
    list.push(item);
    itemsByBusiness.set(item.business_id, list);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{order.order_number}</h1>
        <Link href="/admin/orders" className="text-xs font-semibold text-ink/50 hover:text-ink">
          ← All Orders
        </Link>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>
      )}
      {refunded && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">Refund recorded.</p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-black/10 p-4 text-sm">
          <p className="mb-2 font-semibold text-ink">Customer</p>
          <p className="text-ink/70">{order.customer_name || "—"}</p>
          <p className="text-ink/70">{order.customer_email}</p>
          {order.customer_phone && <p className="text-ink/70">{order.customer_phone}</p>}
          <p className="mt-2 text-xs text-ink/45">
            Placed {new Date(order.created_at).toLocaleString("en-US")}
          </p>
        </div>
        <div className="rounded-2xl border border-black/10 p-4 text-sm">
          <p className="mb-2 font-semibold text-ink">Payment</p>
          <p className="text-ink/70">Status: {order.payment_status}</p>
          <p className="text-ink/70">Refund: {order.refund_status}</p>
          {order.stripe_checkout_session_id && (
            <p className="mt-1 truncate text-xs text-ink/40">Session: {order.stripe_checkout_session_id}</p>
          )}
          {order.stripe_payment_intent_id && (
            <p className="truncate text-xs text-ink/40">PaymentIntent: {order.stripe_payment_intent_id}</p>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-black/10 p-4 text-sm">
        <p className="mb-2 font-semibold text-ink">Totals</p>
        <div className="flex flex-col gap-1 text-ink/70">
          <Row label="Merchandise" value={order.merchandise_subtotal} />
          <Row label="Fulfillment" value={order.fulfillment_total} />
          {order.customer_processing_fee_total > 0 && <Row label="Processing fee" value={order.customer_processing_fee_total} />}
          <div className="flex items-center justify-between border-t border-black/10 pt-1 font-semibold text-ink">
            <span>Total Charged</span>
            <span>${order.total_charged.toFixed(2)}</span>
          </div>
          {order.stripe_processing_fee_amount != null && (
            <p className="mt-1 text-xs text-ink/40">
              Stripe processing fee (actual): ${order.stripe_processing_fee_amount.toFixed(2)}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6">
        <p className="mb-2 text-sm font-semibold text-ink">Items by Vendor</p>
        <div className="flex flex-col gap-4">
          {Array.from(itemsByBusiness.entries()).map(([businessId, businessItems]) => (
            <div key={businessId} className="rounded-2xl border border-black/10 p-4">
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-findmi-700">
                {businessItems[0].business_name}
              </p>
              <div className="flex flex-col gap-3">
                {businessItems.map((item) => {
                  const refundable = item.line_merchandise_total + item.fulfillment_amount - item.refunded_amount;
                  return (
                    <div key={item.id} className="rounded-xl border border-black/5 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-ink">
                          {item.product_name} × {item.quantity}
                        </p>
                        <FulfillmentStatusToggle
                          orderItemId={item.id}
                          orderId={order.id}
                          fulfilled={item.fulfillment_status === "fulfilled"}
                        />
                      </div>
                      <p className="mt-1 text-xs text-ink/50">
                        {FULFILLMENT_LABELS[item.fulfillment_method]}
                        {item.fulfillment_amount > 0 && ` — $${item.fulfillment_amount.toFixed(2)}`}
                        {" · "}Unit ${item.unit_price.toFixed(2)} · Line ${item.line_merchandise_total.toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs text-ink/40">
                        FindMi fee {item.marketplace_fee_percent}% (${item.marketplace_fee_amount.toFixed(2)}, {item.applied_fee_source}) ·
                        {" "}Processing paid by {item.processing_fee_payer}
                        {item.allocated_processing_fee_amount > 0 && ` ($${item.allocated_processing_fee_amount.toFixed(2)})`}
                      </p>
                      <p className="mt-1 text-xs text-ink/40">
                        Vendor gross ${item.vendor_gross.toFixed(2)} → net ${item.vendor_net.toFixed(2)}
                        {item.refunded_amount > 0 && ` · Refunded $${item.refunded_amount.toFixed(2)}`}
                      </p>
                      <p className="mt-1 text-xs text-ink/40">Status: {item.fulfillment_status}</p>
                      {item.internal_note && (
                        <p className="mt-1 rounded-lg bg-black/[0.03] px-2 py-1 text-xs text-ink/60">
                          Vendor note: {item.internal_note}
                        </p>
                      )}

                      {/* Refund is only ever offered for a genuinely paid
                          order — payment_status/stripe_payment_intent_id
                          both come from Stripe's own confirmed-payment
                          webhook (settleOrder), never from client input.
                          Hiding it here is a UX convenience only; the
                          authoritative check is server-side in
                          issueRefund(). */}
                      {order.payment_status === "paid" && refundable > 0.005 && (
                        <RefundForm action={issueRefund.bind(null, item.id)} refundable={refundable} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <p className="mb-2 text-sm font-semibold text-ink">Vendor Allocations</p>
        <div className="flex flex-col gap-2">
          {allocations.map((a) => (
            <Link
              key={a.id}
              href={`/admin/settlements/${a.business_id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/5 bg-white px-4 py-3 text-sm hover:border-black/10"
            >
              <span className="font-medium text-ink">{a.business_name}</span>
              <span className="text-xs text-ink/60">
                Net ${a.vendor_net.toFixed(2)} · Paid ${a.amount_paid.toFixed(2)} · Outstanding ${a.amount_outstanding.toFixed(2)}
              </span>
              <span className="rounded-full bg-black/[0.06] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink/50">
                {a.status}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {refunds.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-sm font-semibold text-ink">Refund History</p>
          <div className="flex flex-col gap-1.5 text-xs text-ink/60">
            {refunds.map((r) => (
              <p key={r.id}>
                {new Date(r.created_at).toLocaleDateString("en-US")} — ${r.amount.toFixed(2)}
                {r.reason && ` (${r.reason})`}
                {r.vendor_recoverable && " · vendor already paid — recoverable"}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span>${value.toFixed(2)}</span>
    </div>
  );
}
