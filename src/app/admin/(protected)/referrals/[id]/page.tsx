import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckboxField, NumberField, TextField } from "@/components/admin/Fields";
import { getAdminReferralPartnerDetail } from "@/lib/admin/referral-queries";
import { formatCurrency, formatDateShort } from "@/lib/format";
import { getPublicOrigin } from "@/lib/site-url";
import CopyButton from "@/components/admin/CopyButton";
import {
  approveReferralPayout,
  cancelReferralPayout,
  correctReferralAttribution,
  createReferralCode,
  markReferralPayoutPaid,
  rejectReferralPayout,
  setReferralCodeActive,
  updateReferralPartner,
} from "../actions";

export const dynamic = "force-dynamic";

const copyButtonClass =
  "shrink-0 rounded-full border border-black/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink/70 transition hover:bg-black/5";

function cents(n: number | null | undefined): string {
  return formatCurrency((n ?? 0) / 100);
}

export default async function AdminReferralPartnerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const detail = await getAdminReferralPartnerDetail(id);
  if (!detail) notFound();

  const { partner, codes, attributions, earnings, payoutRequests } = detail;
  const origin = getPublicOrigin();
  const updateAction = updateReferralPartner.bind(null, id);
  const createCodeAction = createReferralCode.bind(null, id);

  return (
    <div>
      <Link href="/admin/referrals" className="text-sm text-findmi-700">
        ← Referral Partners
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            {partner.label || partner.business_name || "Unnamed Partner"}
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            Business:{" "}
            <Link href={`/admin/businesses/${partner.business_id}`} className="font-semibold text-findmi-700 hover:underline">
              {partner.business_name ?? partner.business_id}
            </Link>
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}

      {/* Summary — compact, operational numbers only. */}
      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-black/10 p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Referrals</dt>
          <dd className="mt-1 text-ink">{partner.referralCount}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Free / Paid</dt>
          <dd className="mt-1 text-ink">
            {partner.freeReferralCount} / {partner.paidReferralCount}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Gross Referred Revenue</dt>
          <dd className="mt-1 text-ink">{cents(partner.grossReferredRevenueCents)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Earned Commission</dt>
          <dd className="mt-1 text-ink">{cents(partner.earnedCommissionCents)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Paid Commission</dt>
          <dd className="mt-1 text-ink">{cents(partner.paidCommissionCents)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Available</dt>
          <dd className="mt-1 font-semibold text-findmi-700">{cents(partner.availableCommissionCents)}</dd>
        </div>
      </dl>

      {/* Partner settings — label/commission/notes/active. */}
      <div className="mt-6 rounded-2xl border border-black/10 p-4">
        <p className="text-sm font-semibold text-ink">Partner Settings</p>
        <form action={updateAction} className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label="Display Label" name="label" defaultValue={partner.label} />
            <NumberField
              label="Default Commission ($)"
              name="default_commission_dollars"
              defaultValue={partner.default_commission_cents / 100}
              step="0.01"
              hint="Applies to future qualifying conversions only — never rewrites an earning already recorded."
            />
          </div>
          <TextField label="Internal Notes" name="notes" defaultValue={partner.notes} />
          <CheckboxField label="Active" name="is_active" defaultChecked={partner.is_active} />
          <div>
            <button
              type="submit"
              className="rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
            >
              Save Partner Settings
            </button>
          </div>
        </form>
      </div>

      {/* Referral codes. */}
      <h2 className="mt-8 font-display text-lg font-semibold tracking-tight text-ink">Referral Codes</h2>
      <div className="mt-3 rounded-2xl border border-dashed border-black/15 bg-black/[0.015] p-4">
        <p className="text-sm font-semibold text-ink">Create Code</p>
        <form action={createCodeAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Code" name="code" required placeholder="e.g. STEREOTYPE20" />
          <NumberField label="Discount Percent" name="discount_percent" defaultValue={20} step="0.01" />
          <NumberField label="Max Uses (optional)" name="max_uses" hint="Blank = unlimited" />
          <TextField label="Expires (optional)" name="expires_at" type="date" />
          <CheckboxField label="Active" name="is_active" defaultChecked />
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
            >
              + Create Code
            </button>
          </div>
        </form>
      </div>

      <div className="mt-3 overflow-x-auto rounded-2xl border border-black/10">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-black/[0.02] text-xs font-semibold uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Uses</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Share</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {codes.map((c) => {
              const joinUrl = `${origin}/join?ref=${c.code}`;
              const toggleAction = setReferralCodeActive.bind(null, id, c.id, !c.is_active);
              return (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-mono font-semibold text-ink">{c.code}</td>
                  <td className="px-4 py-3 text-ink/70">{c.discount_percent}%</td>
                  <td className="px-4 py-3 text-ink/70">
                    {c.use_count}
                    {c.max_uses ? ` / ${c.max_uses}` : " / ∞"}
                  </td>
                  <td className="px-4 py-3 text-ink/70">{c.expires_at ? formatDateShort(c.expires_at) : "Never"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        c.is_active
                          ? "rounded-full bg-findmi-50 px-2.5 py-1 text-xs font-semibold text-findmi-700"
                          : "rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-ink/50"
                      }
                    >
                      {c.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <CopyButton value={joinUrl} label="Copy Link" className="text-[11px] font-bold uppercase tracking-wide text-ink/50 hover:text-ink" />
                  </td>
                  <td className="px-4 py-3">
                    <form action={toggleAction}>
                      <button type="submit" className="text-xs font-semibold text-ink/60 hover:underline">
                        {c.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {codes.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-ink/50">
                  No codes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Referred businesses. */}
      <h2 className="mt-8 font-display text-lg font-semibold tracking-tight text-ink">Referred Businesses</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-black/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-black/[0.02] text-xs font-semibold uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Referred</th>
              <th className="px-4 py-3">Initial Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Converted</th>
              <th className="px-4 py-3">Correction</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {attributions.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-3 text-ink">
                  <Link href={`/admin/businesses/${a.business_id}`} className="font-semibold text-findmi-700 hover:underline">
                    {a.business_name ?? a.business_id}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink/70">{formatDateShort(a.referred_at)}</td>
                <td className="px-4 py-3 text-ink/70">{a.initial_plan_selected ?? "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      a.status === "qualified"
                        ? "rounded-full bg-findmi-50 px-2.5 py-1 text-xs font-semibold text-findmi-700"
                        : "rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-ink/50"
                    }
                  >
                    {a.status === "qualified" ? "Paid Pro" : "Unqualified"}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink/70">
                  {a.converted_to_pro_at ? formatDateShort(a.converted_to_pro_at) : "—"}
                </td>
                <td className="px-4 py-3">
                  {/* Admin-only correction mechanism — the ONLY way a
                      referred business's referral_partner_id/
                      referral_code_id can ever change after attribution.
                      Never reachable from any owner-facing surface.
                      Re-points attribution at whichever partner owns the
                      typed code (looked up server-side in
                      correctReferralAttribution, never trusted from this
                      form beyond the code string itself) — never touches
                      status/converted_to_pro_at/amounts or any existing
                      earning row, so it can never rewrite history already
                      paid out. */}
                  <details className="group">
                    <summary className="cursor-pointer text-xs font-semibold text-ink/50 underline underline-offset-2 [&::-webkit-details-marker]:hidden">
                      Correct
                    </summary>
                    <form action={correctReferralAttribution.bind(null, a.id)} className="mt-2 flex flex-wrap items-center gap-1.5">
                      <input type="hidden" name="return_to" value={`/admin/referrals/${id}`} />
                      <input
                        type="text"
                        name="code"
                        placeholder="Correct code"
                        className="w-32 rounded-lg border border-black/10 px-2 py-1 text-xs text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                      />
                      <button type="submit" className="text-xs font-semibold text-findmi-700 hover:underline">
                        Apply
                      </button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
            {attributions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-ink/50">
                  No referred businesses yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Earnings ledger. */}
      <h2 className="mt-8 font-display text-lg font-semibold tracking-tight text-ink">Earnings Ledger</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-black/10">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-black/[0.02] text-xs font-semibold uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Gross</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Commission</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Earned</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {earnings.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-3 text-ink">{e.business_name ?? e.business_id}</td>
                <td className="px-4 py-3 text-ink/70">{cents(e.gross_amount_cents)}</td>
                <td className="px-4 py-3 text-ink/70">{cents(e.discount_amount_cents)}</td>
                <td className="px-4 py-3 font-semibold text-ink">{cents(e.commission_amount_cents)}</td>
                <td className="px-4 py-3 text-ink/70">{e.status}</td>
                <td className="px-4 py-3 text-ink/70">{formatDateShort(e.earned_at)}</td>
              </tr>
            ))}
            {earnings.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-ink/50">
                  No earnings yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Payout requests. */}
      <h2 className="mt-8 font-display text-lg font-semibold tracking-tight text-ink">Payout Requests</h2>
      <div className="mt-3 flex flex-col gap-3">
        {payoutRequests.map((r) => (
          <div key={r.id} className="rounded-2xl border border-black/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">{cents(r.requested_amount_cents)}</p>
              <span
                className={
                  r.status === "paid"
                    ? "rounded-full bg-findmi-50 px-2.5 py-1 text-xs font-semibold text-findmi-700"
                    : r.status === "rejected" || r.status === "cancelled"
                      ? "rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700"
                      : "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
                }
              >
                {r.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink/45">
              Requested {formatDateShort(r.created_at)}
              {r.processed_at ? ` · Processed ${formatDateShort(r.processed_at)}` : ""}
            </p>
            {r.payment_reference && <p className="mt-1 text-xs text-ink/60">Reference: {r.payment_reference}</p>}
            {r.admin_note && <p className="mt-1 text-xs text-ink/60">Note: {r.admin_note}</p>}

            {(r.status === "requested" || r.status === "approved") && (
              <div className="mt-3 flex flex-col gap-2 border-t border-black/10 pt-3 sm:flex-row sm:items-start">
                {r.status === "requested" && (
                  <form action={approveReferralPayout.bind(null, id, r.id)}>
                    <button type="submit" className="text-xs font-semibold text-findmi-700 hover:underline">
                      Approve
                    </button>
                  </form>
                )}
                <form action={markReferralPayoutPaid.bind(null, id, r.id)} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    name="payment_reference"
                    placeholder="Payment reference (e.g. Venmo #, check #)"
                    className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                  />
                  <input
                    type="text"
                    name="admin_note"
                    placeholder="Note (optional)"
                    className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                  />
                  <button type="submit" className="rounded-full bg-findmi px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600">
                    Mark Paid
                  </button>
                </form>
                <form action={rejectReferralPayout.bind(null, id, r.id)} className="flex items-center gap-2">
                  <input
                    type="text"
                    name="admin_note"
                    placeholder="Reason (optional)"
                    className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                  />
                  <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
                    Reject
                  </button>
                </form>
                <form action={cancelReferralPayout.bind(null, id, r.id)}>
                  <button type="submit" className="text-xs font-semibold text-ink/50 hover:underline">
                    Cancel
                  </button>
                </form>
              </div>
            )}
          </div>
        ))}
        {payoutRequests.length === 0 && <p className="text-sm text-ink/50">No payout requests yet.</p>}
      </div>
    </div>
  );
}
