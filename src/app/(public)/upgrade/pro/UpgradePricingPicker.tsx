"use client";

import { useState } from "react";
import { startSubscriptionCheckout } from "@/app/(public)/account/business/actions";
import {
  PLANS,
  formatPlanPriceDollars,
  getPlanPrice,
  effectiveMonthlyFromAnnual,
  annualSavingsPercent,
  type PlanDefinition,
} from "@/lib/commerce/plans";
import type { BillingInterval } from "@/lib/commerce/subscriptionTypes";

// Pricing UX Cleanup pass — replaces the prior "one card, two buttons"
// layout (separate Monthly/Annual submit buttons on each plan card) with
// ONE shared billing-interval toggle above both cards, so interval reads
// as one shared pricing STATE rather than four competing CTAs. `interval`
// is plain client-side UI state — it only decides which price/CTA-args
// this component renders. The actual purchase still goes through the
// exact same existing startSubscriptionCheckout Server Action, invoked
// with whichever plan/interval is currently selected at submit time via
// a plain <form action={...}> bind — no new server logic, no new
// validation, nothing about the checkout path itself changed.

const ctaButtonClass =
  "flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

const MANAGED_PRO_EXTRA_FEATURES = [
  "Profile updates",
  "Product updates",
  "Location & stockist updates",
  "Event & pop-up updates",
  "Appearance / Findmi Here updates",
];

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-findmi-700">
      <path d="M4 10.5l3.5 3.5L16 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IntervalToggle({ interval, onChange, savingsPercent }: { interval: BillingInterval; onChange: (i: BillingInterval) => void; savingsPercent: number }) {
  return (
    <div className="flex justify-center">
      <div className="flex w-full max-w-xs rounded-full border border-black/10 bg-mist/50 p-1" role="tablist" aria-label="Billing interval">
        <button
          type="button"
          role="tab"
          aria-selected={interval === "monthly"}
          onClick={() => onChange("monthly")}
          className={`flex-1 rounded-full py-2 text-xs font-bold uppercase tracking-wide transition ${
            interval === "monthly" ? "bg-findmi text-white shadow-sm" : "text-ink/50 hover:text-ink/70"
          }`}
        >
          Monthly
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={interval === "annual"}
          onClick={() => onChange("annual")}
          className={`flex-1 rounded-full py-2 text-xs font-bold uppercase tracking-wide transition ${
            interval === "annual" ? "bg-findmi text-white shadow-sm" : "text-ink/50 hover:text-ink/70"
          }`}
        >
          Annual · Save up to {savingsPercent}%
        </button>
      </div>
    </div>
  );
}

function PriceDisplay({ plan, interval }: { plan: PlanDefinition; interval: BillingInterval }) {
  const price = getPlanPrice(plan, interval);
  if (!price) return null;
  const suffix = interval === "monthly" ? "/month" : "/year";
  const effectiveMonthlyCents = interval === "annual" ? effectiveMonthlyFromAnnual(plan) : null;
  return (
    <div className="mt-3">
      <p className="flex items-baseline gap-1">
        <span className="font-display text-3xl font-bold tracking-tight text-ink">{formatPlanPriceDollars(price)}</span>
        <span className="text-sm font-medium text-ink/45">{suffix}</span>
      </p>
      {effectiveMonthlyCents !== null && (
        <p className="mt-0.5 text-xs text-ink/45">Equivalent to {formatCents(effectiveMonthlyCents)}/month</p>
      )}
    </div>
  );
}

function ProPlanCard({ plan, interval, businessId }: { plan: PlanDefinition; interval: BillingInterval; businessId: string }) {
  return (
    <div className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">{plan.name}</p>
      <p className="mt-1 text-sm text-ink/60">{plan.positioning}</p>

      <PriceDisplay plan={plan} interval={interval} />

      <ul className="mt-4 flex flex-col gap-2">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-ink/70">
            <CheckGlyph />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <form action={startSubscriptionCheckout.bind(null, businessId, plan.key, interval)} className="mt-5">
        <button type="submit" className={ctaButtonClass}>
          Choose Pro
        </button>
      </form>
    </div>
  );
}

/** Pricing UX Cleanup pass — deliberately does NOT map over
 * `plan.features` (which, per lib/commerce/plans.ts, spreads the FULL
 * Pro feature list plus Managed Pro's own extras — correct as the
 * canonical "everything this plan includes" definition, but too long for
 * a compact card next to Pro's own full list). This card instead states
 * "Everything in Pro, plus:" once and lists only the Managed-Pro-specific
 * extras, kept local to this display component rather than changing
 * plans.ts's own feature list (which stays the accurate full-enumeration
 * source of truth for any other future consumer). */
function ManagedProPlanCard({ plan, interval, businessId }: { plan: PlanDefinition; interval: BillingInterval; businessId: string }) {
  return (
    <div className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">{plan.name}</p>
      <p className="mt-1 text-sm text-ink/60">{plan.positioning}</p>

      <PriceDisplay plan={plan} interval={interval} />

      <p className="mt-4 text-xs font-semibold text-ink/60">Everything in Pro, plus:</p>
      <ul className="mt-2 flex flex-col gap-2">
        {MANAGED_PRO_EXTRA_FEATURES.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-ink/70">
            <CheckGlyph />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {plan.explicitExclusions && plan.explicitExclusions.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-ink/40">Does not include: {plan.explicitExclusions.join(", ")}.</p>
      )}

      <form action={startSubscriptionCheckout.bind(null, businessId, plan.key, interval)} className="mt-5">
        <button type="submit" className={ctaButtonClass}>
          Choose Managed Pro
        </button>
      </form>
    </div>
  );
}

export default function UpgradePricingPicker({ businessId }: { businessId: string }) {
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");
  const savingsPercent = Math.max(annualSavingsPercent(PLANS.pro) ?? 0, annualSavingsPercent(PLANS.managed_pro) ?? 0);

  return (
    <div>
      <IntervalToggle interval={billingInterval} onChange={setBillingInterval} savingsPercent={savingsPercent} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <ProPlanCard plan={PLANS.pro} interval={billingInterval} businessId={businessId} />
        {PLANS.managed_pro.purchasable && (
          <ManagedProPlanCard plan={PLANS.managed_pro} interval={billingInterval} businessId={businessId} />
        )}
      </div>
    </div>
  );
}
