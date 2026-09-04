import type { Metadata } from "next";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { formatDateShort } from "@/lib/format";
import { redeemProInvite } from "../actions";

export const metadata: Metadata = {
  title: "Redeem Invite",
  robots: { index: false },
};
// Authenticated, per-user content (and always freshly checks invite
// validity/redemption state) — never statically or ISR-cached, same
// convention every other /account/* page uses.
export const dynamic = "force-dynamic";

interface OwnedBusiness {
  id: string;
  name: string;
}

/**
 * Pro Invite / Complimentary Access Codes — the vendor-facing redemption
 * flow for findmi.app/join?invite=CODE (which redirects straight here).
 *
 * LOCKED RULE: this page and its Server Action never publish a business,
 * never change publication_status, never approve products/marketplace
 * distribution. It only ever leads to redeem_pro_invite() (see the
 * pro_invites migration), which writes exclusively to
 * plan_tier/plan_source/plan_started_at/plan_expires_at/
 * plan_payment_reference plus its own ledger table.
 *
 * Invite validity is looked up here with the service-role client
 * (pro_invites has zero RLS policies — this is the same "trusted
 * server-only code doing a legitimate non-admin-session read" pattern
 * commerce checkout/webhooks already use, not an admin-session bypass).
 * This lookup is display-only — the actual enforcement (active/expired/
 * limit/already-redeemed/authorized-business) happens again, atomically,
 * inside redeem_pro_invite() itself when the form is submitted.
 */
export default async function RedeemInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{
    business?: string;
    error?: string;
    success?: string;
    business_id?: string;
    business_name?: string;
    granted_until?: string;
  }>;
}) {
  const { code } = await params;
  const { business: businessHint, error, success, business_id, business_name, granted_until } = await searchParams;

  const redeemPath = `/redeem/${encodeURIComponent(code)}`;
  const admin = getAdminSupabase();

  const { data: invite } = admin
    ? await admin.from("pro_invites").select("*").ilike("code", code).maybeSingle()
    : { data: null };

  const now = new Date();
  const inviteValid =
    !!invite &&
    invite.is_active &&
    (!invite.expires_at || new Date(invite.expires_at) > now) &&
    (invite.max_redemptions === null || invite.redemption_count < invite.max_redemptions);

  // ── Success screen — post-redemption, own dedicated state ─────────────
  if (success && business_id && business_name && granted_until) {
    const sessionSupabase = await getServerSupabase();
    const { data: business } = await sessionSupabase
      .from("businesses")
      .select("publication_status")
      .eq("id", business_id)
      .maybeSingle();
    const pendingReview = business?.publication_status === "pending_review";

    return (
      <div className="mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
        <div className="rounded-3xl border border-findmi/30 bg-findmi-50 p-6 text-center sm:p-8">
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">FindMi Pro Activated</p>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {business_name} now has Pro access
          </h1>
          <p className="mt-2 text-sm text-ink/70">Pro access runs through {formatDateShort(granted_until)}.</p>

          {/* Never implies the public listing itself has been approved —
              publication/moderation state is shown separately, honestly,
              and only when it's actually still pending. */}
          {pendingReview && (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This business is still pending review before it appears publicly on FindMi — Pro access doesn&rsquo;t
              change that, and FindMi will review it separately.
            </p>
          )}

          <Link
            href={`/account/business/${business_id}`}
            className="mt-6 flex h-12 items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Manage Business
          </Link>
        </div>
      </div>
    );
  }

  if (!inviteValid) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
        <div className="rounded-3xl border border-black/10 bg-white p-6 text-center sm:p-8">
          <h1 className="font-display text-xl font-bold tracking-tight text-ink">This invite isn&rsquo;t valid</h1>
          <p className="mt-2 text-sm text-ink/60">
            This code may have expired, been deactivated, or already been fully redeemed. Contact FindMi if you
            believe this is a mistake.
          </p>
          <Link
            href="/join"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full border border-black/10 px-5 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/20"
          >
            Back to Join FindMi
          </Link>
        </div>
      </div>
    );
  }

  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();

  // Preserve the invite through logged-out signup/login — the invite
  // lives in the PATH here (not a query param), so getSafeRedirect just
  // round-trips this whole page unchanged once the visitor signs in.
  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
        <div className="rounded-3xl border border-findmi/30 bg-findmi-50 p-6 text-center sm:p-8">
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Complimentary FindMi Pro</p>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink">
            {invite.name || "You've been invited to FindMi Pro"}
          </h1>
          <p className="mt-2 text-sm text-ink/70">
            Sign in or create a FindMi account to apply this to your business.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href={`/signup?next=${encodeURIComponent(redeemPath)}`}
              className="flex h-12 flex-1 items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
            >
              Create Account
            </Link>
            <Link
              href={`/login?next=${encodeURIComponent(redeemPath)}`}
              className="flex h-12 flex-1 items-center justify-center rounded-full border border-black/10 text-sm font-bold uppercase tracking-wide text-ink transition hover:border-black/20"
            >
              Log In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Businesses this signed-in user actually owns/manages — RLS already
  // scopes business_members' SELECT to auth.uid() = user_id, same
  // pattern account/page.tsx already uses, no service-role needed.
  const { data: membershipRows } = await sessionSupabase
    .from("business_members")
    .select("business_id, businesses(id, name)")
    .eq("user_id", user.id);
  type MembershipRow = { business_id: string; businesses: { id: string; name: string } | { id: string; name: string }[] | null };
  const ownedBusinesses: OwnedBusiness[] = ((membershipRows ?? []) as MembershipRow[])
    .map((m) => {
      const b = Array.isArray(m.businesses) ? m.businesses[0] : m.businesses;
      return b ? { id: b.id, name: b.name } : null;
    })
    .filter((b): b is OwnedBusiness => Boolean(b));

  // No owned businesses yet — offer the native Add Business flow with the
  // invite preserved, so it can be applied to the business right after
  // it's created (see account/business/new/page.tsx + createMemberBusiness).
  if (ownedBusinesses.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
        <div className="rounded-3xl border border-findmi/30 bg-findmi-50 p-6 text-center sm:p-8">
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Complimentary FindMi Pro</p>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink">
            {invite.name || "You've been invited to FindMi Pro"}
          </h1>
          <p className="mt-2 text-sm text-ink/70">
            You don&rsquo;t have a business on FindMi yet. Add one — it&rsquo;s free — and you can apply this invite
            right after.
          </p>
          <Link
            href={`/account/business/new?invite=${encodeURIComponent(code)}`}
            className="mt-6 flex h-12 items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Add Your Business
          </Link>
        </div>
      </div>
    );
  }

  // A business hint (from just-created-via-invite, or a future direct
  // link) is only ever honored if it's actually in this user's OWN owned
  // list above — never trusted on its own.
  const hinted = businessHint ? ownedBusinesses.find((b) => b.id === businessHint) : undefined;
  const singleTarget = hinted ?? (ownedBusinesses.length === 1 ? ownedBusinesses[0] : undefined);

  const redeemAction = redeemProInvite.bind(null, code);

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
      <div className="rounded-3xl border border-findmi/30 bg-findmi-50 p-6 sm:p-8">
        <p className="text-center text-xs font-bold uppercase tracking-wide text-findmi-700">Complimentary FindMi Pro</p>
        <h1 className="mt-2 text-center font-display text-2xl font-bold tracking-tight text-ink">
          {invite.name || "You've been invited to FindMi Pro"}
        </h1>
        <p className="mt-2 text-center text-sm text-ink/70">
          {invite.duration_days} days of FindMi Pro, no payment required.
        </p>

        {error && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700">
            {error}
          </p>
        )}

        <form action={redeemAction} className="mt-6">
          {singleTarget ? (
            <>
              <input type="hidden" name="business_id" value={singleTarget.id} />
              <button
                type="submit"
                className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              >
                Apply Pro to {singleTarget.name}
              </button>
            </>
          ) : (
            <>
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink/50">Apply to which business?</p>
              <div className="flex flex-col gap-2">
                {ownedBusinesses.map((b, i) => (
                  <label
                    key={b.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-2xl border border-black/10 bg-white px-4 py-3 transition has-[:checked]:border-findmi has-[:checked]:ring-1 has-[:checked]:ring-findmi/40"
                  >
                    <input type="radio" name="business_id" value={b.id} defaultChecked={i === 0} className="h-4 w-4 accent-findmi" />
                    <span className="text-sm font-semibold text-ink">{b.name}</span>
                  </label>
                ))}
              </div>
              <button
                type="submit"
                className="mt-4 flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              >
                Apply Pro
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
