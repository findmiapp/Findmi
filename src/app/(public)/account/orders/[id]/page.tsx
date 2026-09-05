import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCustomerOrderDetail, CUSTOMER_STATUS_LABELS } from "@/lib/customer-orders";
import { FULFILLMENT_LABELS } from "@/lib/commerce/quote";
import { formatDateShort } from "@/lib/format";
import SupabaseImage from "@/components/SupabaseImage";
import AccountNav from "../../AccountNav";

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/** A customer's own order detail — getCustomerOrderDetail already scopes
 * to `.eq("user_id", user.id)` on top of orders_select_own RLS, so a
 * mistyped/foreign id here resolves to notFound(), never another
 * customer's order. Never shows a business's internal fulfillment note —
 * that field isn't even selected here (see lib/customer-orders.ts). */
export default async function AccountOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/account/orders/${id}`)}`);

  const order = await getCustomerOrderDetail(supabase, id, user.id);
  if (!order) notFound();

  const statusLabel = order.paymentStatus === "paid" ? CUSTOMER_STATUS_LABELS[order.status] : order.paymentStatus;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <Link href="/account/orders" className="text-xs font-semibold text-ink/50 hover:text-ink">
        ← All orders
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Order #{order.orderNumber}</h1>
        <span className="rounded-full bg-findmi-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-findmi-700">
          {statusLabel}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink/50">{formatDateShort(order.createdAt)}</p>

      <div className="mt-6 flex flex-col gap-3">
        {order.items.map((item) => (
          <div key={item.id} className="flex items-start gap-3 rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-mist">
              {item.productImageUrl && (
                <SupabaseImage src={item.productImageUrl} alt={item.productName} fill sizes="48px" className="object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{item.productName}</p>
              <p className="text-xs text-ink/50">{item.businessName}</p>
              <p className="mt-0.5 text-xs text-ink/45">
                Qty {item.quantity} × ${item.unitPrice.toFixed(2)} · {FULFILLMENT_LABELS[item.fulfillmentMethod]}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold text-ink">${item.lineMerchandiseTotal.toFixed(2)}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-black/5 bg-white p-4 text-sm shadow-sm">
        <div className="flex justify-between text-ink/60">
          <span>Subtotal</span>
          <span>${order.merchandiseSubtotal.toFixed(2)}</span>
        </div>
        {order.fulfillmentTotal > 0 && (
          <div className="mt-1 flex justify-between text-ink/60">
            <span>Fulfillment</span>
            <span>${order.fulfillmentTotal.toFixed(2)}</span>
          </div>
        )}
        {order.customerProcessingFeeTotal > 0 && (
          <div className="mt-1 flex justify-between text-ink/60">
            <span>Processing fee</span>
            <span>${order.customerProcessingFeeTotal.toFixed(2)}</span>
          </div>
        )}
        <div className="mt-2 flex justify-between border-t border-black/5 pt-2 font-bold text-ink">
          <span>Total</span>
          <span>${order.totalCharged.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
