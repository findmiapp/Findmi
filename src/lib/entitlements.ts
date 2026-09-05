import type { Business, PlanTier } from "./types";

/**
 * Business Plan Entitlement — the one shared resolver every Pro-gated
 * feature should call instead of re-reading business.plan_tier directly,
 * so the actual "what counts as Pro" rule lives in exactly one place.
 * Wired into the Free/Pro member editor allowlist (account/business/
 * actions.ts), /upgrade/pro, and admin's BusinessForm.
 *
 * Deliberately BUSINESS-level, not user-level: a business's plan is a
 * property of the business itself, entirely independent of which role
 * (owner/manager/staff — business_members.role) the current viewer holds
 * on it. Never gate on plan by checking a user's role, and never gate a
 * role check by plan — the two stay separate concepts.
 *
 * pro_seller (Native Business Onboarding, Pass 1) is a FUTURE-ONLY third
 * tier — no seller checkout/Stripe Connect/commissions/payouts/UI exists
 * yet, nothing writes this value anywhere. It's handled here already so
 * that when Seller work does start, every existing Pro-gated feature
 * automatically keeps working for it: isBusinessPro treats pro_seller as
 * Pro (a Pro Seller must never lose Pro entitlements), and the future
 * seller-only surface gates on isBusinessProSeller instead, never on a
 * raw plan_tier === "pro_seller" comparison scattered around the app.
 */
export function isBusinessPro(business: Pick<Business, "plan_tier">): boolean {
  return isPlanTierPro(business.plan_tier);
}

/** Same resolver for a bare plan_tier value, for a caller that only has
 * that one column (e.g. a narrow admin query) rather than a full Business
 * row. isBusinessPro above delegates here so both agree by construction.
 * True for "pro" AND "pro_seller" — Pro Seller inherits every Pro
 * entitlement, it's never a lesser or separate tier for Pro-gated
 * features. */
export function isPlanTierPro(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "pro_seller";
}

/** True ONLY for pro_seller — the future seller-only entitlement check
 * (marketplace selling features, once built). Currently unused by any
 * caller (nothing in the app is seller-gated yet — see Pass 1's own
 * scope), provided now so that future work has one canonical place to
 * check it rather than a scattered plan_tier === "pro_seller" comparison. */
export function isBusinessProSeller(business: Pick<Business, "plan_tier">): boolean {
  return isPlanTierProSeller(business.plan_tier);
}

/** Bare-value counterpart to isBusinessProSeller, same relationship as
 * isPlanTierPro above. */
export function isPlanTierProSeller(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro_seller";
}

/**
 * Markets Foundation V1 — the one centralized resolver for how many
 * FindMi Markets (business_markets rows, active primary + additional
 * combined) a business is entitled to hold. Every tier resolves to 1
 * today; callers must always go through this function rather than
 * re-deriving the number from plan_tier themselves, so a later change
 * (Multi-Market, a configurable Pro Seller allowance, a per-business
 * override column) only ever needs to change the body of this one
 * function, never its callers.
 */
export function getBusinessMarketLimit(business: Pick<Business, "plan_tier">): number {
  return getMarketLimitForPlanTier(business.plan_tier);
}

/** Bare-value counterpart to getBusinessMarketLimit, same relationship as
 * isPlanTierPro above — for a caller that only has the plan_tier column
 * (e.g. a narrow admin query) rather than a full Business row. */
export function getMarketLimitForPlanTier(planTier: PlanTier | null | undefined): number {
  switch (planTier) {
    case "free":
      return 1;
    case "pro":
      return 1;
    case "pro_seller":
      // Future Pro Seller allowance is meant to become configurable
      // without a schema redesign (see this pass's task) — still a flat
      // 1 for now since nothing seller-specific exists yet.
      return 1;
    default:
      return 1;
  }
}
