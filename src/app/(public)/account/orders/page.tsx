import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import NavIcon from "@/components/NavIcon";
import AccountNav from "../AccountNav";

export const metadata: Metadata = {
  title: "Orders",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/** Checkout orders aren't linked to authenticated accounts yet (orders/
 * order_items have no user_id — see lib/commerce/**) — this is
 * intentionally a placeholder, not a query against guest orders by email,
 * per this pass's explicit scope. No schema change, no order lookup. */
export default async function OrdersPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Middleware already gates this route; same defense-in-depth re-check
  // every other authenticated /account page does.
  if (!user) redirect("/login?next=/account/orders");

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Orders</h1>
      <p className="mt-1.5 text-sm text-ink/50">A record of what you&rsquo;ve bought on FindMi.</p>

      <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
          <NavIcon name="cart" className="h-5 w-5" />
        </div>
        <p className="mt-4 text-sm font-semibold text-ink">Your FindMi orders will appear here</p>
        <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink/50">
          Order history isn&rsquo;t connected to accounts yet — this is where it&rsquo;ll show up once it is.
        </p>
      </div>
    </div>
  );
}
