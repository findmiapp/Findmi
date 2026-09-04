import Link from "next/link";
import { getAdminProInvites } from "@/lib/admin/queries";
import { formatDateShort } from "@/lib/format";
import { getPublicOrigin } from "@/lib/site-url";
import CopyButton from "@/components/admin/CopyButton";
import { createProInvite } from "./actions";

// Pro Invite Sharing UX pass — compact, text-only (no border/pill) so the
// list's own Copy Link/Copy Code stay unobtrusive next to the existing
// Code -> View/Manage link, per this pass's own "do not clutter" note.
const listCopyButtonClass = "py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink/50 transition hover:text-ink";

export const dynamic = "force-dynamic";

/** Complimentary FindMi Pro access codes — grants Pro to ONE specific
 * business at redemption time, entirely independent of publication/
 * moderation (see redeem_pro_invite() in the pro_invites migration).
 * Deliberately small: no referral payouts, no Stripe coupons, no
 * affiliate logic — see this pass's own "DO NOT BUILD" list. */
export default async function AdminProInvitesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const invites = await getAdminProInvites();
  const origin = getPublicOrigin();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Pro Invites</h1>
      <p className="mt-1 text-sm text-ink/60">
        Codes that grant complimentary FindMi Pro to one business — no Stripe payment required. Redeeming a
        code never publishes a business or changes its review status; those stay completely independent.
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
        <p className="text-sm font-semibold text-ink">Create Invite</p>
        <form action={createProInvite} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/60">
            Campaign / Name
            <input
              name="name"
              type="text"
              placeholder="e.g. Launch Partners"
              className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/60">
            Code
            <input
              name="code"
              type="text"
              required
              placeholder="e.g. LAUNCH2026"
              className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/60">
            Pro Duration (days)
            <input
              name="duration_days"
              type="number"
              min={1}
              defaultValue={365}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/60">
            Maximum Redemptions
            <input
              name="max_redemptions"
              type="number"
              min={1}
              defaultValue={1}
              placeholder="Blank = unlimited"
              className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/60">
            Expiration (optional)
            <input
              name="expires_at"
              type="datetime-local"
              className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/60">
            Internal Note (optional)
            <input
              name="created_by_note"
              type="text"
              placeholder="e.g. Sarah — launch partners"
              className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
            <input name="is_active" type="checkbox" defaultChecked className="h-4 w-4 rounded border-black/20" />
            Active
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
            >
              + Create Invite
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-black/10">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-black/[0.02] text-xs font-semibold uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Redemptions</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {invites.map((invite) => (
              <tr key={invite.id} className="hover:bg-black/[0.015]">
                <td className="px-4 py-3">
                  <Link href={`/admin/pro-invites/${invite.id}`} className="font-mono font-semibold text-findmi-700">
                    {invite.code}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink/70">{invite.name ?? "—"}</td>
                <td className="px-4 py-3 text-ink/70">{invite.duration_days} days</td>
                <td className="px-4 py-3 text-ink/70">
                  {invite.redemption_count}
                  {invite.max_redemptions ? ` / ${invite.max_redemptions}` : " / ∞"}
                </td>
                <td className="px-4 py-3 text-ink/70">
                  {invite.expires_at ? formatDateShort(invite.expires_at) : "Never"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      invite.is_active
                        ? "rounded-full bg-findmi-50 px-2.5 py-1 text-xs font-semibold text-findmi-700"
                        : "rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-ink/50"
                    }
                  >
                    {invite.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <CopyButton
                      value={`${origin}/join?invite=${invite.code}`}
                      label="Copy Link"
                      className={listCopyButtonClass}
                    />
                    <span className="text-ink/20">·</span>
                    <CopyButton value={invite.code} label="Copy Code" className={listCopyButtonClass} />
                  </div>
                </td>
              </tr>
            ))}
            {invites.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-ink/50">
                  No invites yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
