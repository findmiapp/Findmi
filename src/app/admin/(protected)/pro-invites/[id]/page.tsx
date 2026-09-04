import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminProInviteById, getProInviteRedemptions } from "@/lib/admin/queries";
import { formatDateShort } from "@/lib/format";
import { getPublicOrigin } from "@/lib/site-url";
import CopyButton from "@/components/admin/CopyButton";
import { setProInviteActive } from "../actions";

export const dynamic = "force-dynamic";

const copyButtonClass =
  "shrink-0 rounded-full bg-ink px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-ink/85";

export default async function AdminProInviteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invite = await getAdminProInviteById(id);
  if (!invite) notFound();

  const redemptions = await getProInviteRedemptions(id);
  const toggleActive = setProInviteActive.bind(null, invite.id, !invite.is_active);
  // Complete, production-ready shareable URL — getPublicOrigin() resolves
  // FindMi's real public origin (NEXT_PUBLIC_SITE_URL, falling back to
  // VERCEL_URL/localhost only when that isn't set — see lib/site-url.ts),
  // never a hardcoded preview host. Same helper Stripe Checkout already
  // relies on elsewhere for absolute URLs.
  const joinUrl = `${getPublicOrigin()}/join?invite=${invite.code}`;

  return (
    <div>
      <Link href="/admin/pro-invites" className="text-sm text-findmi-700">
        ← Pro Invites
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            <span className="font-mono">{invite.code}</span>
          </h1>
          <p className="mt-1 text-sm text-ink/60">{invite.name ?? "No campaign name set."}</p>
        </div>
        <form action={toggleActive}>
          <button
            type="submit"
            className={
              invite.is_active
                ? "rounded-full border border-black/15 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:bg-black/5"
                : "rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
            }
          >
            {invite.is_active ? "Deactivate" : "Activate"}
          </button>
        </form>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-black/10 p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Plan</dt>
          <dd className="mt-1 text-ink">Pro</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Duration</dt>
          <dd className="mt-1 text-ink">{invite.duration_days} days</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Redemptions</dt>
          <dd className="mt-1 text-ink">
            {invite.redemption_count}
            {invite.max_redemptions ? ` / ${invite.max_redemptions}` : " / unlimited"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Expires</dt>
          <dd className="mt-1 text-ink">{invite.expires_at ? formatDateShort(invite.expires_at) : "Never"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Status</dt>
          <dd className="mt-1 text-ink">{invite.is_active ? "Active" : "Inactive"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Created</dt>
          <dd className="mt-1 text-ink">{formatDateShort(invite.created_at)}</dd>
        </div>
        {invite.created_by_note && (
          <div className="col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Note</dt>
            <dd className="mt-1 text-ink">{invite.created_by_note}</dd>
          </div>
        )}
      </dl>

      <div className="mt-6 rounded-2xl border border-findmi/30 bg-findmi-50 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Invite Link</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 break-all font-mono text-xs text-ink/70">{joinUrl}</p>
          <CopyButton value={joinUrl} label="Copy Link" className={copyButtonClass} />
        </div>

        <p className="mt-4 text-xs font-bold uppercase tracking-wide text-findmi-700">Invite Code</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="font-mono text-sm font-semibold text-ink">{invite.code}</p>
          <CopyButton value={invite.code} label="Copy Code" className={copyButtonClass} />
        </div>
      </div>

      <h2 className="mt-8 font-display text-lg font-semibold tracking-tight text-ink">Redemption History</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-black/10">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-black/[0.02] text-xs font-semibold uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Redeemed</th>
              <th className="px-4 py-3">Previous Tier</th>
              <th className="px-4 py-3">Granted Until</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {redemptions.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 text-ink">{r.business_name ?? r.business_id}</td>
                <td className="px-4 py-3 text-ink/70">{formatDateShort(r.redeemed_at)}</td>
                <td className="px-4 py-3 text-ink/70">{r.previous_plan_tier ?? "free"}</td>
                <td className="px-4 py-3 text-ink/70">{formatDateShort(r.granted_until)}</td>
              </tr>
            ))}
            {redemptions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-ink/50">
                  Not redeemed yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
