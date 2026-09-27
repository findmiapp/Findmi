import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { isAdminSession } from "@/lib/admin/auth";
import { isBusinessPro } from "@/lib/entitlements";
import { startBusinessProCheckout, startSubscriptionCheckout } from "@/app/(public)/account/business/actions";
import { isRecurringCheckoutConfigured } from "@/lib/commerce/subscriptionPricing";
import { PLANS, formatPlanPrice, getPlanPrice, annualSavingsPercent, type PlanDefinition } from "@/lib/commerce/plans";
import type { BillingInterval } from "@/lib/commerce/subscriptionTypes";

export const metadata: Metadata = {
  title: "Upgrade to Pro",
  robots: { index: false },
};
// Authenticated, per-user/per-business content — must never be statically
// or ISR-cached.
export const dynamic = "force-dynamic";

// Free Tier Entitlement Reset V1 — four of the six previous bullets
// ("Public contact info, Facebook & TikTok", "Enhanced photo gallery",
// "Show your full upcoming schedule", "Business announcements") named
// exactly the features this reset makes Free; naming them here now would
// be false. Rewritten to only what's still genuinely Pro-only (see
// lib/entitlements.ts / PerformanceTab.tsx) plus the two pre-existing
// lines this pass didn't touch (Priority profile review/support isn't
// part of this reset's scope, left as-is).
const CORE_BENEFITS = [
  "Performance analytics & audience insights",
  "Discovery source & QR attribution",
  "Customer inquiries",
  "Priority profile review/support",
];

const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

const subscribeButtonClass =
  "flex h-11 flex-1 items-center justify-center rounded-xl bg-findmi px-3 text-center text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

/** Recurring Billing V1 — one plan's card in the post-cutover picker
 * (Findmi Pro / Findmi Managed Pro), each with its own Monthly and Annual
 * submit buttons since this page has no client-side state for a
 * toggle — the smallest way to offer both intervals without introducing
 * a Client Component to this otherwise server-rendered page. Every
 * submit goes through startSubscriptionCheckout, which re-validates
 * plan/interval/authorization server-side regardless of what this UI
 * offers. */
function PlanCard({ plan, businessId }: { plan: PlanDefinition; businessId: string }) {
  const monthly = getPlanPrice(plan, "monthly");
  const annual = getPlanPrice(plan, "annual");
  const savings = annualSavingsPercent(plan);

  function subscribeForm(interval: BillingInterval, label: string) {
    return (
      <form key={interval} action={startSubscriptionCheckout.bind(null, businessId, plan.key, interval)} className="flex-1">
        <button type="submit" className={subscribeButtonClass}>
          {label}
        </button>
      </form>
    );
  }

  return (
    <div className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">{plan.name}</p>
      <p className="mt-1 text-sm text-ink/60">{plan.positioning}</p>

      <div className="mt-4 flex items-baseline gap-2">
        {monthly && <p className="font-display text-3xl font-bold tracking-tight text-ink">{formatPlanPrice(monthly)}</p>}
        {annual && (
          <p className="text-xs text-ink/50">
            or {formatPlanPrice(annual)}
            {savings ? ` (save ${savings}%)` : ""}
          </p>
        )}
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-ink/70">
            <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-findmi-700">
              <path d="M4 10.5l3.5 3.5L16 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {plan.explicitExclusions && plan.explicitExclusions.length > 0 && (
        <p className="mt-4 text-xs text-ink/40">Does not include: {plan.explicitExclusions.join(", ")}.</p>
      )}

      <div className="mt-5 flex gap-2">
        {monthly && subscribeForm("monthly", "Monthly")}
        {annual && subscribeForm("annual", "Annual")}
      </div>
    </div>
  );
}

/** Pro Upgrade — Internal Checkout Handoff Foundation pass. The one
 * canonical internal surface for an EXISTING claimed business's owner/
 * manager to start a Pro upgrade — every owner-facing "Upgrade to Pro" CTA
 * that already knows a specific, owned business_id routes here (see
 * account/page.tsx and account/business/[id]/page.tsx).
 *
 * This page only IDENTIFIES the upgrade (who, which business, confirms
 * Free) and hands off to native Stripe checkout via
 * startBusinessProCheckout below — it does not process payment itself and
 * does not touch businesses.plan_tier directly (that happens server-side,
 * post-payment, in the Stripe webhook — see lib/commerce/*). Remove
 * Public Tally Links pass — this JSDoc used to describe an external Tally
 * handoff; that was already stale by the time of that pass (the CTA below
 * was already native Stripe) and is corrected here.
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
  searchParams: Promise<{ business?: string; error?: string }>;
}) {
  const { business: businessId, error } = await searchParams;
  if (!businessId) redirect(errorRedirectUrl("/account", "Choose a business to upgrade first."));

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Admin Manage-As V1 — this page starts a real Stripe payment session,
    // identity-sensitive/financial (see this pass's own Step 4 rule), so it
    // deliberately stays real-user-only. The Business Manager UI already
    // hides its own "Upgrade to Pro" CTA in Admin Mode; this is only a
    // defense-in-depth backstop against direct navigation, giving a clear
    // explanation instead of a confusing bounce to /login.
    if (await isAdminSession()) {
      redirect(errorRedirectUrl(`/account/business/${businessId}`, "Exit Admin Mode to start a Pro checkout for this business."));
    }
    redirect(`/login?next=${encodeURIComponent(`/upgrade/pro?business=${businessId}`)}`);
  }

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

  const { data: business } = await admin
    .from("businesses")
    .select("id, name, plan_tier, plan_expires_at")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) redirect(errorRedirectUrl("/account", "Business not found."));

  const pro = isBusinessPro(business);
  // Business Pro Expiration Enforcement pass — plan_tier being 'pro'/
  // 'pro_seller' while `pro` (the ACTIVE entitlement) is false means this
  // is a lapsed renewal, not a first-time purchase — the copy below says
  // "Renew" instead of "Upgrade" so an expired business isn't told it's
  // starting from scratch. Uses the exact same $99 checkout flow either
  // way (startBusinessProCheckout below) — only the wording differs.
  const isExpiredPro = !pro && (business.plan_tier === "pro" || business.plan_tier === "pro_seller");
  const manageHref = `/account/business/${businessId}`;

  if (pro) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Findmi Pro</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">{business.name} is already Pro</h1>
        <p className="mt-2 text-sm text-ink/60">
          This business already has full Findmi Pro access. There&rsquo;s nothing more to upgrade.
        </p>
        <Link href={manageHref} className={`mt-6 ${primaryButtonClass}`}>
          Manage Business
        </Link>
      </div>
    );
  }

  // Recurring Billing V1 cutover — once the dedicated recurring Stripe
  // configuration actually exists (see isRecurringCheckoutConfigured),
  // this page presents the real Pro/Managed Pro subscription picker
  // instead of the legacy one-time $99 offer. Until then it falls back to
  // exactly the prior $99 UI, unchanged, so production stays commercially
  // functional with no unconfigured/broken recurring CTA ever shown to a
  // real business owner. This does not touch any EXISTING $99 Pro
  // business's entitlement — it only changes what a NEW purchase/renewal
  // on this page offers.
  const recurringConfigured = isRecurringCheckoutConfigured();

  if (recurringConfigured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Findmi Pro</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {isExpiredPro ? `Renew Findmi Pro for ${business.name}` : `Upgrade ${business.name} to Findmi Pro`}
        </h1>
        <p className="mt-2 text-sm text-ink/60">Choose a plan and billing interval to continue to secure payment.</p>

        {error && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <PlanCard plan={PLANS.pro} businessId={businessId} />
          {PLANS.managed_pro.purchasable && <PlanCard plan={PLANS.managed_pro} businessId={businessId} />}
        </div>

        <Link
          href={manageHref}
          className="mt-6 flex h-11 w-full items-center justify-center text-xs font-semibold text-ink/50 transition hover:text-ink"
        >
          Back to Manage Business
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Findmi Pro</p>
      <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        {isExpiredPro ? `Renew Findmi Pro for ${business.name}` : `Upgrade ${business.name} to Findmi Pro`}
      </h1>

      <div className="mt-6 rounded-3xl border border-findmi/20 bg-findmi-50 p-5 sm:p-6">
        <p className="font-display text-4xl font-bold tracking-tight text-ink">$99</p>
        <p className="mt-0.5 text-sm font-semibold text-ink/70">/ year</p>
        <p className="mt-3 text-xs text-ink/60">One year of Pro · One-time payment · No automatic renewal</p>
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

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {/* Native Business Onboarding Pass 3 — replaces the old Tally
          handoff with the same native, business-scoped Stripe checkout
          the "create as Pro" path uses. startBusinessProCheckout
          re-authorizes (requireBusinessMember) and re-reads plan_tier
          fresh server-side before ever creating a session. */}
      <form action={startBusinessProCheckout.bind(null, businessId)}>
        <button type="submit" className={`mt-6 ${primaryButtonClass}`}>
          Continue to secure payment
        </button>
      </form>
      <Link
        href={manageHref}
        className="mt-3 flex h-11 w-full items-center justify-center text-xs font-semibold text-ink/50 transition hover:text-ink"
      >
        Back to Manage Business
      </Link>
    </div>
  );
}
