import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { isBusinessPro } from "@/lib/entitlements";
import { JOIN_FORM_URL_DEFAULT } from "@/lib/join-page";

export const metadata: Metadata = {
  title: "Upgrade to Pro",
  robots: { index: false },
};
// Authenticated, per-user/per-business content — must never be statically
// or ISR-cached.
export const dynamic = "force-dynamic";

const CORE_BENEFITS = [
  "Full About section",
  "Website, contact & social links",
  "Enhanced photo gallery",
  "Manage FindMi Here appearances",
  "Add your own pop-ups & appearances",
  "Connect to existing FindMi events",
  "Business announcements",
  "Priority profile review/support",
];

const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

/** Pro Upgrade — Internal Checkout Handoff Foundation pass. The one
 * canonical internal surface for an EXISTING claimed business's owner/
 * manager to start a Pro upgrade — every owner-facing "Upgrade to Pro" CTA
 * that already knows a specific, owned business_id routes here instead of
 * straight to the external Tally form (see account/page.tsx and
 * account/business/[id]/page.tsx).
 *
 * This page only IDENTIFIES the upgrade (who, which business, confirms
 * Free) and hands off to the existing external Tally form — it does not
 * process payment and does not touch businesses.plan_tier. See this
 * pass's report for exactly which Tally hidden fields would need to be
 * configured before a business_id could safely be appended to that
 * handoff link; none are appended today because none are demonstrably
 * configured (see the CTA below).
 *
 * Deliberately NOT reachable for a still-pending claimant: this page
 * requires a REAL business_members row (requireBusinessMember), the same
 * gate every other /account/business/* action already uses — a pending,
 * unapproved claim has no such row, so a claimant can never reach this
 * page for a business they don't yet own. Paying (wherever that
 * eventually happens) can never imply or expedite approval as a result. */
export default async function UpgradeToProPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const { business: businessId } = await searchParams;
  if (!businessId) redirect(errorRedirectUrl("/account", "Choose a business to upgrade first."));

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/upgrade/pro?business=${businessId}`)}`);

  // Real, session-scoped authorization — never trusts the business
  // identity from the URL/client beyond the id itself. Same
  // requireBusinessMember() foundation the business editor page and its
  // Server Actions already use.
  try {
    await requireBusinessMember(businessId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to that business.";
    redirect(errorRedirectUrl("/account", message));
  }

  // Only reachable AFTER authorization succeeds above — plan_tier isn't in
  // the public column grant, so it's read via service-role here, same
  // authorize-then-elevate shape account/business/[id]/page.tsx already
  // uses.
  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl("/account", "Server isn't configured."));

  const { data: business } = await admin.from("businesses").select("id, name, plan_tier").eq("id", businessId).maybeSingle();
  if (!business) redirect(errorRedirectUrl("/account", "Business not found."));

  const pro = isBusinessPro(business);
  const manageHref = `/account/business/${businessId}`;

  if (pro) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">FindMi Pro</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">{business.name} is already Pro</h1>
        <p className="mt-2 text-sm text-ink/60">
          This business already has full FindMi Pro access — there&rsquo;s nothing more to upgrade.
        </p>
        <Link href={manageHref} className={`mt-6 ${primaryButtonClass}`}>
          Manage Business
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">FindMi Pro</p>
      <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        Upgrade {business.name} to FindMi Pro
      </h1>

      <div className="mt-6 rounded-3xl border border-findmi/20 bg-findmi-50 p-5 sm:p-6">
        <p className="font-display text-4xl font-bold tracking-tight text-ink">$20</p>
        <p className="mt-0.5 text-sm font-semibold text-ink/70">First 90 days</p>
        <p className="mt-3 text-xs text-ink/60">No automatic renewal during the introductory period.</p>
      </div>

      <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/40">What&rsquo;s included</p>
        <ul className="mt-3 flex flex-col gap-2.5">
          {CORE_BENEFITS.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2.5 text-sm text-ink/70">
              <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-findmi-700">
                <path
                  d="M4 10.5l3.5 3.5L16 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{benefit}</span>
            </li>
          ))}
        </ul>
      </div>

      <a href={JOIN_FORM_URL_DEFAULT} target="_blank" rel="noreferrer" className={`mt-6 ${primaryButtonClass}`}>
        Continue to secure payment
      </a>
      <Link
        href={manageHref}
        className="mt-3 flex h-11 w-full items-center justify-center text-xs font-semibold text-ink/50 transition hover:text-ink"
      >
        Back to Manage Business
      </Link>
    </div>
  );
}
