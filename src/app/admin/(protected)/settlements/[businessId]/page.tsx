import { notFound } from "next/navigation";
import {
  getSettlementPaymentsForBusiness,
  getUnpaidAllocationsForBusiness,
} from "@/lib/admin/commerce-queries";
import { getAdminBusinessById } from "@/lib/admin/queries";
import { recordSettlementPayment } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminSettlementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ error?: string; paid?: string }>;
}) {
  const { businessId } = await params;
  const { error, paid } = await searchParams;
  const [businessResult, unpaidAllocations, payments] = await Promise.all([
    getAdminBusinessById(businessId),
    getUnpaidAllocationsForBusiness(businessId),
    getSettlementPaymentsForBusiness(businessId),
  ]);
  if (!businessResult) notFound();

  const totalOutstanding = unpaidAllocations.reduce((s, a) => s + a.amount_outstanding, 0);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
        {businessResult.business.name}
      </h1>
      <p className="mt-1 text-sm text-ink/60">
        Outstanding: <span className="font-semibold text-ink">${totalOutstanding.toFixed(2)}</span>
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>
      )}
      {paid && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">Payout recorded.</p>
      )}

      <div className="mt-6">
        <p className="mb-2 text-sm font-semibold text-ink">Record a Payout</p>
        {unpaidAllocations.length === 0 ? (
          <p className="text-sm text-ink/50">Nothing outstanding right now.</p>
        ) : (
          <form action={recordSettlementPayment.bind(null, businessId)} className="flex flex-col gap-3 rounded-2xl border border-black/10 p-4">
            <div className="flex flex-col gap-2">
              {unpaidAllocations.map((a) => (
                <label key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-black/5 p-2.5 text-sm">
                  <span className="flex items-center gap-2.5">
                    <input type="checkbox" name="allocation_id" value={a.id} defaultChecked className="h-4 w-4 accent-findmi" />
                    Order {a.order_number}
                  </span>
                  <span className="text-xs text-ink/60">
                    Net ${(a.vendor_net + a.refund_adjustment).toFixed(2)} · Outstanding ${a.amount_outstanding.toFixed(2)}
                  </span>
                </label>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">Amount</span>
                <input
                  type="number"
                  name="amount"
                  step="0.01"
                  min="0.01"
                  defaultValue={totalOutstanding.toFixed(2)}
                  required
                  className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">Date</span>
                <input
                  type="date"
                  name="payment_date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink"
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">Method</span>
                <select name="method" defaultValue="ach" className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink">
                  <option value="ach">ACH</option>
                  <option value="zelle">Zelle</option>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">Reference</span>
                <input type="text" name="reference" placeholder="Check #, transaction ID…" className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink" />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Note</span>
              <input type="text" name="note" className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink" />
            </label>

            <button type="submit" className="self-start rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600">
              Record Payout
            </button>
          </form>
        )}
      </div>

      {payments.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-sm font-semibold text-ink">Payout History</p>
          <div className="flex flex-col gap-1.5">
            {payments.map((p) => (
              <div key={p.id} className="rounded-xl border border-black/5 bg-white px-4 py-2.5 text-sm text-ink/70">
                {p.payment_date} · ${p.amount.toFixed(2)} · {p.method}
                {p.reference && ` · ${p.reference}`}
                {p.note && ` — ${p.note}`}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
