import Link from "next/link";
import { CheckboxField, NumberField, TextField } from "@/components/admin/Fields";
import { RelationField } from "@/components/admin/RelationPicker";
import { getAdminReferralPartners } from "@/lib/admin/referral-queries";
import { formatCurrency } from "@/lib/format";
import { createReferralPartner } from "./actions";

export const dynamic = "force-dynamic";

/** Referral Partner + Discount + Manual Payout Foundation — a completely
 * separate system from Pro Invites (/admin/pro-invites, untouched):
 * attribution + an optional Pro-checkout discount + a commission earned
 * only on an actual qualifying paid conversion, tracked in a durable
 * ledger with a manual payout-request workflow. Deliberately compact —
 * no large analytics dashboard, just the operational numbers this pass
 * asks for. */
export default async function AdminReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const partners = await getAdminReferralPartners();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Referral Partners</h1>
      <p className="mt-1 text-sm text-ink/60">
        Attribution, optional Pro-checkout discounts, and commission tracking for business referral partners —
        entirely separate from Pro Invites. A commission is only ever earned on an actual paid Pro conversion.
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-dashed border-black/15 bg-black/[0.015] p-4">
        <p className="text-sm font-semibold text-ink">Create Referral Partner</p>
        <form action={createReferralPartner} className="mt-3 flex flex-col gap-3">
          <RelationField
            label="Partner Business"
            name="business_id"
            entity="businesses"
            initial={null}
            clearLabel={null}
            hint="The business this referral partner is tied to."
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label="Display Label (optional)" name="label" placeholder="e.g. Stereotype Studio" />
            <NumberField label="Default Commission ($)" name="default_commission_dollars" defaultValue={20} step="0.01" />
          </div>
          <TextField label="Internal Notes (optional)" name="notes" />
          <CheckboxField label="Active" name="is_active" defaultChecked />
          <div>
            <button
              type="submit"
              className="rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
            >
              + Create Partner
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-black/10">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-black/[0.02] text-xs font-semibold uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3">Partner</th>
              <th className="px-4 py-3">Referrals</th>
              <th className="px-4 py-3">Free / Paid</th>
              <th className="px-4 py-3">Gross Revenue</th>
              <th className="px-4 py-3">Earned</th>
              <th className="px-4 py-3">Available</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {partners.map((p) => (
              <tr key={p.id} className="hover:bg-black/[0.015]">
                <td className="px-4 py-3">
                  <Link href={`/admin/referrals/${p.id}`} className="font-semibold text-findmi-700">
                    {p.label || p.business_name || "Unnamed Partner"}
                  </Link>
                  {p.label && p.business_name && <p className="text-xs text-ink/45">{p.business_name}</p>}
                </td>
                <td className="px-4 py-3 text-ink/70">{p.referralCount}</td>
                <td className="px-4 py-3 text-ink/70">
                  {p.freeReferralCount} / {p.paidReferralCount}
                </td>
                <td className="px-4 py-3 text-ink/70">{formatCurrency(p.grossReferredRevenueCents / 100)}</td>
                <td className="px-4 py-3 text-ink/70">{formatCurrency(p.earnedCommissionCents / 100)}</td>
                <td className="px-4 py-3 font-semibold text-findmi-700">
                  {formatCurrency(p.availableCommissionCents / 100)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      p.is_active
                        ? "rounded-full bg-findmi-50 px-2.5 py-1 text-xs font-semibold text-findmi-700"
                        : "rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-ink/50"
                    }
                  >
                    {p.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
              </tr>
            ))}
            {partners.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-ink/50">
                  No referral partners yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
