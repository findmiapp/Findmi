import Link from "next/link";
import { getAdminOrders } from "@/lib/admin/commerce-queries";

export const dynamic = "force-dynamic";

const selectClass =
  "rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none";

const STATUS_STYLES: Record<string, string> = {
  paid: "bg-findmi-50 text-findmi-700",
  pending: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-700",
  canceled: "bg-black/[0.06] text-ink/50",
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const orders = await getAdminOrders({
    q,
    paymentStatus: status as "pending" | "paid" | "failed" | "canceled" | undefined,
  });

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Orders</h1>

      <form method="get" className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by order # or customer email…"
          className="w-full min-w-0 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none sm:max-w-xs sm:flex-1"
        />
        <div className="flex flex-wrap gap-2">
          <select name="status" defaultValue={status ?? ""} className={selectClass}>
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
            <option value="canceled">Canceled</option>
          </select>
          <button type="submit" className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-black/[0.03]">
            Filter
          </button>
        </div>
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {orders.length === 0 ? (
          <p className="text-sm text-ink/50">No orders found.</p>
        ) : (
          orders.map((o) => (
            <Link
              key={o.id}
              href={`/admin/orders/${o.id}`}
              className="flex flex-col gap-1.5 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {o.order_number} · {o.customer_name || o.customer_email}
                </p>
                <p className="truncate text-xs text-ink/45">
                  {new Date(o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ·{" "}
                  {o.vendorNames.join(", ") || "—"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <span className="font-semibold text-ink">${o.total_charged.toFixed(2)}</span>
                <span className={`rounded-full px-2.5 py-1 font-bold uppercase tracking-wide ${STATUS_STYLES[o.payment_status]}`}>
                  {o.payment_status}
                </span>
                <span className="rounded-full bg-black/[0.06] px-2.5 py-1 font-bold uppercase tracking-wide text-ink/50">
                  {o.fulfillmentStatus}
                </span>
                <span className="rounded-full bg-black/[0.06] px-2.5 py-1 font-bold uppercase tracking-wide text-ink/50">
                  {o.settlementStatus}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
