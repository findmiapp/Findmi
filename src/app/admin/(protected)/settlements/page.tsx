import Link from "next/link";
import { getVendorSettlementSummaries } from "@/lib/admin/commerce-queries";

export const dynamic = "force-dynamic";

export default async function AdminSettlementsPage() {
  const summaries = await getVendorSettlementSummaries();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Settlements</h1>
      <p className="mt-1 text-sm text-ink/60">
        What FindMi owes each vendor, and what&rsquo;s already been paid out manually. No money moves automatically.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {summaries.length === 0 ? (
          <p className="text-sm text-ink/50">No vendor balances yet — they appear once an order is paid.</p>
        ) : (
          summaries.map((s) => (
            <Link
              key={s.business_id}
              href={`/admin/settlements/${s.business_id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
            >
              <span className="text-sm font-semibold text-ink">{s.business_name}</span>
              <span className="text-xs text-ink/60">
                Held ${s.held.toFixed(2)} · Paid ${s.paid.toFixed(2)}
                {s.refundAdjustment !== 0 && ` · Refund adj. $${s.refundAdjustment.toFixed(2)}`}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                  s.outstanding > 0 ? "bg-amber-50 text-amber-700" : s.outstanding < 0 ? "bg-red-50 text-red-700" : "bg-findmi-50 text-findmi-700"
                }`}
              >
                {s.outstanding > 0 ? `Owed $${s.outstanding.toFixed(2)}` : s.outstanding < 0 ? `Recoverable $${Math.abs(s.outstanding).toFixed(2)}` : "Settled"}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
