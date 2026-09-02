import type { Business, PlanTier } from "./types";

/**
 * Business Plan Entitlement — foundation only (see
 * supabase/migrations/20260902060000_business_plan_tier.sql, not yet
 * applied). This is the one shared resolver every future Pro-gated
 * feature should call instead of re-reading business.plan_tier directly,
 * so the actual "what counts as Pro" rule lives in exactly one place.
 *
 * Deliberately BUSINESS-level, not user-level: a business's plan is a
 * property of the business itself, entirely independent of which role
 * (owner/manager/staff — business_members.role) the current viewer holds
 * on it. Never gate on plan by checking a user's role, and never gate a
 * role check by plan — the two stay separate concepts.
 *
 * No caller wires this into any UI or permission check yet — see "BUSINESS
 * PLAN ENTITLEMENT — FOUNDATION ONLY": this pass only makes the state and
 * its resolver exist.
 */
export function isBusinessPro(business: Pick<Business, "plan_tier">): boolean {
  return isPlanTierPro(business.plan_tier);
}

/** Same resolver for a bare plan_tier value, for a caller that only has
 * that one column (e.g. a narrow admin query) rather than a full Business
 * row. isBusinessPro above delegates here so both agree by construction. */
export function isPlanTierPro(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro";
}
