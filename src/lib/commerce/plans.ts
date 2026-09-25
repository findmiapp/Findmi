// Canonical commercial-plan definition — Free/Pro/Managed Pro Rebuild,
// Pass 1 ("write pass 1" of the pricing rebuild — see the completed
// read-only audit for the full context this responds to).
//
// This module is the ONE source of truth for COMMERCIAL PRESENTATION —
// plan names, prices, positioning, and feature-claim copy — so a future
// price or feature-boundary change only ever means editing the objects
// below, not hunting through every page that mentions Pro.
//
// IMPORTANT — this pass is presentation/config ONLY:
//   - Stripe billing has NOT been converted to subscriptions yet. The
//     live $99/year one-time Checkout (lib/commerce/businessProCheckout.ts,
//     BUSINESS_PRO_INTRO_PRICE_CENTS) is UNCHANGED and still the only
//     real charge that exists. Nothing in this file is wired into that
//     checkout session yet, and no page's displayed PRICE changes in
//     this pass — only stale FEATURE-claim copy (e.g. "Products" listed
//     as Pro-exclusive) is corrected, since that was independently wrong
//     regardless of which price is eventually charged.
//   - Managed Pro is NOT purchasable. Nothing here creates a checkout
//     path, a route, or a live CTA for it — see `purchasable: false`
//     below, which future code should check before ever rendering a
//     "Buy Managed Pro" action.
//   - QR & Tools is listed as a Pro capability but has NOT shipped
//     (owner self-service QR — image generation + self-serve campaign
//     creation — doesn't exist yet; scan resolution/attribution/
//     reporting do). It lives in `upcomingFeatures`, never `features`,
//     so nothing importing `features` for "what Pro gets today" can
//     accidentally advertise it as available.
//
// Money is always modeled in integer cents, matching the convention
// businessProCheckout.ts already established (BUSINESS_PRO_INTRO_PRICE_CENTS).

export type PlanKey = "free" | "pro" | "managed_pro";
export type BillingInterval = "monthly" | "annual";

export interface PlanPrice {
  cents: number;
  interval: BillingInterval;
}

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  /** One line, matches the approved commercial model exactly. */
  positioning: string;
  /** Null for Free (Free has no billing interval — it's simply $0). */
  prices: PlanPrice[] | null;
  /** Capabilities this plan includes TODAY — safe to advertise as
   * currently available. Never includes anything not yet shipped. */
  features: string[];
  /** Capabilities intended for this plan but not yet shipped — must
   * always be presented as "coming soon"/future-facing, never mixed
   * into `features`, never given a live CTA. */
  upcomingFeatures?: string[];
  /** Explicit non-inclusions worth stating plainly (used by Managed
   * Pro to keep its human-service layer bounded). */
  explicitExclusions?: string[];
  /** False = do not render a checkout/purchase CTA for this plan yet,
   * anywhere. Every future call site that renders a "Buy"/"Upgrade to
   * X" action for a plan must check this first. */
  purchasable: boolean;
}

// ── FREE — $0, "Get found." ────────────────────────────────────────────
// A Free business can contribute everything FindMi's consumer discovery
// dataset needs — no feature is withheld here merely to manufacture a
// Pro paywall (see the Free/Pro Entitlement Realignment pass). This list
// intentionally never includes Products, city/state/ZIP, country,
// Locations, Events, FindMi Here/appearances, website, or Instagram as
// anything other than Free — all six are confirmed live-Free today.
export const FREE_PLAN: PlanDefinition = {
  key: "free",
  name: "Findmi Free",
  positioning: "Get found.",
  prices: null,
  features: [
    "Business profile",
    "Logo",
    "Cover image",
    "Website",
    "Instagram",
    "City, state & ZIP",
    "Country",
    "Products",
    "Locations",
    "Events",
    "FindMi Here / appearances",
    "Consumer followability",
    "Basic business management",
  ],
  purchasable: true, // "purchasable" at $0 — i.e. freely available, not gated behind payment
};

// ── PRO — $20/mo or $149/yr, "Understand and grow your discovery." ─────
export const PRO_PLAN: PlanDefinition = {
  key: "pro",
  name: "Findmi Pro",
  positioning: "Understand and grow your discovery.",
  prices: [
    { cents: 2000, interval: "monthly" },
    { cents: 14900, interval: "annual" },
  ],
  features: [
    "Analytics / Performance dashboard",
    "Audience insights",
    "Discovery-source attribution",
    "Historical / trend performance",
    "Appearance performance",
    "Product performance",
    "Customer Inquiries",
    "Enhanced Links & Contact",
    "Multi-image Gallery",
    "Vanity Findmi URL",
    "Findmi Pro badge",
  ],
  // QR & Tools is an intended Pro capability — owner self-service QR
  // (image generation + self-serve campaign creation) has not shipped.
  // Never move this into `features` until it's actually live.
  upcomingFeatures: ["QR & Tools"],
  purchasable: true,
};

// ── MANAGED PRO — $49/mo or $399/yr, "We keep FindMi updated for you." ─
// Includes every Pro software capability (see `features` below, which
// deliberately repeats PRO_PLAN.features rather than requiring every
// caller to merge two arrays) plus a bounded human-maintenance layer.
// NOT PURCHASABLE YET — see `purchasable: false`. No billing/service
// state exists for this plan; do not build a checkout path or live CTA
// against it until that exists.
export const MANAGED_PRO_PLAN: PlanDefinition = {
  key: "managed_pro",
  name: "Findmi Managed Pro",
  positioning: "We keep Findmi updated for you.",
  prices: [
    { cents: 4900, interval: "monthly" },
    { cents: 39900, interval: "annual" },
  ],
  features: [
    ...PRO_PLAN.features,
    "Profile updates",
    "Product updates",
    "Location / stockist updates",
    "Event updates",
    "Pop-up updates",
    "Appearance / FindMi Here updates",
  ],
  upcomingFeatures: ["QR & Tools"],
  explicitExclusions: [
    "Social media management",
    "PR",
    "Graphic design",
    "Event production",
    "General marketing-agency services",
    "Customer service",
    "Unlimited external research",
  ],
  purchasable: false,
};

export const PLANS: Record<PlanKey, PlanDefinition> = {
  free: FREE_PLAN,
  pro: PRO_PLAN,
  managed_pro: MANAGED_PRO_PLAN,
};

/** "$20", "$149" — whole-dollar formatting for the prices modeled here
 * (all four are whole dollars; this intentionally doesn't handle cents
 * display since nothing in this model needs it). */
export function formatPlanPriceDollars(price: PlanPrice): string {
  return `$${Math.round(price.cents / 100)}`;
}

/** "$20/month", "$149/year". */
export function formatPlanPrice(price: PlanPrice): string {
  const suffix = price.interval === "monthly" ? "/month" : "/year";
  return `${formatPlanPriceDollars(price)}${suffix}`;
}

export function getPlanPrice(plan: PlanDefinition, interval: BillingInterval): PlanPrice | null {
  return plan.prices?.find((p) => p.interval === interval) ?? null;
}

/** Annual price expressed as an effective monthly rate, for "$149/yr
 * (~$12.42/mo)"-style copy — rounds to the nearest cent, never invents
 * a round number. Returns null if the plan has no annual price. */
export function effectiveMonthlyFromAnnual(plan: PlanDefinition): number | null {
  const annual = getPlanPrice(plan, "annual");
  if (!annual) return null;
  return Math.round(annual.cents / 12);
}

/** Percentage saved by paying annually vs. 12x the monthly price,
 * rounded to the nearest whole percent. Returns null if either price is
 * missing — never divides by zero or fabricates a number. */
export function annualSavingsPercent(plan: PlanDefinition): number | null {
  const monthly = getPlanPrice(plan, "monthly");
  const annual = getPlanPrice(plan, "annual");
  if (!monthly || !annual || monthly.cents <= 0) return null;
  const monthlyEquivalent = monthly.cents * 12;
  if (annual.cents >= monthlyEquivalent) return null;
  return Math.round((1 - annual.cents / monthlyEquivalent) * 100);
}
