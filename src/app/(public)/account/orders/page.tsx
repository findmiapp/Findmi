import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCustomerOrderList, CUSTOMER_STATUS_LABELS } from "@/lib/customer-orders";
import { formatDateShort } from "@/lib/format";
import NavIcon from "@/components/NavIcon";
import AccountNav from "../AccountNav";

export const metadata: Metadata = {
  title: "Orders",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/** Business Order Management Overhaul V1 — the authenticated customer's
 * own order history. orders.user_id + the orders_select_own RLS policy
 * (see migration business_order_management) are what actually scope this
 * to auth.uid(); getCustomerOrderList's own `.eq("user_id", userId)` is
 * defense in depth on top of that, same discipline as inquiries. Only
 * orders placed while signed in appear here — guest checkouts before this
 * pass, or by a customer who wasn't signed in, have no user_id and simply
 * never show up (nothing to backfill/guess). */
export default async function OrdersPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/orders");

  const orders = await getCustomerOrderList(supabase, user.id);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Orders</h1>
      <p className="mt-1.5 text-sm text-ink/50">A record of what you&rsquo;ve bought on FindMi.</p>

      {orders.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
            <NavIcon name="cart" className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-semibold text-ink">Your FindMi orders will appear here</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink/50">Nothing purchased yet while signed in.</p>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-2">
          {orders.map((o) => (
            <Link
              key={o.orderId}
              href={`/account/orders/${o.orderId}`}
              className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm transition hover:border-black/10"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">#{o.orderNumber}</p>
                <p className="mt-0.5 text-xs text-ink/50">
                  {formatDateShort(o.createdAt)} · {o.itemCount} item{o.itemCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold text-ink">${o.totalCharged.toFixed(2)}</p>
                <span className="mt-0.5 inline-block rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/55">
                  {o.paymentStatus === "paid" ? CUSTOMER_STATUS_LABELS[o.status] : o.paymentStatus}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
