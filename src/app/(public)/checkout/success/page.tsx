import Link from "next/link";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";

export const dynamic = "force-dynamic";

// Reads the order's current state to display a confirmation — it never
// marks anything paid itself. Only the Stripe webhook does that (Part 15),
// since a browser can land here without payment ever actually completing
// (back button, a slow webhook, a bookmarked URL).
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  const supabase = getAdminSupabase();
  const order =
    supabase && session_id
      ? (
          await supabase
            .from("orders")
            .select("order_number, payment_status, customer_email, total_charged")
            .eq("stripe_checkout_session_id", session_id)
            .maybeSingle()
        ).data
      : null;

  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      {order?.payment_status === "paid" ? (
        <>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Thanks — order confirmed!</h1>
          <p className="mt-2 text-sm text-ink/60">
            Order {order.order_number} · ${Number(order.total_charged).toFixed(2)}
          </p>
          <p className="mt-1 text-sm text-ink/60">Confirmation sent to {order.customer_email}.</p>
        </>
      ) : order ? (
        <>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Confirming your payment…</h1>
          <p className="mt-2 text-sm text-ink/60">
            Order {order.order_number} is still finalizing — refresh this page in a moment.
          </p>
        </>
      ) : (
        <>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Order not found</h1>
          <p className="mt-2 text-sm text-ink/60">We couldn&rsquo;t find that order — check your email for a confirmation.</p>
        </>
      )}
      <Link
        href="/discover"
        className="mt-6 inline-block rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
      >
        Keep Exploring
      </Link>
    </div>
  );
}
