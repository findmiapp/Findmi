import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCustomerOrderList, CUSTOMER_STATUS_LABELS } from "@/lib/customer-orders";
import { formatDateShort } from "@/lib/format";
import NavIcon from "@/components/NavIcon";
import { getPersonalDisplayName } from "@/lib/personalGraph";
import PersonalAppShell from "../PersonalAppShell";

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

  const [orders, displayName] = await Promise.all([getCustomerOrderList(supabase, user.id), getPersonalDisplayName(supabase, user.id)]);

  return (
    <PersonalAppShell displayName={displayName}>
      <h1 className="font-display text-page-title font-bold text-primary">Orders</h1>
      <p className="mt-1.5 text-body text-muted">A record of what you&rsquo;ve bought on Findmi.</p>

      {orders.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
            <NavIcon name="cart" className="h-5 w-5" />
          </div>
          <p className="mt-4 text-body font-semibold text-primary">Your Findmi orders will appear here</p>
          <p className="mx-auto mt-1.5 max-w-xs text-body text-muted">Nothing purchased yet while signed in.</p>
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
                <p className="truncate text-body font-semibold text-primary">#{o.orderNumber}</p>
                <p className="mt-0.5 text-metadata text-muted">
                  {formatDateShort(o.createdAt)} · {o.itemCount} item{o.itemCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-body font-bold text-primary">${o.totalCharged.toFixed(2)}</p>
                <span className="mt-0.5 inline-block rounded-full bg-black/[0.05] px-2.5 py-0.5 text-label font-bold uppercase text-muted">
                  {o.paymentStatus === "paid" ? CUSTOMER_STATUS_LABELS[o.status] : o.paymentStatus}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </PersonalAppShell>
  );
}
